// app/routes/reading.js
const {
  getAppointment,
  getAppointmentData,
  updateAppointmentData
} = require('../lib/utils/appointment-data')
const { getClinic } = require('../lib/utils/clinics')
const {
  getResumeAppointmentForUser,
  getReadableAppointmentsForClinic,
  getReadingStatusForAppointments,
  getReadingClinics,
  canUserReadAppointment,
  userHasReadAppointment,
  writeReading,
  getUnfinalisedUserReadsForSession,
  finaliseReadOnCase,
  finaliseUserReadsForSession,
  getEligibleCandidatesForSession,
  createReadingSession,
  getFirstReadableAppointmentInSession,
  getReadingSession,
  getOrCreateClinicSession,
  getSessionReadingProgress,
  skipAppointmentInSession,
  unskipAppointmentInSession,
  isSessionEnded,
  endSession,
  topUpSession,
  getAppointmentReadingMetadata,
  appointmentHasBeenArbitrated,
  getNextCaseInSession,
  getFirstOutstandingCaseInSession,
  filterAppointmentsByEligibleForReading,
  filterAppointmentsByNeedsAnyRead,
  filterAppointmentsByUserCanRead
} = require('../lib/utils/reading')
const { getReadingCase, updateReadingCase } = require('../lib/utils/episodes')
const {
  getComparisonInfo,
  shouldShowComparePage,
  getReadingMetadata,
  getReadsAsArray,
  getReadForUser,
  getArbitrationRead,
  getReadAuthorIds,
  caseHasBeenArbitrated,
  isReadFinalised,
  isCaseDeferred,
  withoutRead,
  withArbitrationRelease
} = require('../lib/utils/reading-cases')
const { getParticipant, getShortName } = require('../lib/utils/participants')
const {
  PRIOR_REQUEST_STATUSES,
  awaitingPriors,
  userRequestedPriors
} = require('../lib/utils/prior-mammograms')
const { camelCase, snakeCase } = require('../lib/utils/strings')
const {
  getArbitrationBacklogCounts,
  getReadingCaseRows
} = require('../lib/utils/reading-case-list')
const {
  getHistoricReadingSessions
} = require('../lib/utils/historic-reading-sessions')
const { modalBreakout, getReturnUrl } = require('../lib/utils/referrers')
const dayjs = require('dayjs')
const generateId = require('../lib/utils/id-generator')

