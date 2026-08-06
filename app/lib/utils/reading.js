// app/lib/utils/reading.js
//
// The appointment- and session-shaped layer over image reading: reading
// sessions, backlogs, clinic lists, progress and navigation, all of which work
// in terms of the appointments a reader is working through.
//
// The reading data itself lives on the episode, as `episode.readingCases[]`.
// Case-level logic is in reading-cases.js and takes a case; getting the case
// for an appointment goes through getReadingCase in episodes.js. That is why
// most helpers here take `data` - it's what resolving a case needs.

const dayjs = require('dayjs')
const { getClinic } = require('./clinics')
const { eligibleForReading, getStatusTagColour } = require('./status')
const { isWithinDayRange } = require('./dates')
const { awaitingPriors, userRequestedPriors } = require('./prior-mammograms')
const {
  getReadingCase,
  getEpisodeAppointments,
  updateReadingCase,
  advanceEpisodeForReadingOutcome
} = require('./episodes')
const {
  getReadsAsArray,
  getReadForUser,
  getReadingMetadata,
  getReadingCaseState,
  getReadingCaseOutcome,
  isReadFinalised,
  isCaseDeferred,
  caseHasReads,
  caseNeedsFirstRead,
  caseNeedsSecondRead,
  caseNeedsArbitration,
  isCaseInArbitration,
  getArbitrationRead,
  canUserReadCase,
  userHasReadCase,
  buildRead,
  withRead,
  withReadFinalised
} = require('./reading-cases')

/************************************************************************
// Single appointment
//
// Thin bridges from an appointment to its case, for the places that only have
// an appointment to hand. Anything doing real work with reads should take the
// case instead.
//***********************************************************************/

/**
 * Get the reading metadata for an appointment's case
 *
 * @param {object} data - Session data
 * @param {object} appointment - The appointment
 * @returns {object} Reading metadata, all zeros if there is no case yet
 */
const getAppointmentReadingMetadata = (data, appointment) => {
  return getReadingMetadata(
    resolveCase(data, appointment),
    data?.settings || {}
  )
}

/**
 * Save a user's read of an appointment's images, and take the appointment off
 * the reading session's skipped list if it was on it.
 *
 * The read goes onto the episode's reading case, not the appointment - a read
 * is a read of one set of images, and the case is what holds those.
 *
 * @param {object} data - Session data
 * @param {object} appointment - The appointment whose images were read
 * @param {string} userId - User ID
 * @param {object} reading - The opinion and its details
 * @param {string | null} [sessionId] - Reading session ID (if in session context)
 * @returns {object | null} The updated case, or null if there was none to write to
 */
const writeReading = (data, appointment, userId, reading, sessionId = null) => {
  const readingCase = getReadingCase(data, appointment)
  if (!readingCase) {
    console.warn(
      `writeReading: no reading case for appointment ${appointment?.id}`
    )
    return null
  }

  const readerType = data.users?.find((user) => user.id === userId)?.role
  const session = sessionId ? data.readingSessions?.[sessionId] : null
  const read = buildRead(readingCase, userId, readerType, reading, {
    panelUserIds: session?.arbitration?.panelUserIds
  })
  const updatedCase = withRead(readingCase, read)

  updateReadingCase(data, appointment.episodeId, updatedCase)

  // Note the episode deliberately stays in `reading`. Two opinions and a
  // computed outcome is not a finalised result - the episode moves on when
  // the reads are finalised (see finaliseUserReadsForSession below).

  // If we have session context, remove this appointment from skipped appointments
  // (readingSessions is per-session working data, so in-place edits are fine)
  if (session) {
    // Remove appointment from skipped list if present
    const skippedIndex = session.skippedAppointments.indexOf(appointment.id)
    if (skippedIndex !== -1) {
      session.skippedAppointments.splice(skippedIndex, 1)
    }
  }

  return updatedCase
}

/**
 * The user's not-yet-finalised reads in a session, each with the appointment
 * and case it belongs to. The session-complete panel's count and the finalise
 * action both work from this.
 *
 * "Not yet finalised" means not finalised either way: no explicit finalisedAt,
 * and the auto-finalisation delay hasn't passed.
 *
 * @param {object} data - Session data
 * @param {string} sessionId - Reading session ID
 * @param {string} userId - User ID
 * @returns {Array<{appointment: object, readingCase: object, read: object}>}
 */
const getUnfinalisedUserReadsForSession = (data, sessionId, userId) => {
  const session = data.readingSessions?.[sessionId]
  if (!session || !userId) return []

  const results = []

  for (const appointmentId of session.appointmentIds || []) {
    const appointment = data.appointments.find(
      (candidate) => candidate.id === appointmentId
    )
    if (!appointment) continue

    const readingCase = getReadingCase(data, appointment)
    const read = getReadForUser(readingCase, userId)
    if (!read) continue
    if (isReadFinalised(read, data.settings)) continue

    results.push({ appointment, readingCase, read })
  }

  return results
}

/**
 * Finalise the user's outstanding reads from a session, and settle what each
 * finalisation makes true: a case whose finalised reads the rules send to
 * arbitration gets its release recorded, and a case that concludes moves its
 * episode on.
 *
 * Auto-finalisation (the delay passing) has no moment like this - a case can
 * conclude by time alone without anything recording the release or advancing
 * the episode. The state stays honest because it is derived; the acts are only
 * recorded where there is an act to record.
 *
 * @param {object} data - Session data
 * @param {string} sessionId - Reading session ID
 * @param {string} userId - User ID
 * @returns {{finalisedCount: number, releasedCount: number, concludedCount: number}}
 */
const finaliseUserReadsForSession = (data, sessionId, userId) => {
  const unfinalised = getUnfinalisedUserReadsForSession(data, sessionId, userId)
  const finalisedAt = new Date().toISOString()

  let releasedCount = 0
  let concludedCount = 0

  for (const { appointment, readingCase } of unfinalised) {
    let updatedCase = withReadFinalised(readingCase, userId, {
      finalisedAt,
      finalisedBy: userId
    })

    const state = getReadingCaseState(updatedCase, data.settings)

    // Both reads finalised and the rules send it to arbitration: record the
    // release into the backlog (see isCaseInArbitration)
    if (
      state === 'awaiting_arbitration' &&
      !updatedCase.arbitration?.releasedAt
    ) {
      updatedCase = {
        ...updatedCase,
        arbitration: { releasedAt: finalisedAt, releasedBy: userId }
      }
      releasedCount++
    }

    updateReadingCase(data, appointment.episodeId, updatedCase)

    // A finalised conclusion is a real result, so the episode moves on
    if (state === 'concluded') {
      advanceEpisodeForReadingOutcome(
        data,
        appointment,
        getReadingCaseOutcome(updatedCase, data.settings)
      )
      concludedCount++
    }
  }

  return { finalisedCount: unfinalised.length, releasedCount, concludedCount }
}

