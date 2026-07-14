// app/lib/utils/reading.js

const dayjs = require('dayjs')
const { getClinic } = require('./clinics')
const { eligibleForReading, getStatusTagColour } = require('./status')
const { isWithinDayRange } = require('./dates')
const { awaitingPriors, userRequestedPriors } = require('./prior-mammograms')
const { updateAppointmentData } = require('./appointment-data')

// /**
//  * Get first unread appointment in a clinic
//  */
// const getFirstUnreadAppointment = (data, clinicId) => {
//   return data.appointments.find(appointment =>
//     appointment.clinicId === clinicId &&
//     eligibleForReading(appointment) &&
//     !appointment.reads?.length
//   ) || null
// }

// /**
//  * Get first unread appointment from first available clinic
//  */
// const getFirstUnreadAppointmentOverall = (data) => {
//   const firstClinic = getFirstAvailableClinic(data)
//   if (!firstClinic) return null

//   return getFirstUnreadAppointment(data, firstClinic.id)
// }

/************************************************************************
// Single appointment
//***********************************************************************

/**
 * Get reading metadata for an appointment
 * @param {Object} appointment - The appointment to check
 * @returns {Object} Object with reading metadata
 */
const getReadingMetadata = (appointment) => {
  // Get all reads from the imageReading structure
  const reads = appointment.imageReading?.reads
    ? Object.values(appointment.imageReading.reads)
    : []
  const readerIds = reads.map((read) => read.readerId)
  const uniqueReaderCount = new Set(readerIds).size

  // Get all unique opinions from reads
  const opinions = reads.map((read) => read.opinion)
  const uniqueOpinions = [...new Set(opinions)].filter(Boolean) // Filter out undefined

  // Discordance: richer than just comparing opinion strings — also checks TR views and RFA breast assessments
  const isDiscordant =
    reads.length >= 2 ? areReadsDiscordant(reads[0], reads[1]) : false

  return {
    readCount: reads.length,
    uniqueReaderCount,
    firstReadComplete: reads.length >= 1,
    secondReadComplete: reads.length >= 2,
    isDiscordant,
    opinions: uniqueOpinions
  }
}

/**
 * Get all reads for an appointment as an ordered array
 * Sorted by readNumber if available, otherwise by timestamp
 * @param {Object} appointment - The appointment to get reads for
 * @returns {Array} Array of read objects sorted by read order
 */
const getReadsAsArray = function (appointment) {
  if (!appointment?.imageReading?.reads) {
    return []
  }

  return Object.values(appointment.imageReading.reads).sort((a, b) => {
    // Sort by readNumber if both have it
    if (a.readNumber && b.readNumber) {
      return a.readNumber - b.readNumber
    }
    // Fall back to timestamp
    return new Date(a.timestamp) - new Date(b.timestamp)
  })
}

/**
 * Save a user's reading for an appointment, and remove the appointment from the reading
 * session's skipped list if present
 *
 * Builds a new imageReading object and saves it through updateAppointmentData
 * rather than mutating the appointment - appointment records are shared read-only data.
 *
 * @param {object} appointment - The appointment to update
 * @param {string} userId - User ID
 * @param {object} reading - Reading data to save
 * @param {object} data - Session data
 * @param {string | null} [sessionId] - Reading session ID (if in session context)
 */
const writeReading = (appointment, userId, reading, data, sessionId = null) => {
  // Work on a clone so the shared record is never touched in place
  const imageReading = structuredClone(appointment.imageReading || {})
  if (!imageReading.reads) {
    imageReading.reads = {}
  }

  // Calculate readNumber based on existing reads
  const existingReadCount = Object.keys(imageReading.reads).length
  // If this user already has a read, keep their readNumber; otherwise assign next number
  const existingRead = imageReading.reads[userId]
  const readNumber = existingRead?.readNumber || existingReadCount + 1

  // Add the reading with timestamp and readNumber
  imageReading.reads[userId] = {
    ...reading,
    readerId: userId, // Ensure the reader ID is saved
    readNumber,
    timestamp: new Date().toISOString()
  }

  // Saves to the appointment and mirrors into data.appointment if it matches
  updateAppointmentData(data, appointment.id, { imageReading })

  // Note the episode deliberately stays in `reading`. Two opinions and a
  // computed outcome is not a confirmed result, and there is no step in the
  // app that confirms one yet - see advanceEpisodeForReadingOutcome in
  // app/lib/utils/episodes.js, which is what that step should call.

  // If we have session context, remove this appointment from skipped appointments
  // (readingSessions is per-session working data, so in-place edits are fine)
  if (sessionId && data.readingSessions?.[sessionId]) {
    const session = data.readingSessions[sessionId]

    // Remove appointment from skipped list if present
    const skippedIndex = session.skippedAppointments.indexOf(appointment.id)
    if (skippedIndex !== -1) {
      session.skippedAppointments.splice(skippedIndex, 1)
    }
  }
}

/************************************************************************
// Multiple appointments
//***********************************************************************

/**
 * Enhance appointments with pre-calculated reading metadata
 * @param {Array} appointments - Array of appointments to enhance
 * @param {Array} participants - Array of participants for lookups
 * @param {string} userId - Current user ID
 * @returns {Array} Enhanced appointments with pre-calculated metadata
 */