module.exports = (router) => {
  // Set nav state
  router.use('/reading', (req, res, next) => {
    res.locals.navActive = 'reading'
    next()
  })

  // Reading index — choose layout based on setting
  router.get('/reading', (req, res) => {
    const data = req.session.data
    const currentUserId = data?.currentUser?.id
    const layout = req.session.data?.settings?.reading?.indexLayout || 'simple'
    const template =
      layout === 'complex' ? 'reading/index-complex' : 'reading/index-simple'

    const sessionProgressById = {}
    Object.values(data.readingSessions || {}).forEach((session) => {
      const progress = getSessionReadingProgress(
        data,
        session.id,
        null,
        currentUserId
      )
      if (progress) {
        sessionProgressById[session.id] = progress
      }
    })

    // The arbitration backlog, counted the same way the case list and the
    // arbitration setup page count it so the three agree. Only the complex
    // layout shows the card, and the count walks every episode - don't pay
    // for it otherwise
    const arbitrationCount =
      layout === 'complex'
        ? getArbitrationBacklogCounts(data, { view: 'current' }).total
        : null

    // What the reading case list card offers - the same population its
    // default view shows
    const readingCaseCount =
      layout === 'complex'
        ? getReadingCaseRows(data, { view: 'current' }).length
        : null

    res.render(template, {
      sessionProgressById,
      arbitrationCount,
      readingCaseCount
    })
  })

  // Default clinics list to "mine"
  router.get('/reading/clinics', (req, res) => {
    res.redirect('/reading/clinics/mine')
  })

  // Define valid views and route them all to a single handler
  const clinicViews = ['/reading/clinics/mine', '/reading/clinics/all']

  router.get(clinicViews, (req, res) => {
    const data = req.session.data

    // Extract view from the URL path
    const view = req.path.split('/').pop()

    // Get all reading clinics
    const clinics = getReadingClinics(data)

    // Filter incomplete clinics
    const incompleteClinics = clinics.filter(
      (clinic) => clinic.readingStatus.status !== 'complete'
    )

    // Filter clinics based on view
    let clinicsToDisplay = incompleteClinics

    if (view === 'mine') {
      // Show only clinics where the current user can read something
      clinicsToDisplay = incompleteClinics.filter(
        (clinic) => clinic.readingStatus.userReadableCount > 0
      )
    }

    res.render('reading/clinics', {
      clinics,
      incompleteClinics,
      clinicsToDisplay,
      view
    })
  })

  // Look up a clinic and redirect to appropriate session
  router.get('/reading/clinics/:clinicId', (req, res) => {
    const { clinicId } = req.params
    const data = req.session.data
    const clinic = getClinic(data, clinicId)

    if (!clinic) return res.redirect('/reading')

    try {
      // Convert clinic to session
      const session = getOrCreateClinicSession(data, clinicId)

      // Redirect to the session view
      res.redirect(`/reading/session/${session.id}`)
    } catch (error) {
      console.log('Could not load clinic for reading')
      res.redirect('/reading')
    }
  })

  // Helper to immediately start reading a session
  router.get('/reading/clinics/:clinicId/start', (req, res) => {
    const { clinicId } = req.params
    const data = req.session.data
    const currentUserId = data.currentUser.id

    const clinic = getClinic(data, clinicId)
    if (!clinic) return res.redirect('/reading')

    try {
      // Convert clinic to session
      const session = getOrCreateClinicSession(data, clinicId)

      // Find first readable appointment in the session
      const firstReadableAppointment = getFirstReadableAppointmentInSession(
        data,
        session.id,
        currentUserId
      )

      if (firstReadableAppointment) {
        // Redirect directly to the first readable appointment
        res.redirect(
          `/reading/session/${session.id}/appointments/${firstReadableAppointment.id}`
        )
      } else {
        // No readable appointments, go to batch overview
        res.redirect(`/reading/session/${session.id}`)
      }
    } catch (error) {
      console.log('Could not start reading clinic')
      res.redirect('/reading')
    }
  })

  /************************************************************************
  // Prior mammograms management
  /***********************************************************************/

  // Priors management page with optional tab filter
  const VALID_PRIOR_FILTERS = [
    'all',
    'not-requested',
    'pending',
    'requested',
    'resolved'
  ]

  router.get(
    ['/reading/priors', '/reading/priors/:filter'],
    (req, res, next) => {
      const filter = req.params.filter || 'all'

      if (!VALID_PRIOR_FILTERS.includes(filter)) {
        return next()
      }

      res.render('reading/priors', {
        priorsFilter: filter
      })
    }
  )

  // Update mammogram request status from priors management page
  router.post('/reading/priors/update-status', (req, res) => {
    const data = req.session.data
    const { appointmentId, mammogramId, newStatus } = req.body
    const currentUserId = data.currentUser?.id

    // Only accept known request statuses - the value comes straight from
    // the request body
    if (!PRIOR_REQUEST_STATUSES.includes(newStatus)) {
      return res.redirect('/reading/priors')
    }

    const appointment = getAppointment(data, appointmentId)
    if (!appointment || !appointment.previousMammograms) {
      return res.redirect('/reading/priors')
    }

    const mammogram = appointment.previousMammograms.find(
      (m) => m.id === mammogramId
    )
    if (!mammogram) {
      return res.redirect('/reading/priors')
    }

    // Build an updated mammogram list rather than mutating in place - appointment
    // records are shared read-only data; writes go through the update helpers
    const previousMammograms = appointment.previousMammograms.map((m) => {
      if (m.id !== mammogramId) return m

      const updated = {
        ...m,
        requestStatus: newStatus,
        statusChangedDate: new Date().toISOString(),
        statusChangedBy: currentUserId
      }

      // Set additional fields based on status
      if (newStatus === 'requested') {
        // Admin is formally sending the IEP request
        updated.requestedDate = new Date().toISOString()
        updated.requestedBy = currentUserId
      } else if (newStatus === 'received') {
        updated.receivedDate = new Date().toISOString()
      }

      return updated
    })

    // Saves to the appointment and mirrors into data.appointment if it matches
    const updatedAppointment = updateAppointmentData(data, appointmentId, { previousMammograms })

    // returnTo lets other surfaces (the case priors tab) reuse this action
    // and land back where the user was. Local paths only
    const returnTo = req.body.returnTo?.startsWith('/') ? req.body.returnTo : null

    // Fetch requests get the fragment the surface asked for re-rendered, so
    // the page can update in place - a table row on the priors dashboard, a
    // card on the case's priors tab
    if (req.xhr) {
      const fragmentViews = {
        row: 'reading/prior-mammogram-row',
        card: 'reading/prior-mammogram-card'
      }
      const fragmentView = fragmentViews[req.body.fragment] || fragmentViews.row

      return res.render(fragmentView, {
        thisAppointment: updatedAppointment,
        mammogram: updatedAppointment.previousMammograms.find((m) => m.id === mammogramId),
        priorsReturnTo: returnTo
      })
    }

    if (returnTo) {
      return res.redirect(returnTo)
    }
    res.redirect('/reading/priors')
  })

  /************************************************************************
  // Sessions
  /***********************************************************************/

  router.get('/reading/create-session', (req, res) => {
    const data = req.session.data
    const currentUserId = data.currentUser.id

    // Get batch creation options from query params
    const { type, clinicId, limit, name, redirect, lazy } = req.query

    // Create filters from query params
    const filters = {}
    // Handle filters as an array or single value
    const queryFilters = [].concat(req.query.filters || [])

    if (queryFilters.includes('hasSymptoms')) {
      filters.hasSymptoms = true
    }

    if (queryFilters.includes('includeAwaitingPriors')) {
      filters.includeAwaitingPriors = true
    }

    if (queryFilters.includes('complexOnly')) {
      filters.complexOnly = true
    }

    const sessionOptions = {
      type: type || 'custom',
      name,
      clinicId,
      limit: limit ? parseInt(limit) : null,
      lazy: lazy !== undefined ? lazy === 'true' : null,
      filters
    }

    const candidates = getEligibleCandidatesForSession(data, sessionOptions)

    if (candidates.length === 0) {
      res.redirect('/reading')
      return
    }

    // Create the session
    try {
      const session = createReadingSession(data, sessionOptions)

      // Check if the request includes the redirect parameter
      if (redirect === 'list') {
        // Redirect to batch view instead of starting reading
        res.redirect(`/reading/session/${session.id}`)
        return
      }

      // Redirect to batch view or first appointment if available
      const firstReadableAppointment = getFirstReadableAppointmentInSession(
        data,
        session.id,
        currentUserId
      )

      if (firstReadableAppointment) {
        res.redirect(
          `/reading/session/${session.id}/appointments/${firstReadableAppointment.id}`
        )
      } else {
        res.redirect(`/reading/session/${session.id}`)
      }
    } catch (error) {
      console.log('Error creating session', error)
      res.redirect('/reading')
    }
  })

  // Route for viewing a batch. Reading sessions have per-user views and live at
  // /your-reads; arbitration has no yours-vs-everyone split, so it renders here.
  router.get('/reading/session/:sessionId', (req, res) => {
    const data = req.session.data
    const { sessionId } = req.params
    const session = getReadingSession(data, sessionId)

    if (session?.type !== 'arbitration') {
      return res.redirect(`/reading/session/${sessionId}/your-reads`)
    }

    renderSessionOverview(req, res, session, null)
  })

  // Route for resuming a session — jumps straight into the next readable case,
  // falling back to the session overview if none exists.
  router.get('/reading/session/:sessionId/resume', (req, res) => {
    const data = req.session.data
    const { sessionId } = req.params
    const session = getReadingSession(data, sessionId)
    if (!session) {
      return res.redirect('/reading')
    }

    // An ended session has nothing to resume - show what it came to instead
    if (isSessionEnded(session)) {
      return res.redirect(`/reading/session/${sessionId}`)
    }

    // A session can end up with nothing readable in it — every loaded case
    // taken by other readers — while the backlog still has cases waiting. Top
    // up until one readable case appears, and no further.
    //
    // Not "until topUpSession stops adding": it grows the session towards its
    // target size, so running it to exhaustion here would load every remaining
    // case at once and defeat lazy sessions. The bound is a backstop only.
    const maxTopUps = session.targetSize || 25
    for (let count = 0; count < maxTopUps; count++) {
      const loadedAppointments = session.appointmentIds
        .map((appointmentId) =>
          data.appointments.find((e) => e.id === appointmentId)
        )
        .filter(Boolean)

      const hasReadableCase = getFirstOutstandingCaseInSession(
        data,
        session,
        loadedAppointments,
        data.currentUser.id
      )
      if (hasReadableCase) break

      if (!topUpSession(data, sessionId)) break
    }

    // Rebuild after potential top-ups
    const sessionAppointments = session.appointmentIds
      .map((appointmentId) =>
        data.appointments.find((e) => e.id === appointmentId)
      )
      .filter(Boolean)

    const resumeAppointment = getResumeAppointmentForUser(
      data,
      sessionAppointments,
      data.currentUser.id,
      session.skippedAppointments || [],
      session
    )

    if (resumeAppointment) {
      return res.redirect(
        `/reading/session/${sessionId}/appointments/${resumeAppointment.id}`
      )
    }

    // Check if there are any readable cases left in the session
    const firstReadable = getFirstOutstandingCaseInSession(
      data,
      session,
      sessionAppointments,
      data.currentUser.id
    )
    if (firstReadable) {
      res.redirect(`/reading/session/${sessionId}`)
    } else {
      res.redirect(`/reading/session/${sessionId}/no-more-cases`)
    }
  })

  // Route for skipped-review page (shown at end of batch when skipped cases remain)
  router.get('/reading/session/:sessionId/skipped-review', (req, res) => {
    const data = req.session.data
    const { sessionId } = req.params
    const session = getReadingSession(data, sessionId)
    if (!session) {
      return res.redirect('/reading')
    }
    const firstSkippedAppointmentId = session.skippedAppointments[0] || null
    res.render('reading/skipped-review', {
      session,
      sessionId,
      firstSkippedAppointmentId
    })
  })

  // Route for no-more-cases page (shown when no more readable cases available in session)
  router.get('/reading/session/:sessionId/no-more-cases', (req, res) => {
    const data = req.session.data
    const { sessionId } = req.params
    const session = getReadingSession(data, sessionId)
    if (!session) {
      return res.redirect('/reading')
    }

    // Reaching this page is the session being worked through - the end of it,
    // and where that gets recorded. Ending says nothing about finalisation:
    // the reads made in it finalise on their own schedule, or by hand.
    // Judged on the target rather than on what's loaded, so a lazy session
    // that could still top up isn't ended just because another reader
    // currently holds the cases it would have loaded next.
    const sessionProgress = getSessionReadingProgress(
      data,
      sessionId,
      null,
      data.currentUser?.id
    )

    if (
      isSessionEndable(session) &&
      !isSessionEnded(session) &&
      sessionProgress?.targetRemaining === 0
    ) {
      endSession(data, sessionId, data.currentUser?.id)
    }

    res.render('reading/no-more-cases', {
      sessionId,
      session,
      unfinalisedReadCount: getUnfinalisedUserReadsForSession(
        data,
        sessionId,
        data.currentUser?.id
      ).length
    })
  })

  // The URL that actually renders a session's overview. A reading session
  // renders under /your-reads, so redirecting to the bare session URL costs an
  // extra redirect - and any flash message with it, since res.locals consumes
  // the flash on every request.
  const sessionOverviewUrl = (session) => {
    return session.type === 'arbitration'
      ? `/reading/session/${session.id}`
      : `/reading/session/${session.id}/your-reads`
  }

  // The step where a case is decided - arbitration decides an outcome on its
  // own page, reading gives an opinion on the standard one.
  const caseDecisionUrl = (data, sessionId, appointmentId) => {
    const step =
      getReadingSession(data, sessionId)?.type === 'arbitration'
        ? 'outcome'
        : 'opinion'
    return `/reading/session/${sessionId}/appointments/${appointmentId}/${step}`
  }

  // Where the reader goes once they are finished with a case: the next case
  // still to do, or whichever end-of-session page applies. Shared by saving a
  // decision and by the "Next case" link, so both answer the question the same
  // way - and both top the session up first, since a lazy session only grows
  // when navigation would otherwise run out of cases.
  const onwardFromCase = (data, sessionId, appointmentId) => {
    const currentUserId = data.currentUser?.id

    topUpSession(data, sessionId, appointmentId)

    const session = getReadingSession(data, sessionId)
    const sessionAppointments = session.appointmentIds
      .map((id) => data.appointments.find((e) => e.id === id))
      .filter(Boolean)

    const nextCase = getNextCaseInSession(
      data,
      session,
      sessionAppointments,
      appointmentId,
      currentUserId
    )

    if (nextCase) {
      return `/reading/session/${sessionId}/appointments/${nextCase.id}`
    }
    if (session.skippedAppointments.length > 0) {
      return `/reading/session/${sessionId}/skipped-review`
    }
    return getFirstOutstandingCaseInSession(
      data,
      session,
      sessionAppointments,
      currentUserId
    )
      ? `/reading/session/${sessionId}`
      : `/reading/session/${sessionId}/no-more-cases`
  }

  // Finalise the user's reads from this session - linked from the session
  // overview's session-complete panel, so a plain link can reach it.
  // Finalisation is what makes a result real: it releases discordant cases
  // into the arbitration backlog and moves concluded episodes on.
  router.all('/reading/session/:sessionId/finalise-reads', (req, res) => {
    const data = req.session.data
    const { sessionId } = req.params
    const session = getReadingSession(data, sessionId)
    if (!session) {
      return res.redirect('/reading')
    }

    const { finalisedCount } = finaliseUserReadsForSession(
      data,
      sessionId,
      data.currentUser?.id
    )

    if (finalisedCount > 0) {
      const noun = session.type === 'arbitration' ? 'outcome' : 'read'
      req.flash(
        'success',
        finalisedCount === 1
          ? `1 ${noun} finalised`
          : `${finalisedCount} ${noun}s finalised`
      )
    }

    res.redirect(sessionOverviewUrl(session))
  })

  // The user's outstanding reads from a session, and when the first of them
  // will finalise itself. Both the session overview and the end-session
  // interstitial ask this, and must give the same answer.
  const getSessionFinalisationInfo = (data, sessionId, userId) => {
    const unfinalisedReads = getUnfinalisedUserReadsForSession(
      data,
      sessionId,
      userId
    )

    const finalisationDelayMinutes = parseInt(
      data.settings?.reading?.finalisationDelay,
      10
    )
    const unfinalisedTimestamps = unfinalisedReads
      .map(({ read }) => read.timestamp)
      .sort()

    const autoFinaliseTime = (timestamp) =>
      timestamp && !Number.isNaN(finalisationDelayMinutes)
        ? dayjs(timestamp).add(finalisationDelayMinutes, 'minute').toISOString()
        : null

    // Each read finalises on its own delay, so several outstanding reads
    // finalise across a span rather than at one moment
    const autoFinaliseAt = autoFinaliseTime(unfinalisedTimestamps[0])
    const lastAutoFinaliseAt = autoFinaliseTime(
      unfinalisedTimestamps[unfinalisedTimestamps.length - 1]
    )

    return { unfinalisedReads, autoFinaliseAt, lastAutoFinaliseAt }
  }

  // A clinic's cases are a shared body of work rather than one reader's queue,
  // and every reader of that clinic works through the same session - so a
  // clinic session is never ended, by hand or by running out of cases.
  const isSessionEndable = (session) => {
    return Boolean(session) && !session.clinicId
  }

  const canEndSessionEarly = (session) => {
    return isSessionEndable(session) && !isSessionEnded(session)
  }

  // Whether a case carries any of the work a session is judged by - what an
  // ended session has to show for itself. Reading counts the user's own acts;
  // arbitration counts the panel's, since a case is arbitrated once for
  // everyone.
  const wasWorkedInSession = (data, session, appointment, userId) => {
    const readingCase = getReadingCase(data, appointment)

    if (session.type === 'arbitration') {
      return (
        appointmentHasBeenArbitrated(data, appointment) ||
        isCaseDeferred(readingCase) ||
        awaitingPriors(appointment)
      )
    }

    return (
      userHasReadAppointment(data, appointment, userId) ||
      userRequestedPriors(appointment, userId) ||
      isCaseDeferred(readingCase)
    )
  }

  // Ending a session early - the interstitial. Says what ending does, and where
  // reads are outstanding, offers finalising them now rather than leaving them
  // to the finalisation delay.
  router.get('/reading/session/:sessionId/end', (req, res) => {
    const data = req.session.data
    const { sessionId } = req.params
    const session = getReadingSession(data, sessionId)
    if (!session) {
      return res.redirect('/reading')
    }

    if (!canEndSessionEarly(session)) {
      return res.redirect(`/reading/session/${sessionId}`)
    }

    // A fresh visit starts with nothing chosen
    delete data.endSessionTemp

    const { unfinalisedReads, autoFinaliseAt, lastAutoFinaliseAt } =
      getSessionFinalisationInfo(data, sessionId, data.currentUser?.id)

    const sessionProgress = getSessionReadingProgress(
      data,
      sessionId,
      null,
      data.currentUser?.id
    )

    res.render('reading/end-session', {
      session,
      sessionId,
      sessionProgress,
      unfinalisedReadCount: unfinalisedReads.length,
      autoFinaliseAt,
      lastAutoFinaliseAt
    })
  })

  router.post('/reading/session/:sessionId/end-answer', (req, res) => {
    const data = req.session.data
    const { sessionId } = req.params
    const currentUserId = data.currentUser?.id
    const session = getReadingSession(data, sessionId)
    if (!session) {
      return res.redirect('/reading')
    }

    if (!canEndSessionEarly(session)) {
      return res.redirect(modalBreakout(sessionOverviewUrl(session)))
    }

    const isArbitration = session.type === 'arbitration'
    const { unfinalisedReads } = getSessionFinalisationInfo(
      data,
      sessionId,
      currentUserId
    )

    // The choice only exists when there is something to finalise
    const finaliseAnswer = data.endSessionTemp?.finalise
    if (unfinalisedReads.length > 0 && !finaliseAnswer) {
      req.flash('error', {
        text: isArbitration
          ? 'Select whether to finalise the outcomes from this session'
          : 'Select whether to finalise your opinions from this session',
        name: 'endSessionTemp[finalise]',
        href: '#finalise-reads'
      })
      return res.redirect(`/reading/session/${sessionId}/end`)
    }

    if (finaliseAnswer === 'yes') {
      finaliseUserReadsForSession(data, sessionId, currentUserId)
    }

    delete data.endSessionTemp

    // Nothing was recorded, so there is nothing to keep: the session is
    // discarded rather than left as an empty overview and a blank history row
    const sessionAppointments = (session.appointmentIds || [])
      .map((appointmentId) =>
        data.appointments.find((appointment) => appointment.id === appointmentId)
      )
      .filter(Boolean)

    const anythingRecorded = sessionAppointments.some((appointment) =>
      wasWorkedInSession(data, session, appointment, currentUserId)
    )

    if (!anythingRecorded) {
      delete data.readingSessions[sessionId]
      req.flash('success', 'Session ended')
      return res.redirect(modalBreakout('/reading'))
    }

    endSession(data, sessionId, currentUserId)

    // No flash: the session overview leads with a "Session ended" panel that
    // says what was recorded and whether it finalised

    res.redirect(modalBreakout(sessionOverviewUrl(session)))
  })

  // Route for viewing a reading session with a specific view. Arbitration
  // sessions never reach here - they render their own overview above.
  router.get('/reading/session/:sessionId/:view', (req, res) => {
    const data = req.session.data
    const { sessionId, view } = req.params
    const validViews = ['your-reads', 'all-reads']

    // Validate view parameter
    const selectedView = validViews.includes(view) ? view : 'your-reads'

    const session = getReadingSession(data, sessionId)
    if (!session) {
      return res.redirect('/reading')
    }

    if (session.type === 'arbitration') {
      return res.redirect(`/reading/session/${sessionId}`)
    }

    renderSessionOverview(req, res, session, selectedView)
  })

  // Build the session overview's view model and render the template that suits
  // the session type. Reading gets tabbed per-user views; arbitration gets one
  // list, because a case is arbitrated once for everyone.
  const renderSessionOverview = (req, res, session, selectedView) => {
    const data = req.session.data
    const sessionId = session.id
    const isArbitration = session.type === 'arbitration'

    // The overview reflects the state of the session's cases, so it must not be
    // served from the browser's cache - the same reason the case pages say so.
    // It is the page a reader goes back to, and a restored copy would show the
    // session as it was before they worked any of it.
    res.set('Cache-Control', 'no-store, must-revalidate')

    // Get enhanced appointments with reading metadata
    const enhancedAppointments = session.appointmentIds
      .map((appointmentId) =>
        data.appointments.find((e) => e.id === appointmentId)
      )
      .filter(Boolean)
      .map((appointment) => {
        // Add participant data, the reading case, and its metadata
        const participant = data.participants.find(
          (p) => p.id === appointment.participantId
        )
        const readingCase = getReadingCase(data, appointment)

        return {
          ...appointment,
          participant,
          readingCase,
          readingMetadata: getReadingMetadata(readingCase, data.settings)
        }
      })

    // Get reading status for the session
    const readingStatus = getReadingStatusForAppointments(
      data,
      enhancedAppointments,
      data.currentUser.id
    )

    // Arbitration settles a case for everyone, so its progress is how many of
    // the session's cases have been arbitrated - not what any one user has done
    const arbitratedCount = enhancedAppointments.filter((appointment) =>
      caseHasBeenArbitrated(appointment.readingCase)
    ).length

    // Whether the reader has begun this session - what tells "Start" from
    // "Resume". Any work on a case counts, not just a decision: skipping,
    // deferring and asking for priors are all ways of having started.
    const sessionStarted =
      (session.skippedAppointments || []).length > 0 ||
      enhancedAppointments.some((appointment) =>
        wasWorkedInSession(data, session, appointment, data.currentUser.id)
      )

    const sessionProgress = getSessionReadingProgress(
      data,
      sessionId,
      null,
      data.currentUser.id
    )

    // A session that has run out of work is over, and this is where that gets
    // recorded for a session the reader never walked to the end of. Judged on
    // the target rather than on what's loaded, so a lazy session that could
    // still top up isn't ended prematurely.
    if (
      isSessionEndable(session) &&
      !isSessionEnded(session) &&
      sessionProgress?.targetRemaining === 0
    ) {
      endSession(data, sessionId, data.currentUser.id)
    }

    const sessionEnded = isSessionEnded(session)

    // Find where the user should resume — first readable after the furthest
    // point they've reached (reads or skips), falling back to first readable.
    // An ended session has nowhere to resume to.
    const resumeAppointment = sessionEnded
      ? null
      : getResumeAppointmentForUser(
          data,
          enhancedAppointments,
          data.currentUser.id,
          session.skippedAppointments || [],
          session
        )

    // The user's reads still awaiting finalisation, and when the first will
    // finalise itself - drives the session-complete panel's finalise prompt
    const { unfinalisedReads: unconfirmedReads, autoFinaliseAt } =
      getSessionFinalisationInfo(data, sessionId, data.currentUser.id)

    // Clear any lingering opinion banner from a previous session
    delete data.readingOpinionBanner

    // Get clinic data if this is a clinic session
    let clinic = null
    if (session.clinicId) {
      clinic = getClinic(data, session.clinicId)
    }

    // Overall backlog count — used to gate the 'Start a new session' button, so
    // it counts the work a new session of *this* type would draw on. For
    // reading that's cases the user can read (not already read by them, not
    // fully read by others, not deferred or awaiting priors); for arbitration
    // it's the cases they'd be eligible to arbitrate.
    const backlogTotal = isArbitration
      ? getEligibleCandidatesForSession(data, { type: 'arbitration' }).length
      : filterAppointmentsByUserCanRead(
          data,
          filterAppointmentsByEligibleForReading(data.appointments),
          data.currentUser.id
        ).length

    // An ended session shows the work that was done in it. Cases it had loaded
    // but nobody got to were never part of that work - they went back to the
    // queue, and the panel counts them there.
    const listedAppointments = sessionEnded
      ? enhancedAppointments.filter((appointment) =>
          wasWorkedInSession(data, session, appointment, data.currentUser.id)
        )
      : enhancedAppointments

    res.render(
      isArbitration ? 'reading/arbitration/session' : 'reading/session',
      {
        session,
        appointments: listedAppointments,
        readingStatus,
        sessionProgress,
        resumeAppointment,
        autoFinaliseAt,
        arbitratedCount,
        sessionStarted,
        unfinalisedReadCount: unconfirmedReads.length,
        sessionEnded,
        canEndSessionEarly: canEndSessionEarly(session),
        clinic,
        backlogTotal,
        view: selectedView
      }
    )
  }

  // Middleware to make sure pages have the right data
  router.use(
    '/reading/session/:sessionId/appointments/:appointmentId',
    (req, res, next) => {
      const data = req.session.data
      const { sessionId, appointmentId } = req.params
      const currentUserId = data.currentUser?.id

      // Reading pages reflect a case's current state, so they must not be served
      // from the browser's cache. Without this, going back to a step page after
      // finishing a case restores the stale page from the back/forward cache -
      // no request is made, so the redirect guarding those steps never runs, and
      // the reader is shown a confirmation for a decision already recorded.
      res.set('Cache-Control', 'no-store, must-revalidate')

      // Get the batch
      const session = getReadingSession(data, sessionId)
      if (!session) {
        // req.flash('error', 'Session not found')
        console.log('Session not found')
        return res.redirect('/reading')
      }

      // An ended session takes no more reads, however its cases are reached -
      // a bookmarked URL, or the back button after ending
      if (isSessionEnded(session)) {
        return res.redirect(`/reading/session/${sessionId}`)
      }

      // Check if appointment exists in this session
      if (!session.appointmentIds.includes(appointmentId)) {
        // req.flash('error', 'Appointment not found in this session')
        console.log(
          `Appointment ${appointmentId} not found in session ${sessionId}`
        )
        return res.redirect(`/reading/session/${sessionId}`)
      }

      // Get the appointment data
      const appointment = getAppointment(data, appointmentId)
      if (!appointment) {
        // req.flash('error', 'Appointment not found')
        console.log(`Appointment ${appointmentId} not found`)
        return res.redirect(`/reading/session/${sessionId}`)
      }

      // Get participant and clinic data
      const participant = getParticipant(data, appointment.participantId)
      const clinic = getClinic(data, appointment.clinicId)
      const unit = data.breastScreeningUnits.find(
        (u) => u.id === clinic.breastScreeningUnitId
      )
      const location = unit.locations.find((l) => l.id === clinic.locationId)

      // Get reading progress for this session
      const progress = getSessionReadingProgress(data, sessionId, appointmentId)

      // Initialise or update imageReadingTemp for this appointment
      // Only do this on GET requests - POST requests should preserve form data
      if (req.method === 'GET') {
        if (
          !data.imageReadingTemp ||
          data.imageReadingTemp.appointmentId !== appointmentId
        ) {
          // In arbitration the read being amended is the case's arbitration
          // read, not the current user's own - a panel member may also have
          // read this case as first or second reader
          const readingCaseForTemp = getReadingCase(data, appointment)
          const existingRead =
            session.type === 'arbitration'
              ? getArbitrationRead(readingCaseForTemp)
              : getReadForUser(readingCaseForTemp, currentUserId)

          if (existingRead) {
            // User has already read this appointment - populate temp from saved read
            console.log(
              `Loading existing read for appointment ${appointmentId} into imageReadingTemp`
            )
            data.imageReadingTemp = {
              appointmentId: appointmentId,
              ...existingRead
            }
          } else {
            // No existing read - initialise empty temp with appointmentId
            console.log(
              `Initialising imageReadingTemp for appointment ${appointmentId}`
            )
            data.imageReadingTemp = { appointmentId: appointmentId }
          }
          // Update res.locals.data to reflect the change (it was set before this middleware)
          res.locals.data.imageReadingTemp = data.imageReadingTemp
        }

        // Pass along opinion banner and remove from session
        // Bypassing req.flash as we couldn't get it to work - possibly due to redirect loops
        // Not great we're hardcoding these pages. Would be better to have a more general mechanism.
        if (
          (req.path.endsWith('/opinion') ||
            req.path.endsWith('/outcome') ||
            req.path.endsWith('/existing-read')) &&
          data.readingOpinionBanner
        ) {
          res.locals.readingOpinionBanner = data.readingOpinionBanner
          delete data.readingOpinionBanner
        }
      }

      // Set up locals for templates. The case is resolved once here so the
      // workflow templates can work in reading-case terms without each of them
      // walking back to the episode
      res.locals.isReadingWorkflow = true
      res.locals.isArbitration = session.type === 'arbitration'

      // The step where the case is decided. Arbitration decides an outcome,
      // reading gives an opinion, and each has its own page and URL
      res.locals.decisionStep =
        session.type === 'arbitration' ? 'outcome' : 'opinion'

      // Reaching a case in an arbitration session is the act that releases it.
      // Lazy sessions bring cases in one at a time, so this is where release
      // happens rather than over the whole backlog at session creation.
      if (session.type === 'arbitration') {
        const caseToRelease = getReadingCase(data, appointment)
        if (caseToRelease && !caseToRelease.arbitration?.releasedAt) {
          updateReadingCase(
            data,
            appointment.episodeId,
            withArbitrationRelease(caseToRelease, currentUserId)
          )
        }
      }

      res.locals.readingCase = getReadingCase(data, appointment)
      res.locals.session = session
      res.locals.appointmentData = {
        clinic,
        appointment,
        participant,
        unit,
        location
      }
      res.locals.clinic = clinic
      res.locals.appointment = appointment
      res.locals.participant = participant
      res.locals.unit = unit
      res.locals.location = location
      res.locals.sessionId = sessionId
      res.locals.appointmentId = appointmentId
      res.locals.progress = progress

      next()
    }
  )

  // Route for appointment reading within a batch
  // Redirects to existing-read if user has already read, otherwise to opinion
  router.get(
    '/reading/session/:sessionId/appointments/:appointmentId',
    (req, res) => {
      const data = req.session.data
      const { sessionId, appointmentId } = req.params
      const currentUserId = data.currentUser?.id

      // Find the appointment
      const appointment = data.appointments.find((e) => e.id === appointmentId)
      if (!appointment) {
        return res.redirect(`/reading/session/${sessionId}`)
      }

      // Returning to a case that has already been done shows what was recorded,
      // rather than starting the flow again. In arbitration that means the
      // arbitration read - a panel member's own earlier read as first or second
      // reader isn't the thing this session is here to do.
      const session = getReadingSession(data, sessionId)
      const isArbitrationSession = session?.type === 'arbitration'
      const alreadyDone = isArbitrationSession
        ? appointmentHasBeenArbitrated(data, appointment)
        : userHasReadAppointment(data, appointment, currentUserId)

      if (alreadyDone) {
        return res.redirect(
          `/reading/session/${sessionId}/appointments/${appointmentId}/existing-read`
        )
      }

      // Check if appointment is awaiting priors (user or someone else requested)
      if (awaitingPriors(appointment)) {
        return res.redirect(
          `/reading/session/${sessionId}/appointments/${appointmentId}/existing-read`
        )
      }

      // Check if appointment has been deferred from reading
      if (isCaseDeferred(getReadingCase(data, appointment))) {
        return res.redirect(
          `/reading/session/${sessionId}/appointments/${appointmentId}/existing-read`
        )
      }

      // Delete temporary data from previous steps
      delete data.imageReadingTemp

      res.redirect(caseDecisionUrl(data, sessionId, appointmentId))
    }
  )

  // Finalise this one case early, from the existing-read page. Redirects back
  // to that page so the change is visible in place.
  router.all(
    '/reading/session/:sessionId/appointments/:appointmentId/finalise-read',
    (req, res) => {
      const data = req.session.data
      const { sessionId, appointmentId } = req.params
      const currentUserId = data.currentUser?.id
      const backHref = `/reading/session/${sessionId}/appointments/${appointmentId}/existing-read`

      const appointment = data.appointments.find(
        (candidate) => candidate.id === appointmentId
      )
      if (!appointment) {
        return res.redirect(`/reading/session/${sessionId}`)
      }

      const readingCase = getReadingCase(data, appointment)
      const session = getReadingSession(data, sessionId)
      const isArbitrationSession = session?.type === 'arbitration'

      // The read this page is about - the case's arbitration read in an
      // arbitration session, otherwise the user's own
      const read = isArbitrationSession
        ? getArbitrationRead(readingCase)
        : getReadForUser(readingCase, currentUserId)

      if (!read || isReadFinalised(read, data.settings)) {
        return res.redirect(backHref)
      }

      finaliseReadOnCase(data, appointment, readingCase, currentUserId)

      req.flash(
        'success',
        isArbitrationSession ? 'Outcome finalised' : 'Read finalised'
      )

      res.redirect(backHref)
    }
  )

  // Handle skipping an appointment in a batch
  router.get(
    '/reading/session/:sessionId/appointments/:appointmentId/skip',
    (req, res) => {
      const data = req.session.data
      const { sessionId, appointmentId } = req.params

      // Mark as skipped
      skipAppointmentInSession(data, sessionId, appointmentId)

      // Top up the batch with the next eligible appointment if under target size
      topUpSession(data, sessionId, appointmentId)

      // Find next readable appointment after current position (no wrap)
      const currentUserId = data.currentUser.id
      const session = getReadingSession(data, sessionId)
      const sessionAppointments = session.appointmentIds
        .map((id) => data.appointments.find((e) => e.id === id))
        .filter(Boolean)

      const nextUnreadAppointment = getNextCaseInSession(
        data,
        session,
        sessionAppointments,
        appointmentId,
        currentUserId
      )

      if (nextUnreadAppointment) {
        res.redirect(
          `/reading/session/${sessionId}/appointments/${nextUnreadAppointment.id}`
        )
      } else if (session.skippedAppointments.length > 0) {
        res.redirect(`/reading/session/${sessionId}/skipped-review`)
      } else {
        // Check if there are any readable cases left in the session
        const firstReadable = getFirstOutstandingCaseInSession(
          data,
          session,
          sessionAppointments,
          currentUserId
        )
        if (firstReadable) {
          res.redirect(`/reading/session/${sessionId}`)
        } else {
          res.redirect(`/reading/session/${sessionId}/no-more-cases`)
        }
      }
    }
  )

  // Move on from a case that is already settled - the "Next case" link on the
  // workflow navigation. Asking the session where to go next (rather than
  // linking straight at an appointment) is what lets a lazy session grow: the
  // reader gets a new case rather than looping back through finished ones.
  router.get(
    '/reading/session/:sessionId/appointments/:appointmentId/next-case',
    (req, res) => {
      const data = req.session.data
      const { sessionId, appointmentId } = req.params

      res.redirect(onwardFromCase(data, sessionId, appointmentId))
    }
  )

  // Handle requesting prior images during reading
  router.post(
    '/reading/session/:sessionId/appointments/:appointmentId/request-priors-answer',
    (req, res) => {
      const data = req.session.data
      const { sessionId, appointmentId } = req.params
      const currentUserId = data.currentUser?.id

      // Get the IDs of mammograms to request
      let requestPriorIds = req.body.requestPriorIds || []
      if (!Array.isArray(requestPriorIds)) {
        requestPriorIds = [requestPriorIds]
      }

      const reason = req.body.requestPriorReason || ''

      // Find the appointment in the main appointments array
      const appointment = data.appointments.find((e) => e.id === appointmentId)
      if (appointment && appointment.previousMammograms) {
        // Build an updated list rather than mutating in place - appointment records
        // are shared read-only data; writes go through the update helpers
        const previousMammograms = appointment.previousMammograms.map(
          (mammogram) =>
            requestPriorIds.includes(mammogram.id)
              ? {
                  ...mammogram,
                  requestStatus: 'pending',
                  requestedDate: new Date().toISOString(),
                  requestedBy: currentUserId,
                  requestReason: reason
                }
              : mammogram
        )

        // Saves to the appointment and mirrors into data.appointment if it matches
        updateAppointmentData(data, appointmentId, { previousMammograms })
      }

      // If submitted from an existing-read page (e.g. editing reason), return there
      const priorsReferrerChain = req.query.referrerChain
      if (priorsReferrerChain) {
        // In edit mode, also update reason on mammograms already pending/requested by this user
        if (appointment && appointment.previousMammograms) {
          const latestAppointment = data.appointments.find(
            (e) => e.id === appointmentId
          )
          const previousMammograms = latestAppointment.previousMammograms.map(
            (mammogram) =>
              (mammogram.requestStatus === 'pending' ||
                mammogram.requestStatus === 'requested') &&
              mammogram.requestedBy === currentUserId
                ? { ...mammogram, requestReason: reason }
                : mammogram
          )
          updateAppointmentData(data, appointmentId, { previousMammograms })
        }
        const returnUrl = getReturnUrl(
          `/reading/session/${sessionId}/appointments/${appointmentId}/existing-read`,
          priorsReferrerChain
        )
        res.redirect(modalBreakout(returnUrl))
        return
      }

      // Requesting priors settles what happens to this case for now, so it is
      // no longer waiting to be come back to
      unskipAppointmentInSession(data, sessionId, appointmentId)

      // Top up the batch with the next eligible appointment if under target size
      topUpSession(data, sessionId, appointmentId)

      // Find next readable appointment in batch after the current position, wrapping
      // to the start if needed. This mirrors the navigation in save-opinion.
      const session = getReadingSession(data, sessionId)
      const sessionAppointments = session.appointmentIds
        .map((id) => data.appointments.find((e) => e.id === id))
        .filter(Boolean)
      const nextUnreadAppointment = getNextCaseInSession(
        data,
        session,
        sessionAppointments,
        appointmentId,
        currentUserId
      )

      // Only store the banner if there is a next case to show it on
      if (nextUnreadAppointment) {
        const participant = data.participants.find(
          (person) => person.id === appointment.participantId
        )
        const shortName = getShortName(participant)
        data.readingOpinionBanner = {
          text: `Prior images requested for ${shortName}`,
          participantName: `${shortName}`,
          editHref: `/reading/session/${sessionId}/appointments/${appointmentId}/existing-read`
        }
        res.redirect(
          modalBreakout(
            `/reading/session/${sessionId}/appointments/${nextUnreadAppointment.id}`
          )
        )
      } else if (session.skippedAppointments.length > 0) {
        res.redirect(
          modalBreakout(`/reading/session/${sessionId}/skipped-review`)
        )
      } else {
        // Check if there are any readable cases left in the session
        const firstReadable = getFirstOutstandingCaseInSession(
          data,
          session,
          sessionAppointments,
          currentUserId
        )
        if (firstReadable) {
          res.redirect(modalBreakout(`/reading/session/${sessionId}`))
        } else {
          res.redirect(
            modalBreakout(`/reading/session/${sessionId}/no-more-cases`)
          )
        }
      }
    }
  )

  // Undo prior image requests - resets mammograms requested by current user
  // back to not_requested, allowing the reader to read the case
  // Supports GET (summary list action link) and POST
  router.all(
    '/reading/session/:sessionId/appointments/:appointmentId/undo-priors',
    (req, res) => {
      const data = req.session.data
      const { sessionId, appointmentId } = req.params
      const currentUserId = data.currentUser?.id

      const appointment = data.appointments.find((e) => e.id === appointmentId)
      if (appointment && appointment.previousMammograms) {
        // Build an updated list rather than mutating in place - appointment records
        // are shared read-only data; writes go through the update helpers
        const previousMammograms = appointment.previousMammograms.map(
          (mammogram) => {
            if (
              mammogram.requestStatus === 'pending' &&
              mammogram.requestedBy === currentUserId
            ) {
              // Omit the request fields entirely on the replacement record
              const { requestedDate, requestedBy, requestReason, ...rest } =
                mammogram
              return { ...rest, requestStatus: 'not_requested' }
            }
            return mammogram
          }
        )

        // Saves to the appointment and mirrors into data.appointment if it matches
        updateAppointmentData(data, appointmentId, { previousMammograms })
      }

      // Redirect to the decision page so the reader can now read the case
      res.redirect(caseDecisionUrl(data, sessionId, appointmentId))
    }
  )

  /************************************************************************
  // Case deferral
  /***********************************************************************/

  // Handle deferring a case from reading
  router.post(
    '/reading/session/:sessionId/appointments/:appointmentId/defer-case-answer',
    (req, res) => {
      const data = req.session.data
      const { sessionId, appointmentId } = req.params
      const currentUserId = data.currentUser?.id

      const reason = req.body.deferralReason || ''

      // Find the appointment and save deferral data. Work on a clone rather than
      // mutating in place - appointment records are shared read-only data; writes
      // go through the update helpers
      const appointment = data.appointments.find((e) => e.id === appointmentId)
      const readingCase = getReadingCase(data, appointment)
      if (readingCase) {
        // Deferring withdraws any opinion this user had already given - they're
        // saying they can't judge this case after all
        const updatedCase = {
          ...withoutRead(readingCase, currentUserId),
          deferral: {
            deferredAt: new Date().toISOString(),
            deferredBy: currentUserId,
            reason: reason || null
          }
        }

        updateReadingCase(data, appointment.episodeId, updatedCase)
      }

      // If submitted from an existing-read page (e.g. editing reason), return there
      const referrerChain = req.query.referrerChain
      if (referrerChain) {
        const returnUrl = getReturnUrl(
          `/reading/session/${sessionId}/appointments/${appointmentId}/existing-read`,
          referrerChain
        )
        res.redirect(modalBreakout(returnUrl))
        return
      }

      // A deferred case is settled for now, so it is no longer waiting to be
      // come back to
      unskipAppointmentInSession(data, sessionId, appointmentId)

      // Top up the session with the next eligible appointment if under target size
      topUpSession(data, sessionId, appointmentId)

      // Find next readable appointment after current position
      const session = getReadingSession(data, sessionId)
      const sessionAppointments = session.appointmentIds
        .map((id) => data.appointments.find((e) => e.id === id))
        .filter(Boolean)
      const nextUnreadAppointment = getNextCaseInSession(
        data,
        session,
        sessionAppointments,
        appointmentId,
        currentUserId
      )

      // Show a banner on the next case if there is one
      if (nextUnreadAppointment) {
        const participant = data.participants.find(
          (person) => person.id === appointment?.participantId
        )
        const shortName = getShortName(participant)
        data.readingOpinionBanner = {
          text: `Case deferred for ${shortName}`,
          participantName: shortName,
          editHref: `/reading/session/${sessionId}/appointments/${appointmentId}/existing-read`
        }
        res.redirect(
          modalBreakout(
            `/reading/session/${sessionId}/appointments/${nextUnreadAppointment.id}`
          )
        )
      } else if (session.skippedAppointments.length > 0) {
        res.redirect(
          modalBreakout(`/reading/session/${sessionId}/skipped-review`)
        )
      } else {
        // Check if there are any readable cases left in the session
        const firstReadable = getFirstOutstandingCaseInSession(
          data,
          session,
          sessionAppointments,
          currentUserId
        )
        if (firstReadable) {
          res.redirect(modalBreakout(`/reading/session/${sessionId}`))
        } else {
          res.redirect(
            modalBreakout(`/reading/session/${sessionId}/no-more-cases`)
          )
        }
      }
    }
  )

  // Undo a case deferral — removes the deferral so the case returns to reading
  router.all(
    '/reading/session/:sessionId/appointments/:appointmentId/undo-defer',
    (req, res) => {
      const data = req.session.data
      const { sessionId, appointmentId } = req.params

      const appointment = data.appointments.find((e) => e.id === appointmentId)
      const readingCase = getReadingCase(data, appointment)
      if (isCaseDeferred(readingCase)) {
        const { deferral, ...withoutDeferral } = readingCase
        updateReadingCase(data, appointment.episodeId, withoutDeferral)
      }

      res.redirect(caseDecisionUrl(data, sessionId, appointmentId))
    }
  )

  // Deferred cases management page
  router.get('/reading/deferred', (req, res) => {
    res.render('reading/deferred')
  })

  // Unflag a deferral from the deferred cases management page
  // Keeps a record of the resolved deferral so the reason stays visible
  router.post('/reading/deferred/undo', (req, res) => {
    const data = req.session.data
    const { appointmentId } = req.body

    const appointment = data.appointments.find((e) => e.id === appointmentId)
    const readingCase = getReadingCase(data, appointment)
    if (isCaseDeferred(readingCase)) {
      const { deferral, ...withoutDeferral } = readingCase

      updateReadingCase(data, appointment.episodeId, {
        ...withoutDeferral,
        deferralHistory: [
          ...(readingCase.deferralHistory || []),
          {
            ...deferral,
            resolvedAt: new Date().toISOString(),
            resolvedBy: data.currentUser?.id
          }
        ]
      })

      const participant = data.participants.find(
        (p) => p.id === appointment.participantId
      )
      const shortName = getShortName(participant)
      req.flash('success', `${shortName} returned to reading queue`)
    }

    // returnTo lets the case page reuse this action and land back there
    const returnTo = req.body.returnTo
    if (returnTo && returnTo.startsWith('/')) {
      return res.redirect(returnTo)
    }
    res.redirect('/reading/deferred')
  })

  // Render appropriate template for reading views
  router.get(
    '/reading/session/:sessionId/appointments/:appointmentId/:step',
    (req, res, next) => {
      const { sessionId, appointmentId, step } = req.params

      // Workflow steps (in reading/workflow/ folder)
      const workflowSteps = [
        'opinion',
        'normal-details',
        'confirm-normal',
        'technical-recall',
        'recall-for-assessment-details',
        'annotation',
        'annotate-v2',
        'confirm-abnormal',
        'recommended-assessment',
        'review',
        'existing-read',
        'compare',
        'arbitration-reads',
        'request-priors',
        'defer-case',
        'medical-information'
      ]

      // Steps that only make sense while a case is still being decided. Once it
      // has been, they are stale: the confirmation pages would offer to save a
      // decision already recorded, and the detail pages would collect details
      // for it. The case URL already sends finished cases to existing-read -
      // these are the same door, further in, reachable by back-navigation.
      //
      // Editing is the exception, and says so with a referrer chain: those
      // journeys deliberately reopen a finished case, and must be let through.
      const stepsRequiringUnfinishedCase = [
        'opinion',
        'outcome',
        'normal-details',
        'confirm-normal',
        'technical-recall',
        'recall-for-assessment-details',
        'confirm-abnormal',
        'recommended-assessment',
        'review',
        'compare',
        'arbitration-reads'
      ]

      if (
        stepsRequiringUnfinishedCase.includes(step) &&
        !req.query.referrerChain
      ) {
        const data = req.session.data
        const appointment = data.appointments.find(
          (candidate) => candidate.id === appointmentId
        )
        const session = getReadingSession(data, sessionId)
        const caseIsSettled = appointment
          ? session?.type === 'arbitration'
            ? appointmentHasBeenArbitrated(data, appointment)
            : userHasReadAppointment(data, appointment, data.currentUser?.id)
          : false

        if (caseIsSettled) {
          return res.redirect(
            `/reading/session/${sessionId}/appointments/${appointmentId}/existing-read`
          )
        }
      }

      // Arbitration decides an outcome rather than giving an opinion, on its
      // own page (the original reads sit alongside the case) at its own URL.
      // Each session type redirects to the step that is really its own, so a
      // link to the other still lands somewhere sensible.
      if (step === 'outcome' || step === 'opinion') {
        const wantsOutcome = res.locals.isArbitration
        const correctStep = wantsOutcome ? 'outcome' : 'opinion'

        if (step !== correctStep) {
          const query = req.originalUrl.includes('?')
            ? req.originalUrl.slice(req.originalUrl.indexOf('?'))
            : ''
          return res.redirect(
            `/reading/session/${sessionId}/appointments/${appointmentId}/${correctStep}${query}`
          )
        }

        if (wantsOutcome) {
          return res.render('reading/workflow/arbitration-outcome')
        }
      }

      if (workflowSteps.includes(step)) {
        return res.render(`reading/workflow/${step}`)
      }

      return next()
    }
  )

  // Annotations start

  // Add annotation - clear temp data and redirect to form
  router.get(
    '/reading/session/:sessionId/appointments/:appointmentId/annotation/add',
    (req, res) => {
      const { side } = req.query
      const data = req.session.data

      // Validate side parameter
      if (!side || !['left', 'right'].includes(side)) {
        return res.redirect(
          `/reading/session/${req.params.sessionId}/appointments/${req.params.appointmentId}/recall-for-assessment-details`
        )
      }

      // Clear any existing temp annotation data
      delete data.imageReadingTemp?.annotationTemp

      // Set the side in temp data
      if (!data.imageReadingTemp) {
        data.imageReadingTemp = {}
      }

      // Calculate annotation number (next in sequence)
      const leftAnnotations = data.imageReadingTemp?.left?.annotations || []
      const rightAnnotations = data.imageReadingTemp?.right?.annotations || []
      const totalAnnotations = leftAnnotations.length + rightAnnotations.length
      const annotationNumber = totalAnnotations + 1

      // Pre-populate abnormality type if passed from per-type button
      const { abnormalityType } = req.query

      data.imageReadingTemp.annotationTemp = {
        side: side,
        annotationNumber: annotationNumber,
        abnormalityTypes: abnormalityType ? [abnormalityType] : undefined
      }

      res.redirect(
        `/reading/session/${req.params.sessionId}/appointments/${req.params.appointmentId}/annotation`
      )
    }
  )

  // Edit existing annotation
  router.get(
    '/reading/session/:sessionId/appointments/:appointmentId/annotation/edit/:annotationId',
    (req, res) => {
      const { sessionId, appointmentId, annotationId } = req.params
      const data = req.session.data

      // Find the annotation to edit and its number
      let annotation = null
      let annotationNumber = 1
      const sides = ['left', 'right']

      // Build ordered list of all annotations to find the number
      const leftAnnotations = data.imageReadingTemp?.left?.annotations || []
      const rightAnnotations = data.imageReadingTemp?.right?.annotations || []
      const allAnnotations = [...leftAnnotations, ...rightAnnotations]

      for (let index = 0; index < allAnnotations.length; index++) {
        if (allAnnotations[index].id === annotationId) {
          annotation = allAnnotations[index]
          annotationNumber = index + 1
          break
        }
      }

      if (annotation) {
        // Copy annotation to temp for editing
        data.imageReadingTemp.annotationTemp = {
          ...annotation,
          annotationNumber: annotationNumber
        }
      }

      // Always use the unified annotation page
      res.redirect(
        `/reading/session/${sessionId}/appointments/${appointmentId}/annotation`
      )
    }
  )

  // Save annotation - handles both 'save' and 'save-and-add'
  router.post(
    '/reading/session/:sessionId/appointments/:appointmentId/annotation/save',
    (req, res) => {
      const { sessionId, appointmentId } = req.params
      const data = req.session.data
      const action = req.body.action || 'save'

      // Parse positions if they came in as a string
      if (
        data.imageReadingTemp.annotationTemp.positions &&
        typeof data.imageReadingTemp.annotationTemp.positions === 'string'
      ) {
        try {
          data.imageReadingTemp.annotationTemp.positions = JSON.parse(
            data.imageReadingTemp.annotationTemp.positions
          )
        } catch (e) {
          console.warn('Failed to parse incoming positions:', e)
        }
      }

      // Validation
      const errors = []
      const annotationTemp = data.imageReadingTemp?.annotationTemp
      const isImageMode = req.body.showImages === 'true'

      if (!annotationTemp) {
        return res.redirect(
          `/reading/session/${sessionId}/appointments/${appointmentId}/recall-for-assessment-details`
        )
      }

      // Mode-specific validation
      if (isImageMode) {
        // Validate that positions are set for at least one view
        if (
          !annotationTemp.positions ||
          annotationTemp.positions === '{}' ||
          annotationTemp.positions === ''
        ) {
          errors.push({
            text: `Mark the location on at least one ${annotationTemp.side} breast view`,
            name: 'positions',
            href: '#mammogram-section'
          })
        } else {
          try {
            const positions =
              typeof annotationTemp.positions === 'string'
                ? JSON.parse(annotationTemp.positions)
                : annotationTemp.positions

            if (!positions || Object.keys(positions).length === 0) {
              errors.push({
                text: `Mark the location on at least one ${annotationTemp.side} breast view`,
                name: 'positions',
                href: '#mammogram-section'
              })
            }
          } catch (e) {
            errors.push({
              text: `Mark the location on at least one ${annotationTemp.side} breast view`,
              name: 'positions',
              href: '#mammogram-section'
            })
          }
        }
      } else {
        // Text location required when no images
        if (!annotationTemp.location || annotationTemp.location.trim() === '') {
          errors.push({
            text: 'Enter a location for the abnormality',
            name: 'imageReadingTemp[annotationTemp][location]',
            href: '#location'
          })
        }
      }

      if (
        !annotationTemp.abnormalityTypes ||
        annotationTemp.abnormalityTypes.length === 0
      ) {
        errors.push({
          text: 'Select at least one abnormality type',
          name: 'imageReadingTemp[annotationTemp][abnormalityTypes]',
          href: '#abnormalityTypes'
        })
      }

      if (!annotationTemp.levelOfConcern) {
        errors.push({
          text: 'Select a level of concern',
          name: 'imageReadingTemp[annotationTemp][levelOfConcern]',
          href: '#levelOfConcern'
        })
      }

      // Validate conditional detail fields for selected abnormality types
      if (
        annotationTemp.abnormalityTypes &&
        annotationTemp.abnormalityTypes.length > 0
      ) {
        const abnormalityTypes = Array.isArray(annotationTemp.abnormalityTypes)
          ? annotationTemp.abnormalityTypes
          : [annotationTemp.abnormalityTypes]

        abnormalityTypes.forEach((type) => {
          if (
            type === 'Other' &&
            (!annotationTemp.otherDetails ||
              annotationTemp.otherDetails.trim() === '')
          ) {
            errors.push({
              text: 'Provide details for other abnormality type',
              name: 'imageReadingTemp[annotationTemp][otherDetails]',
              href: '#otherDetails'
            })
          }

          // Check other conditional fields using the same camelCase logic as the template
          // const conditionalTypes = [
          //   'Mass well-defined',
          //   'Mass ill-defined',
          //   'Architectural distortion',
          //   'Asymetric density',
          //   'Microcalcification outside a mass',
          //   'Clinical abnormality',
          //   'Lymph node abnormality'
          // ]

          // if (conditionalTypes.includes(type)) {
          //   const detailsFieldName = camelCase(type) + 'Details'

          //   if (!annotationTemp[detailsFieldName] || annotationTemp[detailsFieldName].trim() === '') {
          //     errors.push({
          //       text: `Provide details for ${type.toLowerCase()}`,
          //       name: `imageReadingTemp[annotationTemp][${detailsFieldName}]`,
          //       href: `#${detailsFieldName}`
          //     })
          //   }
          // }
        })
      }

      // If there are validation errors, redirect back with errors
      if (errors.length > 0) {
        errors.forEach((error) => req.flash('error', error))
        return res.redirect(
          `/reading/session/${sessionId}/appointments/${appointmentId}/annotation`
        )
      }

      // Continue with existing save logic...
      if (data.imageReadingTemp?.annotationTemp) {
        const side = annotationTemp.side
        const comment = annotationTemp.comment
        const isNewAnnotation = !annotationTemp.id

        if (!side) {
          return res.redirect(
            `/reading/session/${sessionId}/appointments/${appointmentId}/recall-for-assessment-details`
          )
        }

        // Initialize side data if needed
        if (!data.imageReadingTemp[side]) {
          data.imageReadingTemp[side] = {}
        }
        if (!data.imageReadingTemp[side].annotations) {
          data.imageReadingTemp[side].annotations = []
        }

        // Ensure breast assessment is set to abnormal — the fire-and-forget fetch
        // from the radio change can race with this POST and lose its session write
        if (!data.imageReadingTemp[side].breastAssessment) {
          data.imageReadingTemp[side].breastAssessment = 'abnormal'
        }

        // Parse positions if provided
        let positions = null
        if (annotationTemp.positions) {
          try {
            positions =
              typeof annotationTemp.positions === 'string'
                ? JSON.parse(annotationTemp.positions)
                : annotationTemp.positions
          } catch (e) {
            console.warn('Failed to parse positions:', e)
          }
        }

        // Create annotation object
        const annotation = {
          id: annotationTemp.id || generateId(),
          side: side,
          comment: comment,
          location: annotationTemp.location,
          abnormalityTypes: annotationTemp.abnormalityTypes,
          levelOfConcern: annotationTemp.levelOfConcern,
          positions: positions,
          // Include any conditional detail fields
          ...Object.keys(annotationTemp)
            .filter((key) => key.endsWith('Details'))
            .reduce((acc, key) => {
              acc[key] = annotationTemp[key]
              return acc
            }, {})
        }

        // Update existing or add new
        const existingIndex = data.imageReadingTemp[side].annotations.findIndex(
          (a) => a.id === annotation.id
        )
        if (existingIndex !== -1) {
          data.imageReadingTemp[side].annotations[existingIndex] = annotation
        } else {
          data.imageReadingTemp[side].annotations.push(annotation)
        }

        // Clear temp data
        delete data.imageReadingTemp.annotationTemp

        // Remember which side was last edited so the tab can be activated
        data.imageReadingTemp.lastEditedSide = side
      }

      // Redirect based on action
      if (action === 'save-and-add') {
        const side =
          req.body.side || data.imageReadingTemp?.annotationTemp?.side
        res.redirect(
          `/reading/session/${sessionId}/appointments/${appointmentId}/annotation/add?side=${side}`
        )
      } else {
        res.redirect(
          modalBreakout(
            `/reading/session/${sessionId}/appointments/${appointmentId}/recall-for-assessment-details`
          )
        )
      }
    }
  )

  // Delete annotation
  router.get(
    '/reading/session/:sessionId/appointments/:appointmentId/annotation/delete/:annotationId',
    (req, res) => {
      const { sessionId, appointmentId, annotationId } = req.params
      const data = req.session.data

      // Remove annotation from both sides (we'll find it)
      const sides = ['left', 'right']

      for (const side of sides) {
        if (data.imageReadingTemp?.[side]?.annotations) {
          data.imageReadingTemp[side].annotations = data.imageReadingTemp[
            side
          ].annotations.filter((a) => a.id !== annotationId)
        }
      }

      req.flash('success', 'Annotation deleted')

      res.redirect(
        modalBreakout(
          `/reading/session/${sessionId}/appointments/${appointmentId}/recall-for-assessment-details`
        )
      )
    }
  )

  // Save all annotations from the v2 3-column annotation tool
  router.post(
    '/reading/session/:sessionId/appointments/:appointmentId/annotate-v2/save',
    (req, res) => {
      const { sessionId, appointmentId } = req.params
      const data = req.session.data

      let allAnnotations = []
      try {
        allAnnotations = JSON.parse(req.body.annotationsJson || '[]')
      } catch (e) {
        console.warn('annotate-v2/save: failed to parse annotationsJson', e)
      }

      // Split annotations by side and write to imageReadingTemp
      ;['left', 'right'].forEach((side) => {
        const sideAnnotations = allAnnotations.filter((a) => a.side === side)
        if (!data.imageReadingTemp) data.imageReadingTemp = {}
        if (!data.imageReadingTemp[side]) data.imageReadingTemp[side] = {}
        data.imageReadingTemp[side].annotations = sideAnnotations
      })

      res.redirect(
        `/reading/session/${sessionId}/appointments/${appointmentId}/recall-for-assessment-details`
      )
    }
  )

  // Save annotations via fetch (JSON body) — fire-and-forget auto-save from interactive JS.
  // Unlike the annotate-v2/save route, this returns a 200 status instead of redirecting.
  router.post(
    '/reading/session/:sessionId/appointments/:appointmentId/save-annotations-json',
    (req, res) => {
      const data = req.session.data

      let allAnnotations = []
      try {
        allAnnotations = JSON.parse(req.body.annotationsJson || '[]')
      } catch (e) {
        console.warn(
          'save-annotations-json: failed to parse annotationsJson',
          e
        )
        return res.status(400).end()
      }

      // Split annotations by side and write to imageReadingTemp
      ;['left', 'right'].forEach((side) => {
        const sideAnnotations = allAnnotations.filter((a) => a.side === side)
        if (!data.imageReadingTemp) data.imageReadingTemp = {}
        if (!data.imageReadingTemp[side]) data.imageReadingTemp[side] = {}
        data.imageReadingTemp[side].annotations = sideAnnotations
      })

      res.status(200).end()
    }
  )

  // Annotations end

  // Persist a single breast assessment value to imageReadingTemp without a full form submit.
  // Called via fire-and-forget fetch when a radio is selected — ensures the value survives
  // the page reload that follows a modal annotation save.
  router.get(
    '/reading/session/:sessionId/appointments/:appointmentId/save-breast-assessment',
    (req, res) => {
      const { side, value } = req.query
      const data = req.session.data

      if (side && ['left', 'right'].includes(side) && value) {
        if (!data.imageReadingTemp) data.imageReadingTemp = {}
        if (!data.imageReadingTemp[side]) data.imageReadingTemp[side] = {}
        data.imageReadingTemp[side].breastAssessment = value
      }

      res.status(200).end()
    }
  )

  // Handle recall-for-assessment form submission.
  // If the "Add annotation" button was clicked (identified by addAnnotationSide in the body),
  // redirect to the annotation add page for that side. Otherwise, proceed to opinion-details-complete.
  // The prototype kit middleware automatically saves all form data to session on POST,
  // so radio selections are preserved regardless of which button triggered the submit.
  router.post(
    '/reading/session/:sessionId/appointments/:appointmentId/recall-for-assessment-answer',
    (req, res) => {
      const { sessionId, appointmentId } = req.params
      const referrerChain = req.query.referrerChain
      const chainParam = referrerChain
        ? `?referrerChain=${encodeURIComponent(referrerChain)}`
        : ''

      const addAnnotationSide = req.body.addAnnotationSide
      if (addAnnotationSide && ['left', 'right'].includes(addAnnotationSide)) {
        return res.redirect(
          `/reading/session/${sessionId}/appointments/${appointmentId}/annotation/add?side=${addAnnotationSide}`
        )
      }

      // Per-type annotation button — value is "side|abnormality type"
      const addAnnotationSideType = req.body.addAnnotationSideType
      if (addAnnotationSideType) {
        const pipeIndex = addAnnotationSideType.indexOf('|')
        const side =
          pipeIndex > -1
            ? addAnnotationSideType.slice(0, pipeIndex)
            : addAnnotationSideType
        const abnormalityType =
          pipeIndex > -1 ? addAnnotationSideType.slice(pipeIndex + 1) : ''
        if (['left', 'right'].includes(side)) {
          const typeParam = abnormalityType
            ? `&abnormalityType=${encodeURIComponent(abnormalityType)}`
            : ''
          return res.redirect(
            `/reading/session/${sessionId}/appointments/${appointmentId}/annotation/add?side=${side}${typeParam}`
          )
        }
      }

      res.redirect(
        `/reading/session/${sessionId}/appointments/${appointmentId}/opinion-details-complete${chainParam}`
      )
    }
  )

  // Handle technical recall form submission
  // Cleans up the data structure to only include selected views, then redirects to review
  router.post(
    '/reading/session/:sessionId/appointments/:appointmentId/technical-recall-answer',
    (req, res) => {
      const { sessionId, appointmentId } = req.params
      const data = req.session.data

      // Form binding creates:
      // - imageReadingTemp.technicalRecall.selectedViews = ['RMLO', 'LCC'] (checked boxes)
      // - imageReadingTemp.technicalRecall.views.RMLO = { reason: '...', additionalDetails: '...' }
      // - imageReadingTemp.technicalRecall.views.LMLO = { reason: '', additionalDetails: '' } (unchecked but in DOM)
      //
      // We need to filter views to only include those in selectedViews

      const techRecall = data.imageReadingTemp?.technicalRecall || {}
      let selectedViews = techRecall.selectedViews || []
      const allViewData = techRecall.views || {}

      // Normalise to array (single selection comes as string)
      if (typeof selectedViews === 'string') {
        selectedViews = [selectedViews]
      }

      // Validate: at least one view selected, and each selected view has a reason
      const errors = []

      if (selectedViews.length === 0) {
        errors.push({
          text: 'Select at least one view to retake',
          name: 'imageReadingTemp[technicalRecall][selectedViews]',
          href: '#technicalRecall-selectedViews-right-1'
        })
      } else {
        selectedViews.forEach((viewCode) => {
          const viewData = allViewData[viewCode] || {}
          if (!viewData.reason) {
            errors.push({
              text: `Select a reason for the ${viewCode} view`,
              name: `imageReadingTemp[technicalRecall][views][${viewCode}][reason]`,
              href: `#technicalRecall-${viewCode}-reason`
            })
          }
        })
      }

      if (errors.length) {
        const isModal = req.headers['x-requested-with'] === 'XMLHttpRequest'
        if (isModal) {
          return res.status(422).render('reading/workflow/technical-recall', {
            flash: { error: errors }
          })
        }
        errors.forEach((err) => req.flash('error', err))
        return res.redirect(
          `/reading/session/${sessionId}/appointments/${appointmentId}/technical-recall`
        )
      }

      // Build clean views object with only selected views
      const cleanViews = {}
      selectedViews.forEach((viewCode) => {
        if (allViewData[viewCode]) {
          cleanViews[viewCode] = {
            reason: allViewData[viewCode].reason || '',
            additionalDetails: allViewData[viewCode].additionalDetails || ''
          }
        }
      })

      // Replace with clean structure (remove selectedViews helper array)
      data.imageReadingTemp.technicalRecall = {
        views: cleanViews
      }

      // Use a regular redirect (not 307) so the browser does not resend the original
      // POST body. A 307 would cause the prototype kit middleware to re-save the raw
      // form data (all views) at opinion-details-complete, overwriting the clean data.
      // save-opinion reads from session (imageReadingTemp), not the POST body, so
      // it works correctly when reached via GET through the skip-confirmation path.
      // Pass referrer chain through so save-opinion can return to the origin page
      const referrerChain = req.query.referrerChain
      const chainParam = referrerChain
        ? `?referrerChain=${encodeURIComponent(referrerChain)}`
        : ''
      res.redirect(
        `/reading/session/${sessionId}/appointments/${appointmentId}/opinion-details-complete${chainParam}`
      )
    }
  )

  // Central routing point after all opinion detail pages are complete.
  // Handles late comparison check and decides whether to show review or save directly.
  // All detail pages (normal-details, technical-recall, recall-for-assessment-details)
  // should route here on completion.
  router.all(
    '/reading/session/:sessionId/appointments/:appointmentId/opinion-details-complete',
    (req, res) => {
      const { sessionId, appointmentId } = req.params
      const data = req.session.data
      const currentUserId = data.currentUser?.id
      const formData = data.imageReadingTemp
      const opinion = formData?.opinion

      // Validate recall for assessment details
      if (opinion === 'recall_for_assessment') {
        const rightAssessment = formData?.right?.breastAssessment
        const leftAssessment = formData?.left?.breastAssessment
        const errors = []

        if (!rightAssessment) {
          errors.push({
            text: 'Give an opinion for the right breast',
            name: 'imageReadingTemp[right][breastAssessment]',
            href: '#right-breastAssessment'
          })
        }
        if (!leftAssessment) {
          errors.push({
            text: 'Give an opinion for the left breast',
            name: 'imageReadingTemp[left][breastAssessment]',
            href: '#left-breastAssessment'
          })
        }

        // Both breasts cannot be normal — at least one must be abnormal or clinical
        if (
          rightAssessment &&
          leftAssessment &&
          rightAssessment === 'normal' &&
          leftAssessment === 'normal'
        ) {
          const appointment = data.appointments.find(
            (e) => e.id === appointmentId
          )
          const hasSymptoms =
            appointment?.medicalInformation?.symptoms?.length > 0
          const errorText = hasSymptoms
            ? 'At least one breast must be marked abnormal or needing clinical assessment to recall for assessment'
            : 'At least one breast must be marked abnormal to recall for assessment'
          errors.push({
            text: errorText,
            name: 'imageReadingTemp[right][breastAssessment]',
            href: '#right-breastAssessment'
          })
          errors.push({
            text: errorText,
            name: 'imageReadingTemp[left][breastAssessment]',
            href: '#left-breastAssessment',
            hideFromSummary: true
          })
        }

        // Validate annotations match breast assessment
        const rightAnnotations = formData?.right?.annotations || []
        const leftAnnotations = formData?.left?.annotations || []

        for (const side of ['right', 'left']) {
          const assessment = side === 'right' ? rightAssessment : leftAssessment
          const annotations =
            side === 'right' ? rightAnnotations : leftAnnotations
          const sideLabel = side

          if (!assessment) continue

          const highLevelAnnotations = annotations.filter(
            (a) => parseInt(a.levelOfConcern, 10) >= 3
          )

          if (assessment === 'abnormal') {
            // Abnormal breast must have at least one annotation
            if (annotations.length === 0) {
              errors.push({
                text: `Add an annotation for the ${sideLabel} breast`,
                name: `annotations[${side}]`,
                href: `#${side}-annotations`
              })
            } else {
              // All annotations must have required fields completed
              const incompleteAnnotations = annotations.filter(
                (a) =>
                  !a.abnormalityTypes ||
                  a.abnormalityTypes.length === 0 ||
                  !a.levelOfConcern
              )
              if (incompleteAnnotations.length > 0) {
                errors.push({
                  text: `Complete the annotation details for the ${sideLabel} breast`,
                  name: `annotations[${side}]`,
                  href: `#${side}-annotations`
                })
              }
              // Abnormal breast must have at least one annotation of M3 or higher
              else if (highLevelAnnotations.length === 0) {
                errors.push({
                  text: `Add an annotation of concern level 3 or higher for the ${sideLabel} breast`,
                  name: `annotations[${side}]`,
                  href: `#${side}-annotations`
                })
              }
            }
          } else if (assessment === 'normal' || assessment === 'clinical') {
            // Normal/clinical breast must not have annotations of M3 or higher
            if (highLevelAnnotations.length > 0) {
              errors.push({
                text: `A normal ${sideLabel} breast cannot have annotations with concern level 3 or higher`,
                name: `annotations[${side}]`,
                href: `#${side}-annotations`
              })
            }
          }
        }

        if (errors.length) {
          const isModal = req.headers['x-requested-with'] === 'XMLHttpRequest'
          if (isModal) {
            return res
              .status(422)
              .render('reading/workflow/recall-for-assessment-details', {
                flash: { error: errors }
              })
          }
          errors.forEach((err) => req.flash('error', err))
          return res.redirect(
            `/reading/session/${sessionId}/appointments/${appointmentId}/recall-for-assessment-details`
          )
        }
      }

      const appointment = data.appointments.find((e) => e.id === appointmentId)
      if (!appointment) return res.redirect(`/reading/session/${sessionId}`)

      // Completing the detail pages is a deliberate act, so whatever follows is
      // a real save. Detail edits reach save-opinion without passing through
      // opinion-answer, so the temp may still carry the savedAt it was seeded
      // with - clear it here too, or save-opinion's replay guard would block
      // the edit. Done after validation so a bounced-back form keeps its state.
      if (data.imageReadingTemp) {
        delete data.imageReadingTemp.savedAt
      }

      // Editing a read the user has already saved. The existing-read page they
      // came from is itself a summary of the read, so the confirmation step is
      // redundant — save straight away regardless of the confirmation settings.
      // In arbitration, "editing" means the arbitration read exists - not that
      // the user was an original reader (panel members may have been).
      const isArbitrationSession =
        getReadingSession(data, sessionId)?.type === 'arbitration'
      const isEditingExistingRead = isArbitrationSession
        ? Boolean(getArbitrationRead(getReadingCase(data, appointment)))
        : userHasReadAppointment(data, appointment, currentUserId)

      // Blind arbitration reveals the original reads on the review page, so
      // the review step is required even when confirmDecision is off
      const arbitrationNeedsReview =
        isArbitrationSession &&
        (data.settings?.reading?.arbitration?.confirmDecision !== 'false' ||
          data.settings?.reading?.arbitration?.showReads === 'blind')

      // Check for late comparison if not already done
      const comparisonSetting = data.settings?.reading?.secondReaderComparison
      if (
        comparisonSetting === 'late' &&
        !isArbitrationSession &&
        !formData?.comparisonComplete
      ) {
        if (
          shouldShowComparePage(
            getReadingCase(data, appointment),
            formData,
            currentUserId,
            data.settings
          )
        ) {
          return res.redirect(
            `/reading/session/${sessionId}/appointments/${appointmentId}/compare`
          )
        }
      }

      // Keep the referrer chain on the way to the next step, so an edit that
      // began on the existing-read page returns there once saved. The technical
      // recall and recall for assessment branches below do the same by hand.
      const detailsReferrerChain = req.query.referrerChain
      const withChain = (url) =>
        detailsReferrerChain
          ? `${url}${url.includes('?') ? '&' : '?'}referrerChain=${encodeURIComponent(detailsReferrerChain)}`
          : url

      // Route based on opinion type
      switch (opinion) {
        case 'normal':
          // opinion-details-complete is only reached for normal when the user
          // went through the normal-details page, so use confirmNormalWithDetails.
          // Arbitration decisions confirm on the review page, unless the
          // confirmDecision setting turns that off.
          if (isArbitrationSession && !isEditingExistingRead) {
            if (arbitrationNeedsReview) {
              return res.redirect(
                modalBreakout(
                  withChain(
                    `/reading/session/${sessionId}/appointments/${appointmentId}/review`
                  )
                )
              )
            }
            return res.redirect(
              307,
              withChain(
                `/reading/session/${sessionId}/appointments/${appointmentId}/save-opinion`
              )
            )
          }
          if (
            !isEditingExistingRead &&
            data.settings?.reading?.confirmNormalWithDetails === 'true'
          ) {
            return res.redirect(
              withChain(
                `/reading/session/${sessionId}/appointments/${appointmentId}/confirm-normal`
              )
            )
          }
          return res.redirect(
            307,
            withChain(
              `/reading/session/${sessionId}/appointments/${appointmentId}/save-opinion`
            )
          )
        case 'technical_recall': {
          const trReferrer = req.query.referrerChain
          const trChainParam = trReferrer
            ? `?referrerChain=${encodeURIComponent(trReferrer)}`
            : ''
          if (
            !isEditingExistingRead &&
            (isArbitrationSession
              ? arbitrationNeedsReview
              : data.settings?.reading?.confirmTechnicalRecall !== 'false')
          ) {
            return res.redirect(
              modalBreakout(
                `/reading/session/${sessionId}/appointments/${appointmentId}/review${trChainParam}`
              )
            )
          }
          return res.redirect(
            307,
            `/reading/session/${sessionId}/appointments/${appointmentId}/save-opinion${trChainParam}`
          )
        }
        case 'recall_for_assessment': {
          const rfaReferrer = req.query.referrerChain
          const rfaChainParam = rfaReferrer
            ? `?referrerChain=${encodeURIComponent(rfaReferrer)}`
            : ''
          if (
            !isEditingExistingRead &&
            (isArbitrationSession
              ? arbitrationNeedsReview
              : data.settings?.reading?.confirmRecallForAssessment !== 'false')
          ) {
            return res.redirect(
              modalBreakout(
                `/reading/session/${sessionId}/appointments/${appointmentId}/review${rfaChainParam}`
              )
            )
          }
          return res.redirect(
            307,
            `/reading/session/${sessionId}/appointments/${appointmentId}/save-opinion${rfaChainParam}`
          )
        }
        default:
          return res.redirect(
            `/reading/session/${sessionId}/appointments/${appointmentId}/review`
          )
      }
    }
  )

  // Handle recording a reading result
  // Save the reading opinion - reads opinion from imageReadingTemp.opinion
  // Uses router.all (not router.post) so it can be reached via GET when the
  // skip-confirmation path redirects without preserving a POST method.
  router.all(
    '/reading/session/:sessionId/appointments/:appointmentId/save-opinion',
    (req, res) => {
      const { sessionId, appointmentId } = req.params
      const data = req.session.data
      const currentUserId = data.currentUser.id
      const formData = data.imageReadingTemp

      // Find the appointment
      const appointment = data.appointments.find((e) => e.id === appointmentId)
      if (!appointment) {
        return res.redirect(`/reading/session/${sessionId}`)
      }

      // Where the reader goes once this case is settled: the next case, or
      // whichever end-of-session page applies. Shared by a genuine save and by
      // a replay of one, so a repeated save lands where the original did.
      const onwardDestination = () =>
        onwardFromCase(data, sessionId, appointmentId)

      // Nothing to save. Either the decision was already recorded and this is a
      // repeat submit - a double click, a held shortcut key - whose temp the
      // first save cleared, or the reader never gave one. A repeat submit is
      // still one decision, so it goes where the original went; anything else
      // goes back to the step that asks for the decision.
      //
      // Not the case URL: that sends a settled case to its existing read, which
      // would strand the reader on the case they just finished.
      if (!formData || !formData.opinion) {
        console.log('No opinion in imageReadingTemp - cannot save')
        const sessionForEmptySave = getReadingSession(data, sessionId)
        const caseIsSettled =
          sessionForEmptySave?.type === 'arbitration'
            ? appointmentHasBeenArbitrated(data, appointment)
            : userHasReadAppointment(data, appointment, currentUserId)

        return res.redirect(
          modalBreakout(
            caseIsSettled
              ? onwardDestination()
              : caseDecisionUrl(data, sessionId, appointmentId)
          )
        )
      }

      // A replay of a save that already happened, rather than a new one.
      //
      // This route is reachable by GET, and the workflow middleware refills
      // imageReadingTemp from the saved read on any GET back into the case. So
      // a back-navigation, a refresh on the redirect, or a double submit can
      // arrive here with a temp that looks like a fresh opinion but is really
      // the read that was just written. Writing again would duplicate the read,
      // and - because the check below infers intent from whether a read exists -
      // would send the reader to their existing read instead of the next case.
      //
      // savedAt is stamped on the read when it is written, so a temp carrying
      // one came from an already-saved read. A replay goes where the original
      // save went: confirming twice is still one decision, so the reader should
      // end up on the next case rather than back on the one they just finished.
      if (formData.savedAt) {
        const replayReferrerChain = req.query.referrerChain
        return res.redirect(
          modalBreakout(
            replayReferrerChain
              ? getReturnUrl(
                  `/reading/session/${sessionId}/appointments/${appointmentId}/existing-read`,
                  replayReferrerChain
                )
              : onwardDestination()
          )
        )
      }

      // Whether this save is an edit of a read the user had already made.
      // The case URL only routes already-read users via existing-read, so any
      // journey reaching here with a read in place started from that page —
      // and should return to it rather than moving on to the next case.
      // Must be checked before the read is written.
      //
      // In arbitration this means the arbitration read already exists. A panel
      // member's own earlier read as first or second reader isn't an edit -
      // they still have the arbitration to do.
      const sessionForSave = getReadingSession(data, sessionId)
      const isEditingExistingRead =
        sessionForSave?.type === 'arbitration'
          ? Boolean(getArbitrationRead(getReadingCase(data, appointment)))
          : userHasReadAppointment(data, appointment, currentUserId)

      delete data.imageReadingTemp
      delete res.locals.data?.imageReadingTemp

      // Create and save the reading. Authorship is settled by buildRead, which
      // knows whether this is an arbitration (many authors) or a read (one).
      //
      // savedAt marks the read as written. The workflow middleware seeds
      // imageReadingTemp from the saved read, so this is what lets a replayed
      // save be told apart from a genuine one (see the guard above).
      const readResult = {
        readerType: data.currentUser.role,
        ...formData,
        timestamp: new Date().toISOString(),
        savedAt: new Date().toISOString()
      }

      // Write the reading (passing session context to handle skipped appointments)
      writeReading(data, appointment, currentUserId, readResult, sessionId)

      // Top up the session with the next eligible appointment if under target size
      topUpSession(data, sessionId, appointmentId)

      // Find next unread appointment in session after the current position (no wrap)
      const session = getReadingSession(data, sessionId)
      const sessionAppointments = session.appointmentIds
        .map((id) => data.appointments.find((e) => e.id === id))
        .filter(Boolean)
      const isArbitrationSave = session?.type === 'arbitration'

      const nextUnreadAppointment = getNextCaseInSession(
        data,
        session,
        sessionAppointments,
        appointmentId,
        currentUserId
      )

      // Store banner message for the next case, but only if there is one.
      // Edits stay on the current case, so there's nowhere to show it.
      // Bypassing req.flash as we couldn't get it to work - possibly due to redirect loops
      // Todo: can we get this working with req.flash?
      if (nextUnreadAppointment && !isEditingExistingRead) {
        const participant = data.participants.find(
          (person) => person.id === appointment.participantId
        )
        const shortName = getShortName(participant)
        const resultLabels = {
          normal: 'Normal',
          technical_recall: 'Technical recall',
          recall_for_assessment: 'Recall for assessment'
        }
        const resultLabel = resultLabels[formData.opinion] || 'Opinion'
        const message = isArbitrationSave
          ? `${resultLabel} outcome recorded for ${shortName}`
          : `${resultLabel} opinion recorded for ${shortName}`

        data.readingOpinionBanner = {
          text: message,
          participantName: `${shortName}`, // This didn't work when used directly - coerced to string instead.
          editHref: `/reading/session/${sessionId}/appointments/${appointmentId}/existing-read`
        }
      }

      // If submitted from an existing-read or review page (e.g. editing technical recall), return there
      const saveReferrerChain = req.query.referrerChain
      if (saveReferrerChain) {
        const returnUrl = getReturnUrl(
          `/reading/session/${sessionId}/appointments/${appointmentId}/existing-read`,
          saveReferrerChain
        )
        res.redirect(modalBreakout(returnUrl))
        return
      }

      // An edit returns to the read it was made from, and says so with the
      // referrer chain handled above - the only door into a settled case's
      // workflow is the existing-read page, which sets it. Without a chain
      // this is a reader finishing a case, so they move on.
      //
      // Redirect to next unread appointment or end-of-session page
      res.redirect(modalBreakout(onwardDestination()))
    }
  )

  // Handle opinion form submission - stores result and routes to appropriate next step
  router.post(
    '/reading/session/:sessionId/appointments/:appointmentId/opinion-answer',
    (req, res) => {
      const { sessionId, appointmentId } = req.params
      const data = req.session.data

      // Debug logging
      console.log('opinion-answer received')
      console.log(
        'imageReadingTemp:',
        JSON.stringify(data.imageReadingTemp, null, 2)
      )

      // Carry the referrer chain on to whichever step comes next, so a journey
      // that began on the existing-read page can find its way back there after
      // saving. The chain only applies within this case's workflow - links that
      // leave it (back to the session, say) are already the end of the journey.
      const opinionReferrerChain = req.query.referrerChain
      const redirect = (...redirectArgs) => {
        const target = redirectArgs.pop()
        const keepsChain =
          opinionReferrerChain &&
          typeof target === 'string' &&
          target.includes(`/appointments/${appointmentId}/`) &&
          !target.includes('referrerChain=')
        const url = keepsChain
          ? `${target}${target.includes('?') ? '&' : '?'}referrerChain=${encodeURIComponent(opinionReferrerChain)}`
          : target
        return res.redirect(...redirectArgs, url)
      }

      // Opinion and previousOpinion are auto-saved to data.imageReadingTemp via form binding
      const opinion = data.imageReadingTemp?.opinion
      const previousOpinion = data.imageReadingTemp?.previousOpinion

      console.log('opinion:', opinion)
      console.log('previousOpinion:', previousOpinion)

      const appointment = data.appointments.find((e) => e.id === appointmentId)
      if (!appointment) return res.redirect(`/reading/session/${sessionId}`)

      // Arbitration has its own compare step, so the second-reader comparison
      // gates below don't apply
      const isArbitrationSession =
        getReadingSession(data, sessionId)?.type === 'arbitration'

      // Editing a read the user has already saved — skip the confirmation step,
      // the existing-read page they return to already summarises the read. In
      // arbitration that means the arbitration read exists, not that the user
      // was an original reader (panel members may have been)
      const isEditingExistingRead = isArbitrationSession
        ? Boolean(getArbitrationRead(getReadingCase(data, appointment)))
        : userHasReadAppointment(data, appointment, data.currentUser?.id)

      // Ensure appointmentId is set for tracking
      if (!data.imageReadingTemp) {
        data.imageReadingTemp = { appointmentId: appointmentId }
      }
      data.imageReadingTemp.appointmentId = appointmentId

      // Submitting the opinion form is a deliberate act, so whatever follows is
      // a real save rather than a replay. The temp may carry a savedAt from the
      // read it was seeded with when editing - clear it so save-opinion's replay
      // guard doesn't mistake this edit for a repeat of the original save.
      delete data.imageReadingTemp.savedAt

      // Normalise normal_with_details to normal (it just goes to details page first)
      const normalisedOpinion =
        opinion === 'normal_with_details' ? 'normal' : opinion
      if (opinion === 'normal_with_details') {
        data.imageReadingTemp.opinion = normalisedOpinion
        // Preserve intent to add details for after comparison
        data.imageReadingTemp.wantsNormalDetails = true
      }

      // Clean up data from other opinion types when changing opinion
      if (previousOpinion && previousOpinion !== normalisedOpinion) {
        console.log(
          `Opinion changed from ${previousOpinion} to ${normalisedOpinion} - cleaning up`
        )
        // Changing away from technical_recall - clear technical recall data
        if (previousOpinion === 'technical_recall') {
          delete data.imageReadingTemp.technicalRecall
        }
        // Changing away from recall_for_assessment - clear breast assessments and annotations
        if (previousOpinion === 'recall_for_assessment') {
          delete data.imageReadingTemp.left
          delete data.imageReadingTemp.right
        }
      }

      // Clean up previousOpinion - only needed for change detection
      delete data.imageReadingTemp.previousOpinion

      // Choosing an outcome here replaces any read adopted earlier, so the
      // decision is no longer based on one of the original reads
      delete data.imageReadingTemp.agreedWithReaderId

      // Check for early comparison (second reader only, not normal+normal).
      // Arbitration has its own compare step, so these gates don't apply
      const comparisonSetting = data.settings?.reading?.secondReaderComparison
      if (comparisonSetting === 'early' && !isArbitrationSession) {
        const currentUserId = data.currentUser?.id
        if (
          shouldShowComparePage(
            getReadingCase(data, appointment),
            data.imageReadingTemp,
            currentUserId,
            data.settings
          )
        ) {
          // Second reader with opinions that need comparison
          return redirect(
            `/reading/session/${sessionId}/appointments/${appointmentId}/compare`
          )
        }
      }

      // Handle different opinion types
      switch (opinion) {
        case 'normal':
          // Arbitration decisions confirm on the review page unless the
          // confirmDecision setting turns that off; blind arbitration always
          // reviews, as that's where the original reads are revealed
          if (isArbitrationSession) {
            if (
              !isEditingExistingRead &&
              (data.settings?.reading?.arbitration?.confirmDecision !==
                'false' ||
                data.settings?.reading?.arbitration?.showReads === 'blind')
            ) {
              return redirect(
                `/reading/session/${sessionId}/appointments/${appointmentId}/review`
              )
            }
            return redirect(
              307,
              `/reading/session/${sessionId}/appointments/${appointmentId}/save-opinion`
            )
          }
          // For late comparison, normal still needs to go through compare if discordant
          // (since there's no review page to intercept)
          if (comparisonSetting === 'late' && !isArbitrationSession) {
            if (
              shouldShowComparePage(
                getReadingCase(data, appointment),
                data.imageReadingTemp,
                data.currentUser?.id,
                data.settings
              )
            ) {
              return redirect(
                `/reading/session/${sessionId}/appointments/${appointmentId}/compare`
              )
            }
          }
          if (
            !isEditingExistingRead &&
            data.settings.reading.confirmNormal === 'true'
          ) {
            return redirect(
              `/reading/session/${sessionId}/appointments/${appointmentId}/confirm-normal`
            )
          } else {
            return redirect(
              307,
              `/reading/session/${sessionId}/appointments/${appointmentId}/save-opinion`
            )
          }
        case 'normal_with_details':
          // Result already set to 'normal' above - go to details page
          return redirect(
            `/reading/session/${sessionId}/appointments/${appointmentId}/normal-details`
          )
        case 'technical_recall':
          return redirect(
            `/reading/session/${sessionId}/appointments/${appointmentId}/technical-recall`
          )
        case 'recall_for_assessment':
          // Break out of modal immediately — recall for assessment is a complex
          // multi-step flow that should run as a full page journey
          return redirect(
            modalBreakout(
              `/reading/session/${sessionId}/appointments/${appointmentId}/recall-for-assessment-details`
            )
          )
        default:
          return redirect(
            `/reading/session/${sessionId}/appointments/${appointmentId}`
          )
      }
    }
  )

  // Adopt one of the original reads as the arbitration outcome. Copies the
  // read into imageReadingTemp and goes to the review page, where any of it
  // can be changed before saving - so adoption always confirms, whatever the
  // confirmDecision setting says.
  router.post(
    '/reading/session/:sessionId/appointments/:appointmentId/arbitration-adopt-read',
    (req, res) => {
      const { sessionId, appointmentId } = req.params
      const data = req.session.data

      const appointment = data.appointments.find((e) => e.id === appointmentId)
      if (!appointment) return res.redirect(`/reading/session/${sessionId}`)

      const agreedReaderId = req.body.agreedReaderId
      const reads = getReadsAsArray(getReadingCase(data, appointment))
      const agreedRead = reads.find((read) => read.readerId === agreedReaderId)

      if (!agreedRead) {
        return res.redirect(caseDecisionUrl(data, sessionId, appointmentId))
      }

      // Adopt a copy of the read wholesale - outcome and details - never a
      // reference to the original
      data.imageReadingTemp = { appointmentId }
      data.imageReadingTemp.opinion = agreedRead.opinion
      data.imageReadingTemp.agreedWithReaderId = agreedReaderId

      if (agreedRead.technicalRecall) {
        data.imageReadingTemp.technicalRecall = {
          ...agreedRead.technicalRecall
        }
      }
      if (agreedRead.left) {
        data.imageReadingTemp.left = JSON.parse(JSON.stringify(agreedRead.left))
      }
      if (agreedRead.right) {
        data.imageReadingTemp.right = JSON.parse(
          JSON.stringify(agreedRead.right)
        )
      }
      if (agreedRead.normalDetails) {
        data.imageReadingTemp.normalDetails = agreedRead.normalDetails
      }

      // Break out of the modal (reads-in-a-modal reveal style) so the review
      // page renders full-page
      return res.redirect(
        modalBreakout(
          `/reading/session/${sessionId}/appointments/${appointmentId}/review`
        )
      )
    }
  )

  // Handle compare decision - keep opinion or adopt first reader's
  router.post(
    '/reading/session/:sessionId/appointments/:appointmentId/compare-answer',
    (req, res) => {
      const { sessionId, appointmentId } = req.params
      const data = req.session.data
      const decision = req.body.compareDecision
      const currentUserId = data.currentUser?.id

      const appointment = data.appointments.find((e) => e.id === appointmentId)
      if (!appointment) return res.redirect(`/reading/session/${sessionId}`)

      // Editing a read the user has already saved — skip the confirmation step,
      // the existing-read page they return to already summarises the read
      const isEditingExistingRead = userHasReadAppointment(
        data,
        appointment,
        currentUserId
      )

      const opinion = data.imageReadingTemp?.opinion
      const comparisonInfo = getComparisonInfo(
        getReadingCase(data, appointment),
        data.imageReadingTemp,
        currentUserId,
        data.settings
      )
      const firstOpinion = comparisonInfo?.firstOpinion
      const forceNormalDetailsForDiscordantNormal =
        opinion === 'normal' && comparisonInfo?.discordant

      // Mark comparison as complete so save-opinion doesn't redirect back here
      data.imageReadingTemp.comparisonComplete = true

      // Adopting the first reader's opinion can route straight to save-opinion,
      // so clear any savedAt carried over from a seeded read - as with the other
      // deliberate submits, this is a real save rather than a replay.
      delete data.imageReadingTemp.savedAt

      if (decision === 'adopt') {
        // Copy first reader's data to our temp
        if (comparisonInfo && comparisonInfo.firstRead) {
          const firstRead = comparisonInfo.firstRead

          // Copy opinion and all details from first reader
          data.imageReadingTemp.opinion = firstRead.opinion
          data.imageReadingTemp.adoptedFromFirstReader = true

          // Copy technical recall data if present
          if (firstRead.technicalRecall) {
            data.imageReadingTemp.technicalRecall = {
              ...firstRead.technicalRecall
            }
          }

          // Copy breast assessment data if present
          if (firstRead.left) {
            data.imageReadingTemp.left = JSON.parse(
              JSON.stringify(firstRead.left)
            )
          }
          if (firstRead.right) {
            data.imageReadingTemp.right = JSON.parse(
              JSON.stringify(firstRead.right)
            )
          }

          // Copy normal details if present
          if (firstRead.normalDetails) {
            data.imageReadingTemp.normalDetails = firstRead.normalDetails
          }

          console.log('Adopted first reader opinion:', firstRead.opinion)
        }

        if (isEditingExistingRead) {
          return res.redirect(
            `/reading/session/${sessionId}/appointments/${appointmentId}/save-opinion`
          )
        }

        // Go straight to review since we have complete data
        return res.redirect(
          `/reading/session/${sessionId}/appointments/${appointmentId}/review`
        )
      }

      // Keep original opinion - continue to appropriate details page
      // But if we already have details (late comparison), skip to review
      const wantsNormalDetails = data.imageReadingTemp?.wantsNormalDetails
      const temp = data.imageReadingTemp

      // Check if second reader already has details for their opinion
      const hasExistingDetails =
        (opinion === 'technical_recall' && temp?.technicalRecall?.views) ||
        (opinion === 'recall_for_assessment' && (temp?.left || temp?.right)) ||
        (opinion === 'normal' && temp?.normalDetails)

      if (hasExistingDetails) {
        // Route through opinion-details-complete to respect settings.
        // Using 307 preserves POST so save-opinion can be reached directly if needed.
        // This also fixes the bug where normal+normalDetails was sent to /review.
        return res.redirect(
          307,
          `/reading/session/${sessionId}/appointments/${appointmentId}/opinion-details-complete`
        )
      }

      switch (opinion) {
        case 'normal':
          // Check if user originally wanted to add details
          if (wantsNormalDetails || forceNormalDetailsForDiscordantNormal) {
            return res.redirect(
              `/reading/session/${sessionId}/appointments/${appointmentId}/normal-details`
            )
          } else if (
            !isEditingExistingRead &&
            data.settings.reading.confirmNormal === 'true'
          ) {
            return res.redirect(
              `/reading/session/${sessionId}/appointments/${appointmentId}/confirm-normal`
            )
          } else {
            return res.redirect(
              307,
              `/reading/session/${sessionId}/appointments/${appointmentId}/save-opinion`
            )
          }
        case 'technical_recall':
          return res.redirect(
            `/reading/session/${sessionId}/appointments/${appointmentId}/technical-recall`
          )
        case 'recall_for_assessment':
          return res.redirect(
            `/reading/session/${sessionId}/appointments/${appointmentId}/recall-for-assessment-details`
          )
        default:
          return res.redirect(
            `/reading/session/${sessionId}/appointments/${appointmentId}`
          )
      }
    }
  )

  // Default route for reading history - redirect to all view
  router.get('/reading/history', (req, res) => {
    res.redirect('/reading/history/mine')
  })

  // Route for viewing reading history with view parameter
  router.get('/reading/history/:view', (req, res) => {
    const data = req.session.data
    const currentUserId = data.currentUser.id
    const view = req.params.view || 'all'

    // Collect all reads across the reading cases. There's no date bound: the
    // seed data holds no historic sessions, so everything here is recent.
    const allReadings = []

    data.appointments.forEach((appointment) => {
      const readingCase = getReadingCase(data, appointment)
      const reads = getReadsAsArray(readingCase)
      if (!reads.length) return

      const appointmentReadings = reads.map((reading) => {
        // Each read records what kind it was when it was made, so history
        // doesn't have to infer it from ordering
        const readType = reading.readType

        // Get participant info
        const participant = data.participants.find(
          (p) => p.id === appointment.participantId
        )

        // Get batch ID if available
        let sessionId = null
        if (data.readingSessions) {
          for (const [id, session] of Object.entries(data.readingSessions)) {
            if (session.appointmentIds.includes(appointment.id)) {
              sessionId = id
              break
            }
          }
        }

        return {
          appointmentId: appointment.id,
          clinicId: appointment.clinicId,
          sessionId,
          readerId: reading.readerId,
          arbitratorIds: reading.arbitratorIds,
          readType,
          opinion: reading.opinion,
          timestamp: reading.timestamp,
          finalisedAt: reading.finalisedAt,
          participant
        }
      })

      allReadings.push(...appointmentReadings)
    })

    const sortedReadings = allReadings.sort(
      (a, b) => new Date(b.timestamp) - new Date(a.timestamp)
    )

    // Determine which readings to display based on view
    let readings = []
    if (view === 'mine') {
      readings = sortedReadings.filter((reading) =>
        getReadAuthorIds(reading).includes(currentUserId)
      )
    } else {
      readings = sortedReadings
    }

    // Build session list for the sessions tab
    const sessions = Object.values(data.readingSessions || {})
      .map((session) => {
        const progress = getSessionReadingProgress(
          data,
          session.id,
          null,
          currentUserId
        )

        // Count cases the user has "dealt with". For arbitration that means the
        // case has been settled by the panel, not read by this user - an
        // arbitration session would otherwise never register any progress.
        const sessionAppointments = session.appointmentIds
          .map((id) => data.appointments.find((e) => e.id === id))
          .filter(Boolean)
        const isArbitration = session.type === 'arbitration'
        const userCompletedCount = sessionAppointments.filter((appointment) =>
          isArbitration
            ? appointmentHasBeenArbitrated(data, appointment) ||
              awaitingPriors(appointment)
            : userHasReadAppointment(data, appointment, currentUserId) ||
              userRequestedPriors(appointment, currentUserId)
        ).length

        // A session that has been worked through can still hold opinions the
        // user hasn't finalised, so completeness has two steps rather than one
        const unfinalisedReadCount = getUnfinalisedUserReadsForSession(
          data,
          session.id,
          currentUserId
        ).length

        return {
          ...session,
          progress,
          userCompletedCount,
          unfinalisedReadCount
        }
      })
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))

    // Sessions this prototype has actually run are only ever today's, so the
    // tab is padded out with finished ones behind them
    const allSessions = [
      ...sessions,
      ...getHistoricReadingSessions(data)
    ].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))

    res.render('reading/history', {
      readings,
      sessions: allSessions,
      view
    })
  })
}