/**
 * Get the reading status of an episode.
 *
 * Lives here rather than in episodes.js so the requires stay one-directional -
 * episodes.js owns getting cases out of session data, and this is the layer
 * above that summarises them.
 *
 * Scoped by the episode's appointments rather than its cases directly, because
 * the summary mixes case facts (reads) with appointment ones (outstanding
 * priors, how long ago the images were taken).
 *
 * @param {object} data - Session data
 * @param {object} episode - Episode object
 * @param {string} [userId] - Optional user, for per-user reading counts
 * @returns {object} Reading status and metrics for the episode
 */
const getEpisodeReadingStatus = (data, episode, userId = null) => {
  return getReadingStatusForAppointments(
    data,
    getEpisodeAppointments(data, episode),
    userId
  )
}

/**
 * Every case currently deferred from reading, most recently deferred first.
 *
 * Deferral is a case-level fact, so this walks the reading backlog and pairs
 * each deferred case with the appointment and participant it belongs to - what
 * a list of deferred cases needs to show a row.
 *
 * @param {object} data - Session data
 * @returns {Array} `{ appointment, participant, readingCase, deferral }`, newest first
 */
const getDeferredCases = (data) => {
  return data.appointments
    .map((appointment) => ({
      appointment,
      participant: data.participants.find(
        (participant) => participant.id === appointment.participantId
      ),
      readingCase: getReadingCase(data, appointment)
    }))
    .filter((row) => isCaseDeferred(row.readingCase))
    .map((row) => ({ ...row, deferral: row.readingCase.deferral }))
    .sort(
      (a, b) =>
        new Date(b.deferral.deferredAt) - new Date(a.deferral.deferredAt)
    )
}

/**
 * Every deferral that has since been resolved, most recently resolved first.
 *
 * A case can have been deferred and returned to the queue more than once, so
 * this is a list of deferrals rather than of cases.
 *
 * @param {object} data - Session data
 * @returns {Array} `{ appointment, participant, readingCase, deferral }`, newest first
 */
const getResolvedDeferrals = (data) => {
  return data.appointments
    .flatMap((appointment) => {
      const readingCase = getReadingCase(data, appointment)

      return (readingCase?.deferralHistory || []).map((deferral) => ({
        appointment,
        participant: data.participants.find(
          (participant) => participant.id === appointment.participantId
        ),
        readingCase,
        deferral
      }))
    })
    .sort(
      (a, b) =>
        new Date(b.deferral.resolvedAt) - new Date(a.deferral.resolvedAt)
    )
}

/**
 * Get an appointment's reading case, preferring one already attached.
 *
 * List-building code enriches appointments with their case up front so a long
 * list resolves each one once; anything working from a raw appointment record
 * falls through to resolving it here.
 *
 * @param {object} data - Session data
 * @param {object} appointment - The appointment
 * @returns {object | null} The case, or null if the appointment produced no images
 */
const resolveCase = (data, appointment) => {
  return appointment?.readingCase !== undefined
    ? appointment.readingCase
    : getReadingCase(data, appointment)
}

/************************************************************************
// Multiple appointments
//***********************************************************************

/**
 * Enhance appointments with their reading case and pre-calculated metadata.
 *
 * Attaching the case here is what lets the rest of the list-handling code stay
 * cheap - everything downstream reads `appointment.readingCase` instead of
 * resolving the episode again per row.
 *
 * @param {object} data - Session data
 * @param {Array} appointments - Array of appointments to enhance
 * @param {Array} participants - Array of participants for lookups
 * @param {string} userId - Current user ID
 * @returns {Array} Enhanced appointments with their case and metadata
 */
const enhanceAppointmentsWithReadingData = (
  data,
  appointments,
  participants,
  userId
) => {
  // Create a lookup map for participants
  const participantMap = new Map(participants.map((p) => [p.id, p]))

  // Enhanced appointments with their case and pre-calculated metadata
  return appointments.map((appointment) => {
    const readingCase = getReadingCase(data, appointment)
    const enhanced = { ...appointment, readingCase }
    const metadata = getReadingMetadata(readingCase, data?.settings || {})

    return {
      ...enhanced,
      participant: participantMap.get(appointment.participantId),
      readStatus:
        metadata.readCount > 0 ? `Read (${metadata.readCount})` : 'Not read',
      tagColor: getStatusTagColour(
        metadata.readCount > 0 ? 'read' : 'not_read'
      ),
      readingMetadata: metadata,
      canUserRead: canUserReadAppointment(data, enhanced, userId)
    }
  })
}

/**
 * Calculate core reading metrics used for both status and progress tracking
 *
 * @param {object} data - Session data
 * @param {Array} appointments - Array of appointments to analyze
 * @param {string | null} userId - User ID for user-specific metrics
 * @param {Array} [skippedAppointments] - Array of skipped appointment IDs
 * @returns {object} Core metrics object
 */