const enhanceAppointmentsWithReadingData = (appointments, participants, userId) => {
  // Create a lookup map for participants
  const participantMap = new Map(participants.map((p) => [p.id, p]))

  // Enhanced appointments with pre-calculated metadata
  return appointments.map((appointment) => {
    // Calculate metadata once
    const metadata = getReadingMetadata(appointment)

    return {
      ...appointment,
      participant: participantMap.get(appointment.participantId),
      readStatus:
        metadata.readCount > 0 ? `Read (${metadata.readCount})` : 'Not read',
      tagColor: getStatusTagColour(
        metadata.readCount > 0 ? 'read' : 'not_read'
      ),
      readingMetadata: metadata,
      canUserRead: canUserReadAppointment(appointment, userId)
    }
  })
}

/**
 * Calculate core reading metrics used for both status and progress tracking
 *
 * @param {Array} appointments - Array of appointments to analyze
 * @param {string | null} userId - User ID for user-specific metrics
 * @param {Array} [skippedAppointments] - Array of skipped appointment IDs
 * @returns {object} Core metrics object
 */
const calculateReadingMetrics = function (
  appointments,
  userId = null,
  skippedAppointments = []
) {
  // Get user ID and settings from context if not provided and we're in a template context
  const currentUserId = userId || this?.ctx?.data?.currentUser?.id
  const settings = this?.ctx?.data?.settings || {}

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
      userAwaitingPriorsCount: 0,
      userReadableCount: 0,
      userFirstReadableCount: 0,
      userSecondReadableCount: 0,
      userCanRead: false,
      awaitingPriorsCount: 0,
      userAwaitingPriorsCount: 0,
      skippedCount: skippedAppointments?.length || 0
    }
  }

  // Count first reads (appointments with at least one read)
  const firstReadCount = appointments.filter(hasReads).length
  const completedCount = firstReadCount // For compatibility with current usage

  // Count second reads (appointments with at least two different readers)
  const secondReadCount = appointments.filter((appointment) => {
    const metadata = getReadingMetadata(appointment)
    return metadata.uniqueReaderCount >= 2
  }).length

  // Count appointments that are ready for second read (have first read but not second)
  const secondReadReady = appointments.filter((appointment) => {
    const metadata = getReadingMetadata(appointment)
    return metadata.readCount === 1 // Exactly one read means ready for second
  }).length

  // Count appointments needing arbitration (policy-aware via getOutcome)
  const arbitrationCount = appointments.filter(
    (appointment) => getOutcome(appointment, settings) === 'arbitration_pending'
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
    // Appointments this user has read
    userReadCount = appointments.filter((appointment) =>
      userHasReadAppointment(appointment, currentUserId)
    ).length

    // Count first/second reads by this user
    appointments.forEach((appointment) => {
      const metadata = getReadingMetadata(appointment)
      const reads = appointment.imageReading?.reads
        ? Object.values(appointment.imageReading.reads)
        : []

      // Find reads by this user
      const userReads = reads.filter((read) => read.readerId === currentUserId)

      // Count based on read position (first or second)
      if (userReads.length > 0) {
        // Check if this user did the first read
        if (reads[0]?.readerId === currentUserId) {
          userFirstReadCount++
        }

        // Check if this user did the second read
        if (reads.length > 1 && reads[1]?.readerId === currentUserId) {
          userSecondReadCount++
        }
      }
    })

    // Appointments where this user has an outstanding priors request
    userAwaitingPriorsCount = appointments.filter(
      (appointment) =>
        awaitingPriors(appointment) && userRequestedPriors(appointment, currentUserId)
    ).length

    // Appointments this user can read
    userReadableCount = appointments.filter((appointment) =>
      canUserReadAppointment(appointment, currentUserId)
    ).length

    // Appointments needing first read that this user can read
    userFirstReadableCount = filterAppointmentsByNeedsFirstRead(appointments).filter(
      (appointment) => canUserReadAppointment(appointment, currentUserId)
    ).length

    // Appointments needing second read that this user can read
    userSecondReadableCount = filterAppointmentsByNeedsSecondRead(appointments).filter(
      (appointment) => canUserReadAppointment(appointment, currentUserId)
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
    userAwaitingPriorsCount,
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
 * @param {Array} appointments - Array of appointments to analyze
 * @param {string | null} [userId] - Optional user ID (defaults to current user if available)
 * @returns {object} Detailed reading status
 */
const getReadingStatusForAppointments = function (appointments, userId = null) {
  // Get metrics from base calculation function
  const metrics = calculateReadingMetrics(appointments, userId)

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
 * @param {Array} appointments - Array of appointments to track progress through
 * @param {string} currentAppointmentId - ID of current appointment
 * @param {Array} skippedAppointments - Array of appointment IDs that have been skipped
 * @param {string} [userId] - Optional user ID (defaults to current user if available)
 * @returns {object} Progress information
 */
const getReadingProgress = function (
  appointments,
  currentAppointmentId,
  skippedAppointments = [],
  userId = null
) {
  // Get base metrics
  const metrics = calculateReadingMetrics(appointments, userId, skippedAppointments)

  // Get user ID from context if not provided and we're in a template context
  const currentUserId = userId || this?.ctx?.data?.currentUser?.id

  // Find current appointment index
  const currentIndex = appointments.findIndex((e) => e.id === currentAppointmentId)

  // Basic sequential navigation
  const nextAppointment = getNextAppointmentInList(appointments, currentAppointmentId, false)
  const previousAppointment = getPreviousAppointmentInList(appointments, currentAppointmentId, false)

  // Get appointments needing any reads (first or second)
  const readableAppointments = filterAppointmentsByNeedsAnyRead(appointments)

  // Find next/previous of each type
  const nextReadableAppointment =
    currentIndex !== -1
      ? getNextAppointmentInList(readableAppointments, currentAppointmentId, true)
      : null
  const previousReadableAppointment =
    currentIndex !== -1
      ? getPreviousAppointmentInList(readableAppointments, currentAppointmentId, true)
      : null

  // For user-specific navigation, get appointments this user can read or has read
  let userNavigableAppointments = appointments
  if (currentUserId) {
    userNavigableAppointments = filterAppointmentsByUserCanReadOrHasRead(
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
      ? userHasReadAppointment(previousUserReadableAppointment, currentUserId)
      : false,
    nextUserHasRead: nextUserReadableAppointment
      ? userHasReadAppointment(nextUserReadableAppointment, currentUserId)
      : false,
    // Skipped appointments
    skippedAppointments,
    isCurrentSkipped: skippedAppointments.includes(currentAppointmentId),
    nextAppointmentSkipped: nextAppointment ? skippedAppointments.includes(nextAppointment.id) : false,
    previousAppointmentSkipped: previousAppointment
      ? skippedAppointments.includes(previousAppointment.id)
      : false
  }
}

// /**
//  * Get progress through reading a set of appointments
//  * Enhanced to include user-specific navigation
//  * @param {Array} appointments - Array of appointments to track progress through
//  * @param {string} currentAppointmentId - ID of current appointment
//  * @param {Array} skippedAppointments - Array of appointment IDs that have been skipped
//  * @param {string} [userId=null] - Optional user ID (defaults to current user if available)
//  * @returns {Object} Progress information
//  */
// const getReadingProgress = function(appointments, currentAppointmentId, skippedAppointments = [], userId = null) {
//   // Get user ID from context if not provided and we're in a template context
//   const currentUserId = userId || (this?.ctx?.data?.currentUser?.id);

//   const currentIndex = appointments.findIndex(e => e.id === currentAppointmentId);

//   // Get complete appointments count
//   const completedCount = appointments.filter(hasReads).length;

//   // Basic sequential navigation
//   const nextAppointment = getNextAppointmentInList(appointments, currentAppointmentId, false);
//   const previousAppointment = getPreviousAppointmentInList(appointments, currentAppointmentId, false);

//   // Get appointments needing any reads (first or second)
//   const readableAppointments = filterAppointmentsByNeedsAnyRead(appointments);

//   // Find next/previous of each type
//   const nextReadableAppointment = currentIndex !== -1 ?
//     getNextAppointmentInList(readableAppointments, currentAppointmentId, true) : null;
//   const previousReadableAppointment = currentIndex !== -1 ?
//     getPreviousAppointmentInList(readableAppointments, currentAppointmentId, true) : null;

//   // For user-specific navigation, get appointments this user can read or has read
//   let userNavigableAppointments = appointments;
//   if (currentUserId) {
//     userNavigableAppointments = filterAppointmentsByUserCanReadOrHasRead(appointments, currentUserId);
//   }

//   // Find next/previous user-readable appointments if userId provided
//   let nextUserReadableAppointment = null;
//   let previousUserReadableAppointment = null;

//   if (currentUserId && currentIndex !== -1) {
//     nextUserReadableAppointment = getNextAppointmentInList(userNavigableAppointments, currentAppointmentId, true);
//     previousUserReadableAppointment = getPreviousAppointmentInList(userNavigableAppointments, currentAppointmentId, true);
//   }

//   return {
//     current: currentIndex + 1,
//     total: appointments.length,
//     completed: completedCount,
//     // Appointment navigation
//     hasNext: !!nextAppointment,
//     hasPrevious: !!previousAppointment,
//     nextAppointmentId: nextAppointment?.id || null,
//     previousAppointmentId: previousAppointment?.id || null,
//     hasNextReadableAppointment: !!nextReadableAppointment,
//     hasPreviousReadableAppointment: !!previousReadableAppointment,
//     nextReadableAppointmentId: nextReadableAppointment?.id || null,
//     previousReadableAppointmentId: previousReadableAppointment?.id || null,
//     // User-specific navigation
//     hasNextUserReadable: !!nextUserReadableAppointment,
//     hasPreviousUserReadable: !!previousUserReadableAppointment,
//     nextUserReadableId: nextUserReadableAppointment?.id || null,
//     previousUserReadableId: previousUserReadableAppointment?.id || null,
//     // Skipped appointments
//     skippedCount: skippedAppointments.length,
//     skippedAppointments,
//     isCurrentSkipped: skippedAppointments.includes(currentAppointmentId),
//     nextAppointmentSkipped: nextAppointment ? skippedAppointments.includes(nextAppointment.id) : false,
//     previousAppointmentSkipped: previousAppointment ? skippedAppointments.includes(previousAppointment.id) : false
//   };
// };

// /**
//  * Get detailed reading status for a group of appointments
//  * @param {Array} appointments - Array of appointments to analyze
//  * @param {string} [userId=null] - Optional user ID (defaults to current user if available)
//  * @returns {Object} Detailed reading status
//  */
// const getReadingStatusForAppointments = function(appointments, userId = null) {
//   // Get user ID from context if not provided and we're in a template context
//   const currentUserId = userId || (this?.ctx?.data?.currentUser?.id);

//   if (!appointments || appointments.length === 0) {
//     return {
//       total: 0,
//       firstReadCount: 0,
//       firstReadRemaining: 0,
//       secondReadCount: 0,
//       secondReadRemaining: 0,
//       secondReadReady: 0,
//       arbitrationCount: 0,
//       status: 'no_appointments',
//       statusColor: 'grey',
//       // User-specific counts
//       userReadCount: 0,
//       userFirstReadCount: 0,
//       userSecondReadCount: 0,
//       userReadableCount: 0,
//       userFirstReadableCount: 0,
//       userSecondReadableCount: 0
//     };
//   }

//   // Count first reads (appointments with at least one read)
//   const firstReadCount = appointments.filter(hasReads).length;

//   // Count second reads (appointments with at least two different readers)
//   const secondReadCount = appointments.filter(appointment => {
//     const metadata = getReadingMetadata(appointment);
//     return metadata.uniqueReaderCount >= 2;
//   }).length;

//   // Count appointments that are ready for second read (have first read but not second)
//   const secondReadReady = appointments.filter(appointment => {
//     const metadata = getReadingMetadata(appointment);
//     return metadata.readCount === 1; // Exactly one read means ready for second
//   }).length;

//   // Count appointments needing arbitration (still track this for informational purposes)
//   const arbitrationCount = appointments.filter(appointment => {
//     const metadata = getReadingMetadata(appointment);
//     return metadata.needsArbitration;
//   }).length;

//   // User-specific counts if userId provided
//   let userReadCount = 0;
//   let userFirstReadCount = 0;
//   let userSecondReadCount = 0;
//   let userReadableCount = 0;
//   let userFirstReadableCount = 0;
//   let userSecondReadableCount = 0;

//   if (currentUserId) {
//     // Appointments this user has read
//     userReadCount = appointments.filter(appointment => userHasReadAppointment(appointment, currentUserId)).length;

//     // Count first/second reads by this user
//     appointments.forEach(appointment => {
//       const metadata = getReadingMetadata(appointment);
//       const reads = appointment.imageReading?.reads ? Object.values(appointment.imageReading.reads) : [];

//       // Find reads by this user
//       const userReads = reads.filter(read => read.readerId === currentUserId);

//       // Count based on read position (first or second)
//       if (userReads.length > 0) {
//         // Check if this user did the first read
//         if (reads[0]?.readerId === currentUserId) {
//           userFirstReadCount++;
//         }

//         // Check if this user did the second read
//         if (reads.length > 1 && reads[1]?.readerId === currentUserId) {
//           userSecondReadCount++;
//         }
//       }
//     });

//     // Appointments this user can read
//     userReadableCount = appointments.filter(appointment => canUserReadAppointment(appointment, currentUserId)).length;

//     // Appointments needing first read that this user can read
//     userFirstReadableCount = filterAppointmentsByNeedsFirstRead(appointments)
//       .filter(appointment => canUserReadAppointment(appointment, currentUserId)).length;

//     // Appointments needing second read that this user can read
//     userSecondReadableCount = filterAppointmentsByNeedsSecondRead(appointments)
//       .filter(appointment => canUserReadAppointment(appointment, currentUserId)).length;
//   }

//   // Determine detailed status based on read counts
//   let status;

//   if (firstReadCount === 0) {
//     status = 'not_started';
//   } else if (firstReadCount < appointments.length) {
//     if (secondReadCount > 0) {
//       status = 'mixed_reads';
//     } else {
//       status = 'partial_first_read';
//     }
//   } else if (secondReadCount === 0) {
//     status = 'first_read_complete';
//   } else if (secondReadCount < appointments.length) {
//     status = 'partial_second_read';
//   } else {
//     status = 'complete';
//   }

//   return {
//     total: appointments.length,
//     firstReadCount,
//     firstReadRemaining: appointments.length - firstReadCount,
//     secondReadCount,
//     secondReadRemaining: appointments.length - secondReadCount,
//     secondReadReady, // Appointments ready for immediate second read
//     arbitrationCount,
//     status,
//     statusColor: getStatusTagColour(status),
//     daysSinceScreening: appointments[0] ?
//       dayjs().startOf('day').diff(dayjs(appointments[0].timing.startTime).startOf('day'), 'days') : 0,
//     // User-specific counts
//     userReadCount,
//     userFirstReadCount,
//     userSecondReadCount,
//     userReadableCount,
//     userFirstReadableCount,
//     userSecondReadableCount,
//     userCanRead: userReadableCount > 0
//   };
// };

// Add this to app/lib/utils/reading.js

/**
 * Sort appointments by screening date (oldest first)
 *
 * @param {Array} appointments - Array of appointments to sort
 * @returns {Array} Sorted appointments array
 */
const sortAppointmentsByScreeningDate = (appointments) => {
  if (!appointments || !Array.isArray(appointments) || appointments.length === 0) {
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
      data.appointments.some((e) => e.clinicId === clinic.id && eligibleForReading(e))
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
        readingStatus: getReadingStatusForAppointments(appointments, data.currentUser.id)
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
    (appointment) => appointment.clinicId === clinicId && eligibleForReading(appointment)
  )

  // Enhance the appointments with reading metadata
  const enhancedAppointments = enhanceAppointmentsWithReadingData(
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
 * @param {Array} appointments - Appointments to filter
 * @param {number} maxReadsPerAppointment - Number of reads required to be complete (default: 2)
 * @returns {Array} Appointments needing any read
 */
const filterAppointmentsByNeedsAnyRead = (appointments, maxReadsPerAppointment = 2) => {
  return appointments.filter((appointment) => {
    const metadata = getReadingMetadata(appointment)
    return metadata.uniqueReaderCount < maxReadsPerAppointment
  })
}

/**
 * Filter appointments that need a first read
 *
 * @param {Array} appointments - Appointments to filter
 * @returns {Array} Appointments needing first read
 */
const filterAppointmentsByNeedsFirstRead = (appointments) => {
  return appointments.filter((appointment) => needsFirstRead(appointment))
}

/**
 * Filter appointments that need a second read
 *
 * @param {Array} appointments - Appointments to filter
 * @returns {Array} Appointments needing second read
 */
const filterAppointmentsByNeedsSecondRead = (appointments) => {
  return appointments.filter((appointment) => needsSecondRead(appointment))
}

/**
 * Filter appointments that are fully read (have all required reads)
 *
 * @param {Array} appointments - Appointments to filter
 * @param {number} requiredReads - Number of required reads (default: 2)
 * @returns {Array} Fully read appointments
 */
const filterAppointmentsByFullyRead = (appointments, requiredReads = 2) => {
  return appointments.filter((appointment) => {
    const metadata = getReadingMetadata(appointment)
    return metadata.uniqueReaderCount >= requiredReads
  })
}

/**
 * Filter appointments that a specific user can read
 *
 * @param {Array} appointments - Appointments to filter
 * @param {string} userId - User ID
 * @returns {Array} Appointments user can read
 */
const filterAppointmentsByUserCanRead = (appointments, userId) => {
  return appointments.filter((appointment) => canUserReadAppointment(appointment, userId))
}

/**
 * Filter appointments that user can read or has already read
 *
 * @param {Array} appointments - Array of appointments to filter
 * @param {string} userId - User ID to check
 * @param {object} [options] - Options for determining eligibility
 * @returns {Array} Appointments user can read or has read
 *
 *   Priarily to support navigating backwards through appointments
 */
const filterAppointmentsByUserCanReadOrHasRead = (appointments, userId, options = {}) => {
  const { maxReadsPerAppointment = 2 } = options

  return appointments.filter((appointment) => {
    const metadata = getReadingMetadata(appointment)

    // Include if user has already read this appointment
    if (userHasReadAppointment(appointment, userId)) {
      return true
    }

    // Include if appointment isn't fully read and user can read it
    if (metadata.uniqueReaderCount < maxReadsPerAppointment) {
      return true
    }

    // Exclude appointments that are fully read by other users
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
const filterAppointmentsByDayRange = (appointments, minDays, maxDays = null) => {
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
const getNextAppointmentInList = (appointments, currentAppointmentId, wrap = true) => {
  const currentIndex = appointments.findIndex((e) => e.id === currentAppointmentId)
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
const getPreviousAppointmentInList = (appointments, currentAppointmentId, wrap = true) => {
  const currentIndex = appointments.findIndex((e) => e.id === currentAppointmentId)
  if (currentIndex === -1) return null

  // Previous appointment exists
  if (currentIndex > 0) {
    return appointments[currentIndex - 1]
  }

  // Wrap around to last appointment
  return wrap && appointments.length > 0 ? appointments[appointments.length - 1] : null
}

/************************************************************************
/ User functions
/***********************************************************************/

/**
 * Get the read object for a specific user on an appointment
 *
 * @param {object} appointment - The appointment to check
 * @param {string | null} [userId] - User ID (falls back to current user from context)
 * @returns {object | null} The read object, or null if not found
 */
const getReadForUser = function (appointment, userId = null) {
  const currentUserId = userId || this?.ctx?.data?.currentUser?.id

  if (!currentUserId) {
    return null
  }

  return appointment.imageReading?.reads?.[currentUserId] || null
}

/**
 * Get first appointment from an array that a user can read
 *
 * @param {Array} appointments - Array of appointments to search
 * @param {string | null} userId - User ID to check for
 * @returns {object | null} First appointment user can read or null if none
 */
const getFirstUserReadableAppointment = function (appointments, userId = null) {
  // Get user ID from context if not provided and we're in a template context
  const currentUserId = userId || this?.ctx?.data?.currentUser?.id

  const readableAppointments = filterAppointmentsByUserCanRead(appointments, currentUserId)
  return readableAppointments.length > 0 ? readableAppointments[0] : null
}

/**
 * Get the next appointment the user can read after the current appointment, wrapping to start if needed
 *
 * @param {Array} appointments - Array of all appointments
 * @param {string} currentAppointmentId - ID of the current appointment
 * @param {string | null} [userId] - User ID (falls back to current user from context)
 * @returns {object | null} Next readable appointment, or null if none
 */
const getNextUserReadableAppointment = function (
  appointments,
  currentAppointmentId,
  userId = null,
  options = {}
) {
  const { wrap = true } = options
  const currentUserId = userId || this?.ctx?.data?.currentUser?.id
  const currentIndex = appointments.findIndex((e) => e.id === currentAppointmentId)
  const appointmentsFromNext = wrap
    ? [...appointments.slice(currentIndex + 1), ...appointments.slice(0, currentIndex)]
    : appointments.slice(currentIndex + 1)
  return getFirstUserReadableAppointment(appointmentsFromNext, currentUserId)
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
 * @param {Array} appointments - Array of all appointments in the session, in session order
 * @param {string | null} [userId] - User ID (falls back to current user from context)
 * @param {Array} [skippedAppointments] - Array of skipped appointment IDs from the session
 * @returns {object | null} The appointment to resume from, or null if nothing to read
 */
const getResumeAppointmentForUser = function (
  appointments,
  userId = null,
  skippedAppointments = []
) {
  const currentUserId = userId || this?.ctx?.data?.currentUser?.id

  // Find the highest-index appointment the user has read or that has been skipped
  let lastActedIndex = -1

  appointments.forEach((appointment, index) => {
    const wasReadByUser = !!appointment.imageReading?.reads?.[currentUserId]
    const wasSkipped = skippedAppointments.includes(appointment.id)
    if (wasReadByUser || wasSkipped) {
      lastActedIndex = index
    }
  })

  // Nothing acted on yet — fall back to first readable
  if (lastActedIndex === -1) {
    return getFirstUserReadableAppointment(appointments, currentUserId)
  }

  // Search for the first readable appointment after lastActedIndex, wrapping around
  const appointmentsFromNext = [
    ...appointments.slice(lastActedIndex + 1),
    ...appointments.slice(0, lastActedIndex + 1)
  ]
  return getFirstUserReadableAppointment(appointmentsFromNext, currentUserId)
}

/************************************************************************
// Booleans
//***********************************************************************

/**
 * Check if a user has already read an appointment
 * @param {Object} appointment - The appointment to check
 * @param {string} userId - User ID to check
 * @returns {boolean} Whether the user has read this appointment
 */
const userHasReadAppointment = function (appointment, userId) {
  const currentUserId = userId || this?.ctx?.data?.currentUser?.id

  if (!currentUserId) {
    console.warn(
      'userHasReadAppointment: No userId provided and no context available'
    )
    return false
  }

  return !!getReadForUser(appointment, currentUserId)
}

/**
 * Get reads from other users (not the current user)
 * @param {Object} appointment - The appointment to check
 * @param {string} userId - Current user ID to exclude
 * @returns {Array} Array of read objects from other users
 */
const getOtherReads = function (appointment, userId = null) {
  const currentUserId = userId || this?.ctx?.data?.currentUser?.id

  if (!appointment?.imageReading?.reads) {
    return []
  }

  return Object.entries(appointment.imageReading.reads)
    .filter(([readerId]) => readerId !== currentUserId)
    .map(([readerId, read]) => ({
      ...read,
      readerId
    }))
}

/**
 * Determine if two reads are discordant (disagree in a clinically meaningful way).
 *
 * Rules:
 * - Different top-level opinions → always discordant
 * - Both technical recall: discordant if the set of selected views differs
 *   (reasons are ignored — same views = concordant even with different reasons)
 * - Both recall for assessment: discordant if either per-breast assessment differs
 *   (annotations and comments are ignored)
 * - Both normal → concordant
 *
 * Handles partial data gracefully: if TR views or RFA breast assessments are not
 * yet filled in, falls back to comparing only what's available.
 *
 * @param {object} readA - First read (saved read or imageReadingTemp)
 * @param {object} readB - Second read (saved read or imageReadingTemp)
 * @returns {boolean} Whether the reads are discordant
 */
const areReadsDiscordant = (readA, readB) => {
  if (!readA?.opinion || !readB?.opinion) return false

  // Different top-level opinions → always discordant
  if (readA.opinion !== readB.opinion) return true

  const opinion = readA.opinion

  // Both TR: compare the set of selected view keys
  if (opinion === 'technical_recall') {
    const viewsA = readA.technicalRecall?.views
    const viewsB = readB.technicalRecall?.views
    // If either side has no view data yet, can't compare further
    if (!viewsA || !viewsB) return false
    const keysA = new Set(Object.keys(viewsA))
    const keysB = new Set(Object.keys(viewsB))
    if (keysA.size !== keysB.size) return true
    for (const view of keysA) {
      if (!keysB.has(view)) return true
    }
    return false
  }

  // Both RFA: compare per-breast assessments
  if (opinion === 'recall_for_assessment') {
    const leftA = readA.left?.breastAssessment
    const leftB = readB.left?.breastAssessment
    const rightA = readA.right?.breastAssessment
    const rightB = readB.right?.breastAssessment
    // If no breast data on either side yet, can't compare further
    if (!leftA && !leftB && !rightA && !rightB) return false
    if ((leftA || leftB) && leftA !== leftB) return true
    if ((rightA || rightB) && rightA !== rightB) return true
    return false
  }

  return false
}

/**
 * Determine whether two reads will result in arbitration, taking the site's
 * arbitration policy into account.
 *
 * Policies (from settings.reading.arbitrationPolicy):
 * - 'discordant_only' (default): only discordant reads go to arbitration
 * - 'all_non_normal': any concordant non-normal outcome also goes to arbitration
 *
 * @param {object} readA - First read
 * @param {object} readB - Second read
 * @param {object} [settings] - Site settings object (data.settings)
 * @returns {boolean}
 */
const willGoToArbitration = (readA, readB, settings = {}) => {
  if (!readA || !readB) return false

  // Discordant reads always go to arbitration
  if (areReadsDiscordant(readA, readB)) return true

  // Concordant but non-normal: depends on policy
  const policy = settings?.reading?.arbitrationPolicy || 'discordant_only'
  if (policy === 'all_non_normal') {
    return readA.opinion !== 'normal'
  }

  return false
}

/**
 * Compute the overall outcome for an appointment based on its reads and site policy.
 *
 * Outcomes:
 * - 'not_read'             — no reads yet
 * - 'pending_second_read'  — one read, awaiting second
 * - 'arbitration_pending'  — two reads that are discordant (or policy requires arbitration)
 * - 'normal' / 'technical_recall' / 'recall_for_assessment'
 *                          — concordant outcome (or resolved by an arbitration read)
 *
 * Note: outcome is computed on demand, not persisted. If you need to filter or
 * report by outcome at scale, consider writing it to appointment.imageReading.outcome at
 * save-opinion time.
 *
 * @param {object} appointment - The appointment
 * @param {object} [settings] - Site settings object (data.settings)
 * @returns {string} Outcome key
 */
const getOutcome = function (appointment, settings = null) {
  const resolvedSettings = settings || this?.ctx?.data?.settings || {}
  const reads = getReadsAsArray(appointment)

  if (reads.length === 0) return 'not_read'
  if (reads.length === 1) return 'pending_second_read'

  // Third read = arbitration read; its opinion resolves the case
  if (reads.length >= 3) {
    return reads[2].opinion
  }

  const [firstRead, secondRead] = reads

  if (willGoToArbitration(firstRead, secondRead, resolvedSettings)) {
    return 'arbitration_pending'
  }

  // Concordant reads — outcome is the shared opinion
  return firstRead.opinion
}

/**
 * Determine if a comparison page should be shown to the second reader.
 * Returns false if user is first reader, or if both opinions are normal.
 * Otherwise returns comparison info including discordance and arbitration flags.
 *
 * @param {object} appointment - The appointment being read
 * @param {object} secondReadData - The second reader's data (imageReadingTemp or a read object)
 * @param {string} [userId] - Current user ID (optional, falls back to context)
 * @param {object} [settings] - Site settings (optional, falls back to context)
 * @returns {false | object} False if no comparison needed, else comparison info
 */
const getComparisonInfo = function (
  appointment,
  secondReadData,
  userId = null,
  settings = null
) {
  const currentUserId = userId || this?.ctx?.data?.currentUser?.id
  const resolvedSettings = settings || this?.ctx?.data?.settings || {}

  // Support passing just an opinion string for backwards compatibility
  const secondRead =
    typeof secondReadData === 'string'
      ? { opinion: secondReadData }
      : secondReadData

  // Get the first read (from other users)
  const otherReads = getOtherReads.call(this, appointment, currentUserId)

  // No first read exists - user is first reader
  if (otherReads.length === 0) {
    return false
  }

  // Get the first reader's opinion (sorted by readNumber)
  const firstRead = otherReads.sort((a, b) => {
    if (a.readNumber && b.readNumber) return a.readNumber - b.readNumber
    return new Date(a.timestamp) - new Date(b.timestamp)
  })[0]

  const firstOpinion = firstRead.opinion
  const secondOpinion = secondRead.opinion

  // Both normal - no comparison needed
  if (firstOpinion === 'normal' && secondOpinion === 'normal') {
    return false
  }

  const discordant = areReadsDiscordant(firstRead, secondRead)
  const type = discordant ? 'discordant' : 'agreeing'

  return {
    type,
    discordant,
    goesToArbitration: willGoToArbitration(
      firstRead,
      secondRead,
      resolvedSettings
    ),
    firstRead,
    firstOpinion,
    secondOpinion
  }
}

/**
 * Decide whether the compare page should be shown to the second reader.
 *
 * Combines the timing setting (secondReaderComparison) and the new show-when
 * setting (compareWhen) to give a single boolean answer.
 *
 * compareWhen values (settings.reading.compareWhen):
 * - 'non_normal' (default): show whenever either opinion is non-normal
 *   (i.e. whenever getComparisonInfo returns a result — current behaviour)
 * - 'discordant_only': only show when the two reads are discordant
 *
 * @param {object} appointment - The appointment being read
 * @param {object} secondReadData - The second reader's data (imageReadingTemp or read object)
 * @param {string} [userId] - Current user ID (optional, falls back to context)
 * @param {object} [settings] - Site settings (optional, falls back to context)
 * @returns {boolean}
 */
const shouldShowComparePage = function (
  appointment,
  secondReadData,
  userId = null,
  settings = null
) {
  const resolvedSettings = settings || this?.ctx?.data?.settings || {}
  const currentUserId = userId || this?.ctx?.data?.currentUser?.id

  const comparisonInfo = getComparisonInfo.call(
    this,
    appointment,
    secondReadData,
    currentUserId,
    resolvedSettings
  )

  // getComparisonInfo returns false when no comparison needed
  // (user is first reader, or both opinions are normal)
  if (!comparisonInfo) return false

  const compareWhen = resolvedSettings?.reading?.compareWhen || 'non_normal'

  // 'non_normal': show for any non-normal combination — current behaviour
  if (compareWhen === 'non_normal') return true

  // 'discordant_only': only show when reads disagree in a clinically meaningful way
  if (compareWhen === 'discordant_only') return comparisonInfo.discordant

  return true
}

/**
 * Check if current user can read an appointment
 *
 * @param {object} appointment - The appointment to check
 * @param {string | null} userId - Current user ID
 * @param {object} [options] - Options for determining eligibility
 * @returns {boolean} Whether the current user can read this appointment
 */
/**
 * Check if an appointment has been deferred from reading
 *
 * @param {object} appointment - The appointment to check
 * @returns {boolean} Whether the appointment has been deferred
 */
const isDeferred = (appointment) => {
  return !!appointment?.imageReading?.deferral?.deferredAt
}

const canUserReadAppointment = function (appointment, userId = null, options = {}) {
  const { maxReadsPerAppointment = 2 } = options

  const currentUserId = userId || this?.ctx?.data?.currentUser?.id

  if (!currentUserId) {
    console.warn(
      'canUserReadAppointment: No userId provided and no context available'
    )
    return false
  }

  // Can't read if appointment is awaiting priors
  if (awaitingPriors(appointment)) {
    return false
  }

  // Can't read if appointment has been deferred
  if (isDeferred(appointment)) {
    return false
  }

  const metadata = getReadingMetadata(appointment)

  // If we already have enough unique readers, no more reads needed
  if (metadata.uniqueReaderCount >= maxReadsPerAppointment) {
    return false
  }

  // User can't read if they've already read it
  if (userHasReadAppointment(appointment, currentUserId)) {
    return false
  }

  return true
}

/**
 * Check if an appointment has any reads
 *
 * @param {object} appointment - The appointment to check
 * @returns {boolean} Whether the appointment has any reads
 */
const hasReads = (appointment) => {
  return (
    appointment.imageReading?.reads &&
    Object.keys(appointment.imageReading.reads).length > 0
  )
}

/**
 * Check if an appointment needs a first read
 *
 * @param {object} appointment - The appointment to check
 * @returns {boolean} Whether a first read is needed
 */
const needsFirstRead = (appointment) => {
  return !hasReads(appointment)
}

/**
 * Check if an appointment needs a second read
 */
const needsSecondRead = (appointment) => {
  const metadata = getReadingMetadata(appointment)
  return metadata.firstReadComplete && !metadata.secondReadComplete
}

/**
 * Check if an appointment needs arbitration.
 * Policy-aware: reads arbitrationPolicy from Nunjucks context if available.
 */
const needsArbitration = function (appointment) {
  const settings = this?.ctx?.data?.settings || {}
  return getOutcome(appointment, settings) === 'arbitration_pending'
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

  let appointments = data.appointments.filter((appointment) => eligibleForReading(appointment))

  if (type === 'clinic') {
    if (!clinicId)
      throw new Error('Clinic ID is required for clinic-type sessions')
    appointments = filterAppointmentsByClinic(appointments, clinicId)
  } else {
    // 1. Filter to appointments the user can read (unless overridden)
    if (filters.userCanRead !== false) {
      appointments = filterAppointmentsByUserCanRead(appointments, currentUserId)
    }

    // 2. Apply awaiting priors filter
    if (type === 'awaiting_priors') {
      appointments = appointments.filter((appointment) => awaitingPriors(appointment))
    } else if (!filters.includeAwaitingPriors) {
      appointments = appointments.filter((appointment) => !awaitingPriors(appointment))
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
      appointments = filterAppointmentsByNeedsFirstRead(appointments)
      break
    case 'second_reads':
      appointments = filterAppointmentsByNeedsSecondRead(appointments)
      break
    case 'all_reads':
    case 'awaiting_priors':
      appointments = filterAppointmentsByNeedsAnyRead(appointments)
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
    isLazy && cappedAppointments.length > 0 ? [cappedAppointments[0]] : cappedAppointments

  // Clinic sessions have no fixed target — their size is however many eligible appointments exist
  const sessionTargetSize = type === 'clinic' ? cappedAppointments.length : targetSize

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
const getFirstReadableAppointmentInSession = (data, sessionId, userId = null) => {
  const session = getReadingSession(data, sessionId)
  if (!session) return null

  const currentUserId = userId || data.currentUser.id

  // Get all appointments for the session
  const sessionAppointments = session.appointmentIds
    .map((appointmentId) => data.appointments.find((e) => e.id === appointmentId))
    .filter(Boolean)

  // Find the first one the user can read
  return (
    sessionAppointments.find((appointment) => canUserReadAppointment(appointment, currentUserId)) ||
    null
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
      userHasReadAppointment(appointment, currentUserId) ||
      canUserReadAppointment(appointment, currentUserId) ||
      isDeferred(appointment) ||
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
    .map((appointmentId) => data.appointments.find((e) => e.id === appointmentId))
    .filter(Boolean)

  // Use existing function for progress tracking, then add session-level size info
  const progress = getReadingProgress(
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
      !userHasReadAppointment(appointment, resolvedUserId) &&
      !canUserReadAppointment(appointment, resolvedUserId) &&
      !isDeferred(appointment) &&
      !awaitingPriors(appointment)
    )
  }).length

  const reachableSessionSize =
    sessionAppointments.length - deadCount + availableTopUpCount
  const effectiveTargetSize = Math.min(resolvedTargetSize, reachableSessionSize)

  // Count deferred appointments so they count toward the session target
  const deferredCount = sessionAppointments.filter(isDeferred).length

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
  // getFirstUnreadAppointment,
  // getFirstUnreadAppointmentOverall,

  // Single appointment
  getReadingMetadata,
  areReadsDiscordant,
  willGoToArbitration,
  getOutcome,
  writeReading,

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
  getReadForUser,
  getOtherReads,
  getComparisonInfo,
  shouldShowComparePage,
  getReadsAsArray,
  getFirstUserReadableAppointment,
  getNextUserReadableAppointment,
  getResumeAppointmentForUser,
  // Booleans
  userHasReadAppointment,
  canUserReadAppointment,
  isDeferred,
  hasReads,
  needsArbitration,
  needsFirstRead,
  needsSecondRead,

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