const calculateReadingMetrics = function (
  data,
  appointments,
  userId = null,
  skippedAppointments = []
) {
  // Get user ID and settings from context if not provided and we're in a template context
  const currentUserId = userId || this?.ctx?.data?.currentUser?.id
  const settings = data?.settings || this?.ctx?.data?.settings || {}

  if (!appointments || appointments.length === 0) {
    return {
      total: 0,
      firstReadCount: 0,
      firstReadRemaining: 0,
      secondReadCount: 0,
      secondReadRemaining: 0,
      secondReadReady: 0,
      arbitrationCount: 0,
      completedCount: 0,
      // User-specific counts
      userReadCount: 0,
      userFirstReadCount: 0,
      userSecondReadCount: 0,
      userReadableCount: 0,
      userFirstReadableCount: 0,
      userSecondReadableCount: 0,
      userCanRead: false,
      awaitingPriorsCount: 0,
      userAwaitingPriorsCount: 0,
      skippedCount: skippedAppointments?.length || 0
    }
  }

  // Resolve each appointment's case once - every count below is about the case
  const cases = appointments.map((appointment) =>
    resolveCase(data, appointment)
  )

  // Count first reads (cases with at least one read)
  const firstReadCount = cases.filter(caseHasReads).length
  const completedCount = firstReadCount // For compatibility with current usage

  // Count second reads (cases with at least two different readers)
  const secondReadCount = cases.filter(
    (readingCase) =>
      getReadingMetadata(readingCase, settings).uniqueReaderCount >= 2
  ).length

  // Count cases that are ready for second read (have first read but not second)
  const secondReadReady = cases.filter(caseNeedsSecondRead).length

  // Count cases in the arbitration backlog (policy-aware via the case state)
  const arbitrationCount = cases.filter(
    (readingCase) =>
      getReadingCaseState(readingCase, settings) === 'awaiting_arbitration'
  ).length

  // Global awaiting priors count (appointments with any outstanding prior request)
  const awaitingPriorsCount = appointments.filter((appointment) =>
    awaitingPriors(appointment)
  ).length

  // User-specific counts
  let userReadCount = 0
  let userFirstReadCount = 0
  let userSecondReadCount = 0
  let userAwaitingPriorsCount = 0
  let userReadableCount = 0
  let userFirstReadableCount = 0
  let userSecondReadableCount = 0

  if (currentUserId) {
    // Cases this user has read
    userReadCount = cases.filter((readingCase) =>
      userHasReadCase(readingCase, currentUserId)
    ).length

    // Count first/second reads by this user, by the read's own recorded type
    // rather than its position - a withdrawn read must not shuffle the rest
    cases.forEach((readingCase) => {
      const userRead = getReadForUser(readingCase, currentUserId)
      if (!userRead) return

      if (userRead.readType === 'first') userFirstReadCount++
      if (userRead.readType === 'second') userSecondReadCount++
    })

    // Appointments this user can read
    userReadableCount = appointments.filter((appointment) =>
      canUserReadAppointment(data, appointment, currentUserId)
    ).length

    // Appointments needing first read that this user can read
    userFirstReadableCount = filterAppointmentsByNeedsFirstRead(
      data,
      appointments
    ).filter((appointment) =>
      canUserReadAppointment(data, appointment, currentUserId)
    ).length

    // Appointments needing second read that this user can read
    userSecondReadableCount = filterAppointmentsByNeedsSecondRead(
      data,
      appointments
    ).filter((appointment) =>
      canUserReadAppointment(data, appointment, currentUserId)
    ).length

    // Appointments where this user has an outstanding prior request
    userAwaitingPriorsCount = appointments.filter((appointment) =>
      userRequestedPriors(appointment, currentUserId)
    ).length
  }

  return {
    total: appointments.length,
    firstReadCount,
    firstReadRemaining: appointments.length - firstReadCount,
    secondReadCount,
    secondReadRemaining: appointments.length - secondReadCount,
    secondReadReady,
    arbitrationCount,
    completedCount,
    daysSinceScreening: appointments[0]
      ? dayjs()
          .startOf('day')
          .diff(dayjs(appointments[0].timing.startTime).startOf('day'), 'days')
      : 0,
    // User-specific counts
    userReadCount,
    userFirstReadCount,
    userSecondReadCount,
    userReadableCount,
    userFirstReadableCount,
    userSecondReadableCount,
    userCanRead: userReadableCount > 0,
    // Awaiting priors
    awaitingPriorsCount,
    userAwaitingPriorsCount,
    // Skipped appointments
    skippedCount: skippedAppointments?.length || 0
  }
}

/**
 * Get detailed reading status for a group of appointments
 *
 * @param {object} data - Session data
 * @param {Array} appointments - Array of appointments to analyze
 * @param {string | null} [userId] - Optional user ID (defaults to current user if available)
 * @returns {object} Detailed reading status
 */
const getReadingStatusForAppointments = function (
  data,
  appointments,
  userId = null
) {
  // Get metrics from base calculation function
  const metrics = calculateReadingMetrics.call(this, data, appointments, userId)

  // If no appointments, return basic metrics with default status
  if (!appointments || appointments.length === 0) {
    return {
      ...metrics,
      status: 'no_appointments',
      statusColor: 'grey'
    }
  }

  // Determine detailed status based on read counts
  let status

  if (metrics.firstReadCount === 0) {
    status = 'not_started'
  } else if (metrics.firstReadCount < appointments.length) {
    if (metrics.secondReadCount > 0) {
      status = 'mixed_reads'
    } else {
      status = 'partial_first_read'
    }
  } else if (metrics.secondReadCount === 0) {
    status = 'first_read_complete'
  } else if (metrics.secondReadCount < appointments.length) {
    status = 'partial_second_read'
  } else {
    status = 'complete'
  }

  return {
    ...metrics,
    status,
    statusColor: getStatusTagColour(status)
  }
}

/**
 * Get progress through reading a set of appointments
 * Enhanced to include user-specific navigation
 *
 * @param {object} data - Session data
 * @param {Array} appointments - Array of appointments to track progress through
 * @param {string} currentAppointmentId - ID of current appointment
 * @param {Array} skippedAppointments - Array of appointment IDs that have been skipped
 * @param {string} [userId] - Optional user ID (defaults to current user if available)
 * @returns {object} Progress information
 */
const getReadingProgress = function (
  data,
  appointments,
  currentAppointmentId,
  skippedAppointments = [],
  userId = null
) {
  // Get base metrics
  const metrics = calculateReadingMetrics.call(
    this,
    data,
    appointments,
    userId,
    skippedAppointments
  )

  // Get user ID from context if not provided and we're in a template context
  const currentUserId = userId || this?.ctx?.data?.currentUser?.id

  // Find current appointment index
  const currentIndex = appointments.findIndex(
    (e) => e.id === currentAppointmentId
  )

  // Basic sequential navigation
  const nextAppointment = getNextAppointmentInList(
    appointments,
    currentAppointmentId,
    false
  )
  const previousAppointment = getPreviousAppointmentInList(
    appointments,
    currentAppointmentId,
    false
  )

  // Get appointments needing any reads (first or second)
  const readableAppointments = filterAppointmentsByNeedsAnyRead(
    data,
    appointments
  )

  // Find next/previous of each type
  const nextReadableAppointment =
    currentIndex !== -1
      ? getNextAppointmentInList(
          readableAppointments,
          currentAppointmentId,
          true
        )
      : null
  const previousReadableAppointment =
    currentIndex !== -1
      ? getPreviousAppointmentInList(
          readableAppointments,
          currentAppointmentId,
          true
        )
      : null

  // For user-specific navigation, get appointments this user can read or has read
  let userNavigableAppointments = appointments
  if (currentUserId) {
    userNavigableAppointments = filterAppointmentsByUserCanReadOrHasRead(
      data,
      appointments,
      currentUserId
    )
  }

  // Find next/previous user-readable appointments if userId provided
  let nextUserReadableAppointment = null
  let previousUserReadableAppointment = null

  if (currentUserId && currentIndex !== -1) {
    nextUserReadableAppointment = getNextAppointmentInList(
      userNavigableAppointments,
      currentAppointmentId,
      true
    )
    previousUserReadableAppointment = getPreviousAppointmentInList(
      userNavigableAppointments,
      currentAppointmentId,
      true
    )
  }

  return {
    ...metrics,
    current: currentIndex + 1,
    // Appointment navigation
    hasNext: !!nextAppointment,
    hasPrevious: !!previousAppointment,
    nextAppointmentId: nextAppointment?.id || null,
    previousAppointmentId: previousAppointment?.id || null,
    hasNextReadableAppointment: !!nextReadableAppointment,
    hasPreviousReadableAppointment: !!previousReadableAppointment,
    nextReadableAppointmentId: nextReadableAppointment?.id || null,
    previousReadableAppointmentId: previousReadableAppointment?.id || null,
    // User-specific navigation
    hasNextUserReadable: !!nextUserReadableAppointment,
    hasPreviousUserReadable: !!previousUserReadableAppointment,
    nextUserReadableId: nextUserReadableAppointment?.id || null,
    previousUserReadableId: previousUserReadableAppointment?.id || null,
    // Whether user has already read the previous/next appointment (for review page links)
    previousUserHasRead: previousUserReadableAppointment
      ? userHasReadAppointment(
          data,
          previousUserReadableAppointment,
          currentUserId
        )
      : false,
    nextUserHasRead: nextUserReadableAppointment
      ? userHasReadAppointment(data, nextUserReadableAppointment, currentUserId)
      : false,
    // Skipped appointments
    skippedAppointments,
    isCurrentSkipped: skippedAppointments.includes(currentAppointmentId),
    nextAppointmentSkipped: nextAppointment
      ? skippedAppointments.includes(nextAppointment.id)
      : false,
    previousAppointmentSkipped: previousAppointment
      ? skippedAppointments.includes(previousAppointment.id)
      : false
  }
}

/**
 * Sort appointments by screening date (oldest first)
 *
 * @param {Array} appointments - Array of appointments to sort
 * @returns {Array} Sorted appointments array
 */
const sortAppointmentsByScreeningDate = (appointments) => {
  if (
    !appointments ||
    !Array.isArray(appointments) ||
    appointments.length === 0
  ) {
    return []
  }

  return [...appointments].sort(
    (a, b) => new Date(a.timing.startTime) - new Date(b.timing.startTime)
  )
}

/************************************************************************
// Clinic stuff
//***********************************************************************

/**
 * Get the first clinic that still has appointments needing reads
 *
 * @param {object} data - Session data
 * @returns {object | null} First clinic with remaining reads, or null
 */
const getFirstAvailableClinic = (data) => {
  const clinics = getReadingClinics(data)
  return clinics.find((clinic) => clinic.readingStatus.remaining > 0) || null
}

/**
 * Get all clinics available for reading, enriched with unit, location, and reading status
 *
 * @param {object} data - Session data
 * @param {object} [options] - Options (currently unused, reserved for future filters)
 * @returns {Array} Clinics with added `unit`, `location`, and `readingStatus` properties
 */
const getReadingClinics = (data, options = {}) => {
  const {} = options

  return data.clinics
    .filter((clinic) =>
      data.appointments.some(
        (e) => e.clinicId === clinic.id && eligibleForReading(e)
      )
    )
    .map((clinic) => {
      const unit = data.breastScreeningUnits.find(
        (u) => u.id === clinic.breastScreeningUnitId
      )
      const location = unit.locations.find((l) => l.id === clinic.locationId)
      const appointments = getReadableAppointmentsForClinic(data, clinic.id)

      return {
        ...clinic,
        unit,
        location,
        readingStatus: getReadingStatusForAppointments(
          data,
          appointments,
          data.currentUser.id
        )
      }
    })
    .sort((a, b) => new Date(a.id) - new Date(b.id)) // Some clinics share the same date so sort first by a unique ID to keep consistent sort
    .sort((a, b) => new Date(a.date) - new Date(b.date))
}

/**
 * Get readable appointments for a clinic with pre-calculated metadata
 *
 * @param {object} data - Session data containing appointments, participants, etc.
 * @param {string} clinicId - ID of the clinic to get appointments for
 * @returns {Array} Appointments with enhanced metadata
 */
const getReadableAppointmentsForClinic = (data, clinicId) => {
  // Filter eligible appointments for this clinic
  const eligibleAppointments = data.appointments.filter(
    (appointment) =>
      appointment.clinicId === clinicId && eligibleForReading(appointment)
  )

  // Enhance the appointments with reading metadata
  const enhancedAppointments = enhanceAppointmentsWithReadingData(
    data,
    eligibleAppointments,
    data.participants,
    data.currentUser?.id
  )

  // Sort by appointment time
  return enhancedAppointments.sort(
    (a, b) => new Date(a.timing.startTime) - new Date(b.timing.startTime)
  )
}

/************************************************************************
// Filters
//***********************************************************************


/**
 * Filter appointments that are eligible for reading
 * @param {Array} appointments - All appointments
 * @returns {Array} Appointments eligible for reading
 */
const filterAppointmentsByEligibleForReading = (appointments) => {
  return appointments.filter((appointment) => eligibleForReading(appointment))
}

/**
 * Filter appointments that need any read (first or second)
 *
 * @param {object} data - Session data
 * @param {Array} appointments - Appointments to filter
 * @param {number} maxReadsPerCase - Number of reads required to be complete (default: 2)
 * @returns {Array} Appointments needing any read
 */
const filterAppointmentsByNeedsAnyRead = (
  data,
  appointments,
  maxReadsPerCase = 2
) => {
  return appointments.filter(
    (appointment) =>
      getReadsAsArray(resolveCase(data, appointment)).length < maxReadsPerCase
  )
}

/**
 * Filter appointments that need a first read
 *
 * @param {object} data - Session data
 * @param {Array} appointments - Appointments to filter
 * @returns {Array} Appointments needing first read
 */
const filterAppointmentsByNeedsFirstRead = (data, appointments) => {
  return appointments.filter((appointment) =>
    caseNeedsFirstRead(resolveCase(data, appointment))
  )
}

/**
 * Filter appointments that need a second read
 *
 * @param {object} data - Session data
 * @param {Array} appointments - Appointments to filter
 * @returns {Array} Appointments needing second read
 */
const filterAppointmentsByNeedsSecondRead = (data, appointments) => {
  return appointments.filter((appointment) =>
    caseNeedsSecondRead(resolveCase(data, appointment))
  )
}

/**
 * Filter appointments whose case sits in the arbitration backlog and which
 * this user could arbitrate - nobody reads the same case twice.
 *
 * @param {object} data - Session data
 * @param {Array} appointments - Appointments to filter
 * @param {string} [userId] - User who would arbitrate; omit to skip the check
 * @returns {Array} Appointments needing arbitration
 */
const filterAppointmentsByNeedsArbitration = (
  data,
  appointments,
  userId = null
) => {
  return appointments.filter((appointment) => {
    const readingCase = resolveCase(data, appointment)

    if (!caseNeedsArbitration(readingCase, data.settings)) return false
    if (isCaseDeferred(readingCase)) return false

    return !userId || !userHasReadCase(readingCase, userId)
  })
}

/**
 * Filter appointments that are fully read (have all required reads)
 *
 * @param {object} data - Session data
 * @param {Array} appointments - Appointments to filter
 * @param {number} requiredReads - Number of required reads (default: 2)
 * @returns {Array} Fully read appointments
 */
const filterAppointmentsByFullyRead = (
  data,
  appointments,
  requiredReads = 2
) => {
  return appointments.filter(
    (appointment) =>
      getReadsAsArray(resolveCase(data, appointment)).length >= requiredReads
  )
}

/**
 * Filter appointments that a specific user can read
 *
 * @param {object} data - Session data
 * @param {Array} appointments - Appointments to filter
 * @param {string} userId - User ID
 * @returns {Array} Appointments user can read
 */
const filterAppointmentsByUserCanRead = (data, appointments, userId) => {
  return appointments.filter((appointment) =>
    canUserReadAppointment(data, appointment, userId)
  )
}

/**
 * Filter appointments that user can read or has already read
 *
 * @param {object} data - Session data
 * @param {Array} appointments - Array of appointments to filter
 * @param {string} userId - User ID to check
 * @param {object} [options] - Options for determining eligibility
 * @returns {Array} Appointments user can read or has read
 *
 *   Primarily to support navigating backwards through appointments
 */
const filterAppointmentsByUserCanReadOrHasRead = (
  data,
  appointments,
  userId,
  options = {}
) => {
  const { maxReadsPerCase = 2 } = options

  return appointments.filter((appointment) => {
    const readingCase = resolveCase(data, appointment)

    // Include if the user has already read this case
    if (userHasReadCase(readingCase, userId)) return true

    // Include if the case isn't fully read yet, so they could still read it
    if (getReadsAsArray(readingCase).length < maxReadsPerCase) return true

    // A case released to arbitration still takes its arbitration read
    if (isCaseInArbitration(readingCase) && !getArbitrationRead(readingCase)) {
      return true
    }

    // Exclude cases that are fully read by other users
    return false
  })
}

/**
 * Filter appointments for a specific clinic
 *
 * @param {Array} appointments - All appointments
 * @param {string} clinicId - Clinic ID
 * @returns {Array} Appointments for the clinic
 */
const filterAppointmentsByClinic = (appointments, clinicId) => {
  return appointments.filter((appointment) => appointment.clinicId === clinicId)
}

/**
 * Filter appointments that are within a specific day range
 *
 * @param {Array} appointments - Appointments to filter
 * @param {number} minDays - Minimum days old (inclusive)
 * @param {number | null} [maxDays] - Maximum days old (inclusive), if null, no upper bound
 * @returns {Array} Appointments within the specified day range
 */
const filterAppointmentsByDayRange = (
  appointments,
  minDays,
  maxDays = null
) => {
  if (!appointments || !Array.isArray(appointments)) return []

  return appointments.filter((appointment) =>
    isWithinDayRange(appointment.timing.startTime, minDays, maxDays)
  )
}

/************************************************************************
// Selector functions
//***********************************************************************

/**
 * Get the first appointment from an array
 * @param {Array} appointments - Array of appointments
 * @returns {Object|null} First appointment or null
 */
const getFirstAppointmentInList = (appointments) => {
  return appointments.length > 0 ? appointments[0] : null
}

/**
 * Get the next appointment after a specific appointment
 *
 * @param {Array} appointments - Array of appointments
 * @param {string} currentAppointmentId - Current appointment ID
 * @param {boolean} wrap - Whether to wrap around to start if at end
 * @returns {object | null} Next appointment or null
 */
const getNextAppointmentInList = (
  appointments,
  currentAppointmentId,
  wrap = true
) => {
  const currentIndex = appointments.findIndex(
    (e) => e.id === currentAppointmentId
  )
  if (currentIndex === -1) return null

  // Next appointment exists
  if (currentIndex < appointments.length - 1) {
    return appointments[currentIndex + 1]
  }

  // Wrap around to first appointment
  return wrap && appointments.length > 0 ? appointments[0] : null
}

/**
 * Get the previous appointment before a specific appointment
 *
 * @param {Array} appointments - Array of appointments
 * @param {string} currentAppointmentId - Current appointment ID
 * @param {boolean} wrap - Whether to wrap around to end if at start
 * @returns {object | null} Previous appointment or null
 */
const getPreviousAppointmentInList = (
  appointments,
  currentAppointmentId,
  wrap = true
) => {
  const currentIndex = appointments.findIndex(
    (e) => e.id === currentAppointmentId
  )
  if (currentIndex === -1) return null

  // Previous appointment exists
  if (currentIndex > 0) {
    return appointments[currentIndex - 1]
  }

  // Wrap around to last appointment
  return wrap && appointments.length > 0
    ? appointments[appointments.length - 1]
    : null
}

/************************************************************************
/ User functions
/***********************************************************************/

/**
 * Get first appointment from an array that a user can read
 *
 * @param {object} data - Session data
 * @param {Array} appointments - Array of appointments to search
 * @param {string | null} userId - User ID to check for
 * @returns {object | null} First appointment user can read or null if none
 */
const getFirstUserReadableAppointment = function (
  data,
  appointments,
  userId = null
) {
  // Get user ID from context if not provided and we're in a template context
  const currentUserId = userId || this?.ctx?.data?.currentUser?.id

  const readableAppointments = filterAppointmentsByUserCanRead(
    data,
    appointments,
    currentUserId
  )
  return readableAppointments.length > 0 ? readableAppointments[0] : null
}

/**
 * Get the next appointment the user can read after the current appointment, wrapping to start if needed
 *
 * @param {object} data - Session data
 * @param {Array} appointments - Array of all appointments
 * @param {string} currentAppointmentId - ID of the current appointment
 * @param {string | null} [userId] - User ID (falls back to current user from context)
 * @returns {object | null} Next readable appointment, or null if none
 */
const getNextUserReadableAppointment = function (
  data,
  appointments,
  currentAppointmentId,
  userId = null,
  options = {}
) {
  const { wrap = true } = options
  const currentUserId = userId || this?.ctx?.data?.currentUser?.id
  const currentIndex = appointments.findIndex(
    (e) => e.id === currentAppointmentId
  )
  const appointmentsFromNext = wrap
    ? [
        ...appointments.slice(currentIndex + 1),
        ...appointments.slice(0, currentIndex)
      ]
    : appointments.slice(currentIndex + 1)
  return getFirstUserReadableAppointment(
    data,
    appointmentsFromNext,
    currentUserId
  )
}

/**
 * Get the appointment the user should resume reading from.
 *
 * Finds the furthest point the user has reached by looking at the highest-index
 * appointment they have either read or that has been skipped in the batch. Returns
 * the first readable appointment after that position, wrapping to the start if needed.
 *
 * Using position (index) rather than timestamps lets us account for skipped
 * appointments, which have no timestamps. (perhaps they should do)
 *
 * Falls back to getFirstUserReadableAppointment if the user has no reads or skips yet.
 *
 * @param {object} data - Session data
 * @param {Array} appointments - Array of all appointments in the session, in session order
 * @param {string | null} [userId] - User ID (falls back to current user from context)
 * @param {Array} [skippedAppointments] - Array of skipped appointment IDs from the session
 * @returns {object | null} The appointment to resume from, or null if nothing to read
 */
const getResumeAppointmentForUser = function (
  data,
  appointments,
  userId = null,
  skippedAppointments = []
) {
  const currentUserId = userId || this?.ctx?.data?.currentUser?.id

  // Find the highest-index appointment the user has read or that has been skipped
  let lastActedIndex = -1

  appointments.forEach((appointment, index) => {
    const wasReadByUser = userHasReadCase(
      resolveCase(data, appointment),
      currentUserId
    )
    const wasSkipped = skippedAppointments.includes(appointment.id)
    if (wasReadByUser || wasSkipped) {
      lastActedIndex = index
    }
  })

  // Nothing acted on yet — fall back to first readable
  if (lastActedIndex === -1) {
    return getFirstUserReadableAppointment(data, appointments, currentUserId)
  }

  // Search for the first readable appointment after lastActedIndex, wrapping around
  const appointmentsFromNext = [
    ...appointments.slice(lastActedIndex + 1),
    ...appointments.slice(0, lastActedIndex + 1)
  ]
  return getFirstUserReadableAppointment(
    data,
    appointmentsFromNext,
    currentUserId
  )
}

/************************************************************************
// Booleans
//
// Only the predicates that need more than the case: reading is blocked by
// outstanding priors, which live on the appointment. Everything else about a
// read is in reading-cases.js and takes a case.
//***********************************************************************/

/**
 * Check if a user has already read an appointment's images
 *
 * @param {object} data - Session data
 * @param {object} appointment - The appointment to check
 * @param {string} [userId] - User ID (falls back to current user from context)
 * @returns {boolean} Whether the user has read this appointment
 */
const userHasReadAppointment = function (data, appointment, userId = null) {
  const currentUserId = userId || this?.ctx?.data?.currentUser?.id

  if (!currentUserId) {
    console.warn(
      'userHasReadAppointment: No userId provided and no context available'
    )
    return false
  }

  return userHasReadCase(resolveCase(data, appointment), currentUserId)
}

/**
 * Check if a user can read an appointment's images.
 *
 * Combines what the case knows (deferral, who has read it, how many reads it
 * has) with the one blocker that lives on the appointment: a prior mammogram
 * that has been requested but not yet arrived.
 *
 * @param {object} data - Session data
 * @param {object} appointment - The appointment to check
 * @param {string | null} [userId] - User ID (falls back to current user from context)
 * @param {object} [options] - Options for determining eligibility
 * @returns {boolean} Whether the user can read this appointment
 */
const canUserReadAppointment = function (
  data,
  appointment,
  userId = null,
  options = {}
) {
  const currentUserId = userId || this?.ctx?.data?.currentUser?.id

  if (!currentUserId) {
    console.warn(
      'canUserReadAppointment: No userId provided and no context available'
    )
    return false
  }

  // Can't read while a requested prior is still outstanding
  if (awaitingPriors(appointment)) return false

  return canUserReadCase(resolveCase(data, appointment), currentUserId, options)
}

/************************************************************************
// Sessions
//***********************************************************************

/**
 * Check if an appointment is a complex case
 *
 * @param {object} appointment - The appointment to check
 * @returns {boolean} Whether the appointment is a complex case
 */
const isComplexCase = (appointment) => {
  const hasSymptoms = appointment?.medicalInformation?.symptoms?.length > 0
  const hasAdditionalImages =
    appointment?.mammogramData?.metadata?.hasAdditionalImages
  const isImperfect =
    appointment?.mammogramData?.isImperfectButBestPossible?.includes?.('yes')
  const isIncomplete =
    appointment?.mammogramData?.isIncompleteMammography?.includes?.('yes')
  const hasImplants =
    appointment?.medicalInformation?.medicalHistory?.breastImplantsAugmentation
      ?.length > 0

  return (
    hasSymptoms ||
    hasAdditionalImages ||
    isImperfect ||
    isIncomplete ||
    hasImplants
  )
}

/**
 * Get eligible appointment candidates for a session based on its type and filters
 * Shared between createReadingSession and topUpSession to ensure consistent selection
 *
 * @param {object} data - Session data
 * @param {object} sessionOptions - Session options ({ type, clinicId, filters })
 * @returns {Array} Eligible appointments sorted oldest-first
 */
const getEligibleCandidatesForSession = (data, sessionOptions) => {
  const { type = 'custom', clinicId, filters = {} } = sessionOptions
  const currentUserId = data.currentUser.id

  let appointments = data.appointments.filter((appointment) =>
    eligibleForReading(appointment)
  )

  if (type === 'clinic') {
    if (!clinicId)
      throw new Error('Clinic ID is required for clinic-type sessions')
    appointments = filterAppointmentsByClinic(appointments, clinicId)
  } else if (type === 'arbitration') {
    // The arbitration backlog, not the reading queues. The generic
    // user-can-read filter below would reject these cases (two reads
    // already), so arbitration selects its own way.
    // Panel arbitration skips user filtering — a panel member who was
    // an original reader can still participate in the group decision.
    appointments = filterAppointmentsByNeedsArbitration(
      data,
      appointments,
      filters.skipUserFilter ? null : currentUserId
    )
    appointments = appointments.filter(
      (appointment) => !awaitingPriors(appointment)
    )
  } else {
    // 1. Filter to appointments the user can read (unless overridden)
    if (filters.userCanRead !== false) {
      appointments = filterAppointmentsByUserCanRead(
        data,
        appointments,
        currentUserId
      )
    }

    // 2. Apply awaiting priors filter
    if (type === 'awaiting_priors') {
      appointments = appointments.filter((appointment) =>
        awaitingPriors(appointment)
      )
    } else if (!filters.includeAwaitingPriors) {
      appointments = appointments.filter(
        (appointment) => !awaitingPriors(appointment)
      )
    }

    // 3. Symptoms filter
    if (filters.hasSymptoms) {
      appointments = appointments.filter(
        (appointment) => appointment?.medicalInformation?.symptoms?.length > 0
      )
    }

    // 4. Complex case filter
    if (filters.complexOnly) {
      appointments = appointments.filter(isComplexCase)
    }
  }

  // Apply read type filters
  switch (type) {
    case 'first_reads':
      appointments = filterAppointmentsByNeedsFirstRead(data, appointments)
      break
    case 'second_reads':
      appointments = filterAppointmentsByNeedsSecondRead(data, appointments)
      break
    case 'all_reads':
    case 'awaiting_priors':
      appointments = filterAppointmentsByNeedsAnyRead(data, appointments)
      break
  }

  // Sort oldest first
  return [...appointments].sort(
    (a, b) => new Date(a.timing.startTime) - new Date(b.timing.startTime)
  )
}

/**
 * Create a session of appointments for reading based on specified criteria
 *
 * When lazy sessions are enabled (settings.reading.lazySessions), non-clinic sessions
 * start with only the first eligible appointment. The session is topped up one appointment at a
 * time via topUpSession() as reads and skips happen, until targetSize is reached.
 *
 * @param {object} data - Session data
 * @param {object} options - Session creation options
 * @param {string} options.type - Type of session ('all_reads', 'first_reads', 'second_reads', 'awaiting_priors', 'clinic', 'custom')
 * @param {string} [options.name] - Display name for the session
 * @param {string} [options.clinicId] - Clinic ID (for clinic-specific sessions)
 * @param {string} [options.sessionId] - Custom session ID (auto-generated if omitted)
 * @param {number} [options.limit] - Target size (defaults to settings value)
 * @param {object} [options.filters] - Additional filters to apply
 * @returns {object} Created session
 */
const createReadingSession = (data, options) => {
  const {
    type = 'custom',
    name,
    clinicId,
    sessionId = null,
    limit = null,
    lazy = null, // explicit override; null means use settings
    filters = {}
  } = options

  const finalSessionId = sessionId || generateSessionId()

  // Determine target size: explicit limit > settings default > 25
  const settingsTargetSize =
    parseInt(data.settings?.reading?.defaultSessionSize) || 25
  const targetSize = limit !== null ? parseInt(limit) : settingsTargetSize

  // Lazy loading: start with only the first appointment and top up as reads happen
  // Clinic sessions are always fully populated upfront
  // Explicit lazy param overrides the setting
  const lazyEnabled =
    lazy !== null ? lazy : data.settings?.reading?.lazySessions === 'true'
  const isLazy = lazyEnabled && type !== 'clinic'

  // Get all eligible candidates using the shared helper
  const allCandidates = getEligibleCandidatesForSession(data, {
    type,
    clinicId,
    filters
  })

  // Cap to target size
  const cappedAppointments =
    targetSize > 0 && allCandidates.length > targetSize
      ? allCandidates.slice(0, targetSize)
      : allCandidates

  // Lazy sessions start with only the first appointment
  const initialAppointments =
    isLazy && cappedAppointments.length > 0
      ? [cappedAppointments[0]]
      : cappedAppointments

  // Clinic sessions have no fixed target — their size is however many eligible appointments exist
  const sessionTargetSize =
    type === 'clinic' ? cappedAppointments.length : targetSize

  // Create and store the session
  const session = {
    id: finalSessionId,
    name: name || getDefaultSessionName(type, clinicId, data),
    type,
    appointments: initialAppointments,
    appointmentIds: initialAppointments.map((e) => e.id),
    targetSize: sessionTargetSize,
    clinicId,
    createdAt: new Date().toISOString(),
    skippedAppointments: [],
    filters: {
      ...filters
    }
  }

  // Initialize the reading sessions object if it doesn't exist
  if (!data.readingSessions) {
    data.readingSessions = {}
  }

  // Store the session
  data.readingSessions[finalSessionId] = session

  return session
}

/**
 * Generate a default name for a session based on its type
 *
 * @param {string} type - Session type
 * @param {string} clinicId - Clinic ID (for clinic sessions)
 * @param {object} data - Session data
 * @returns {string} Default session name
 */
const getDefaultSessionName = (type, clinicId, data) => {
  switch (type) {
    case 'all_reads':
      return 'Session overview'
    case 'first_reads':
      return '1st reads session'
    case 'second_reads':
      return '2nd reads session'
    case 'awaiting_priors':
      return 'Awaiting priors session'
    case 'arbitration':
      return 'Arbitration session'
    case 'clinic': {
      const clinic = getClinic(data, clinicId)
      if (!clinic) return 'Clinic session'

      const location = clinic.locationId
        ? data.breastScreeningUnits
            .find((bsu) => bsu.id === clinic.breastScreeningUnitId)
            ?.locations.find((l) => l.id === clinic.locationId)?.name
        : ''

      return `${location || 'Clinic'} - ${dayjs(clinic.date).format('D MMM YYYY')}`
    }
    default:
      return 'Custom session'
  }
}

/**
 * Generate a unique ID for a session
 *
 * @returns {string} Unique session ID
 */
const generateSessionId = () => {
  return Math.random().toString(36).substring(2, 10)
}

/**
 * Get a reading session by ID
 *
 * @param {object} data - Session data
 * @param {string} sessionId - Session ID to retrieve
 * @returns {object | null} Session object or null if not found
 */
const getReadingSession = (data, sessionId) => {
  if (!data.readingSessions || !data.readingSessions[sessionId]) {
    return null
  }

  return data.readingSessions[sessionId]
}

// Add a helper function to create sessions from clinics
const getOrCreateClinicSession = (data, clinicId) => {
  // Check if a session already exists for this clinic
  const existingSession = (data.readingSessions || {})[clinicId]

  if (
    existingSession &&
    existingSession.type === 'clinic' &&
    existingSession.clinicId === clinicId
  ) {
    return existingSession
  }

  // Create a new session for this clinic
  return createReadingSession(data, {
    type: 'clinic',
    clinicId,
    sessionId: clinicId, // Use clinic ID as session ID
    name: null // Will use default clinic name
  })
}

/**
 * Get the first appointment in a session that a user can read
 *
 * @param {object} data - Session data
 * @param {string} sessionId - Session ID
 * @param {string | null} [userId] - User ID (defaults to current user)
 * @returns {object | null} First readable appointment or null if none found
 */
const getFirstReadableAppointmentInSession = (
  data,
  sessionId,
  userId = null
) => {
  const session = getReadingSession(data, sessionId)
  if (!session) return null

  const currentUserId = userId || data.currentUser.id

  // Get all appointments for the session
  const sessionAppointments = session.appointmentIds
    .map((appointmentId) =>
      data.appointments.find((e) => e.id === appointmentId)
    )
    .filter(Boolean)

  // Find the first one the user can read
  return (
    sessionAppointments.find((appointment) =>
      canUserReadAppointment(data, appointment, currentUserId)
    ) || null
  )
}

/**
 * Mark an appointment as skipped in a session
 *
 * @param {object} data - Session data
 * @param {string} sessionId - Session ID
 * @param {string} appointmentId - Appointment ID to mark as skipped
 * @returns {boolean} Whether the operation was successful
 */
const skipAppointmentInSession = (data, sessionId, appointmentId) => {
  const session = getReadingSession(data, sessionId)
  if (!session) return false

  // Check if appointment exists in this session
  if (!session.appointmentIds.includes(appointmentId)) return false

  // Check if already skipped
  if (session.skippedAppointments.includes(appointmentId)) return true

  // Add to skipped appointments
  session.skippedAppointments.push(appointmentId)
  return true
}

/**
 * Add the next eligible appointment to a session if it is under its target size
 * Called after each read or skip to grow the session one case at a time
 *
 * @param {object} data - Session data
 * @param {string} sessionId - Session ID
 * @returns {boolean} Whether an appointment was added
 */
const topUpSession = (data, sessionId) => {
  const session = getReadingSession(data, sessionId)
  if (!session) return false

  // Clinic sessions are fully populated at creation
  if (session.type === 'clinic') return false

  const currentUserId = data.currentUser?.id

  // Count appointments that are still actionable for this user — appointments they have read,
  // can still read, deferred, or awaiting priors. Appointments fully read by other readers
  // ('dead' slots) are excluded so the session can be topped up to replace them.
  const actionableCount = session.appointmentIds.filter((appointmentId) => {
    const appointment = data.appointments.find((e) => e.id === appointmentId)
    if (!appointment) return false
    return (
      userHasReadAppointment(data, appointment, currentUserId) ||
      canUserReadAppointment(data, appointment, currentUserId) ||
      isCaseDeferred(getReadingCase(data, appointment)) ||
      awaitingPriors(appointment)
    )
  }).length

  if (!session.targetSize || actionableCount >= session.targetSize) return false

  // Exclude appointments already in this session to avoid duplicates. Appointments that
  // are in other sessions are allowed — the same appointment can appear in multiple
  // sessions and canUserReadAppointment enforces that each user reads it at most once.
  const alreadyInSession = new Set(session.appointmentIds)

  // Get candidates using the same filters as at session creation
  const candidates = getEligibleCandidatesForSession(data, session).filter(
    (appointment) => !alreadyInSession.has(appointment.id)
  )

  if (candidates.length === 0) return false

  // Add the next eligible appointment
  session.appointmentIds.push(candidates[0].id)
  return true
}

/**
 * Get reading progress for a session
 *
 * @param {object} data - Session data
 * @param {string} sessionId - Session ID
 * @param {string} currentAppointmentId - Current appointment ID
 * @param {string} [userId] - User ID (defaults to current user)
 * @returns {object} Reading progress information
 */
const getSessionReadingProgress = (
  data,
  sessionId,
  currentAppointmentId,
  userId = null
) => {
  const session = getReadingSession(data, sessionId)
  if (!session) return null

  // Get all appointments for the session
  const sessionAppointments = session.appointmentIds
    .map((appointmentId) =>
      data.appointments.find((e) => e.id === appointmentId)
    )
    .filter(Boolean)

  // Use existing function for progress tracking, then add session-level size info
  const progress = getReadingProgress(
    data,
    sessionAppointments,
    currentAppointmentId,
    session.skippedAppointments,
    userId || data.currentUser.id
  )

  const resolvedTargetSize = session.targetSize || sessionAppointments.length
  const resolvedUserId = userId || data.currentUser.id

  // Work out how large this session can actually become right now once we
  // account for unclaimed eligible cases. This prevents showing "25 remaining"
  // when only (for example) 20 cases are available to read.
  // Mirror the same exclusion used in topUpSession: only exclude appointments already
  // in this session, not appointments in other sessions.
  const alreadyInSession = new Set(session.appointmentIds)
  const availableTopUpCount = getEligibleCandidatesForSession(
    data,
    session
  ).filter((appointment) => !alreadyInSession.has(appointment.id)).length

  // Dead appointments — fully read by other users and not actionable by this user.
  // They occupy session slots but can never be completed, so they don't count
  // toward reachable size. topUpSession will replace them when appointments are read.
  const deadCount = sessionAppointments.filter((appointment) => {
    return (
      !userHasReadAppointment(data, appointment, resolvedUserId) &&
      !canUserReadAppointment(data, appointment, resolvedUserId) &&
      !isCaseDeferred(getReadingCase(data, appointment)) &&
      !awaitingPriors(appointment)
    )
  }).length

  const reachableSessionSize =
    sessionAppointments.length - deadCount + availableTopUpCount
  const effectiveTargetSize = Math.min(resolvedTargetSize, reachableSessionSize)

  // Count deferred appointments so they count toward the session target
  const deferredCount = sessionAppointments.filter((appointment) =>
    isCaseDeferred(getReadingCase(data, appointment))
  ).length

  return {
    ...progress,
    // How many appointments are currently loaded vs the overall target
    populatedCount: sessionAppointments.length,
    targetSize: resolvedTargetSize,
    effectiveTargetSize,
    // Deferred appointments count as 'done' for session progress purposes
    deferredCount,
    // Remaining reads against the target (not just currently loaded appointments)
    targetRemaining: Math.max(
      0,
      effectiveTargetSize -
        progress.userReadCount -
        progress.userAwaitingPriorsCount -
        deferredCount
    )
  }
}

module.exports = {
  // Single appointment
  getAppointmentReadingMetadata,
  writeReading,
  getUnfinalisedUserReadsForSession,
  finaliseUserReadsForSession,
  getEpisodeReadingStatus,
  getDeferredCases,
  getResolvedDeferrals,

  // Multiple appointments
  enhanceAppointmentsWithReadingData,
  getReadingProgress,
  getReadingStatusForAppointments,
  sortAppointmentsByScreeningDate,

  // Clinic stuff
  getFirstAvailableClinic,
  getReadingClinics,
  getReadableAppointmentsForClinic,

  // Filters
  filterAppointmentsByEligibleForReading,
  filterAppointmentsByNeedsAnyRead,
  filterAppointmentsByNeedsFirstRead,
  filterAppointmentsByNeedsSecondRead,
  filterAppointmentsByNeedsArbitration,
  filterAppointmentsByFullyRead,
  filterAppointmentsByUserCanRead,
  filterAppointmentsByUserCanReadOrHasRead,
  filterAppointmentsByClinic,
  filterAppointmentsByDayRange,
  // Selector functions
  getFirstAppointmentInList,
  getNextAppointmentInList,
  getPreviousAppointmentInList,
  // User functions
  getFirstUserReadableAppointment,
  getNextUserReadableAppointment,
  getResumeAppointmentForUser,
  // Booleans
  userHasReadAppointment,
  canUserReadAppointment,

  // Sessions
  getEligibleCandidatesForSession,
  createReadingSession,
  getDefaultSessionName,
  generateSessionId,
  getReadingSession,
  getOrCreateClinicSession,
  getFirstReadableAppointmentInSession,
  skipAppointmentInSession,
  topUpSession,
  getSessionReadingProgress
}
