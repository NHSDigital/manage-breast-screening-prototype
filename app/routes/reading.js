// app/routes/image-reading.js
const { getEventData } = require('../lib/utils/event-data')
const {
  getFirstUserReadableEvent,
  getNextUserReadableEvent,
  getResumeEventForUser,
  getReadableEventsForClinic,
  getReadingStatusForEvents,
  getReadingClinics,
  getReadingProgress,
  hasReads,
  canUserReadEvent,
  userHasReadEvent,
  writeReading,
  createReadingSession,
  getFirstReadableEventInSession,
  getReadingSession,
  getOrCreateClinicSession,
  getSessionReadingProgress,
  skipEventInSession,
  topUpSession,
  getReadingMetadata,
  getComparisonInfo,
  shouldShowComparePage
} = require('../lib/utils/reading')
const { getShortName } = require('../lib/utils/participants')
const { userRequestedPriors } = require('../lib/utils/prior-mammograms')
const { camelCase, snakeCase } = require('../lib/utils/strings')
const { modalBreakout } = require('../lib/utils/referrers')
const dayjs = require('dayjs')
const generateId = require('../lib/utils/id-generator')

module.exports = (router) => {
  // Set nav state
  router.use('/reading', (req, res, next) => {
    res.locals.navActive = 'reading'
    next()
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
    const clinic = data.clinics.find((c) => c.id === clinicId)

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

    const clinic = data.clinics.find((c) => c.id === clinicId)
    if (!clinic) return res.redirect('/reading')

    try {
      // Convert clinic to session
      const session = getOrCreateClinicSession(data, clinicId)

      // Find first readable event in the session
      const firstReadableEvent = getFirstReadableEventInSession(
        data,
        session.id,
        currentUserId
      )

      if (firstReadableEvent) {
        // Redirect directly to the first readable event
        res.redirect(
          `/reading/session/${session.id}/events/${firstReadableEvent.id}`
        )
      } else {
        // No readable events, go to batch overview
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
    const { eventId, mammogramId, newStatus } = req.body
    const currentUserId = data.currentUser?.id

    const event = data.events.find((e) => e.id === eventId)
    if (!event || !event.previousMammograms) {
      if (req.headers.accept?.includes('application/json')) {
        return res.status(404).json({ error: 'Event not found' })
      }
      return res.redirect('/reading/priors')
    }

    const mammogram = event.previousMammograms.find((m) => m.id === mammogramId)
    if (!mammogram) {
      if (req.headers.accept?.includes('application/json')) {
        return res.status(404).json({ error: 'Mammogram not found' })
      }
      return res.redirect('/reading/priors')
    }

    // Update the status
    mammogram.requestStatus = newStatus
    mammogram.statusChangedDate = new Date().toISOString()
    mammogram.statusChangedBy = currentUserId

    // Set additional fields based on status
    if (newStatus === 'requested') {
      // Admin is formally sending the IEP request
      mammogram.requestedDate = new Date().toISOString()
      mammogram.requestedBy = currentUserId
    } else if (newStatus === 'received') {
      mammogram.receivedDate = new Date().toISOString()
    }

    // Also update mirrored event in data.event if it matches
    if (data.event && data.event.id === eventId) {
      data.event.previousMammograms = event.previousMammograms
    }

    // If this was a fetch request, send JSON response for in-place update
    if (req.headers.accept?.includes('application/json')) {
      return res.json({
        status: 'success',
        newStatus,
        mammogramId
      })
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

    // Create the session
    try {
      const session = createReadingSession(data, {
        type: type || 'custom',
        name,
        clinicId,
        limit: limit ? parseInt(limit) : null,
        lazy: lazy !== undefined ? lazy === 'true' : null,
        filters
      })

      // Check if the request includes the redirect parameter
      if (redirect === 'list') {
        // Redirect to batch view instead of starting reading
        res.redirect(`/reading/session/${session.id}`)
        return
      }

      // Redirect to batch view or first event if available
      const firstReadableEvent = getFirstReadableEventInSession(
        data,
        session.id,
        currentUserId
      )

      if (firstReadableEvent) {
        res.redirect(
          `/reading/session/${session.id}/events/${firstReadableEvent.id}`
        )
      } else {
        res.redirect(`/reading/session/${session.id}`)
      }
    } catch (error) {
      console.log('Error creating session', error)
      res.redirect('/reading')
    }
  })

  // Route for viewing a batch
  router.get('/reading/session/:sessionId', (req, res) => {
    // Default to "your-reads" view
    res.redirect(`/reading/session/${req.params.sessionId}/your-reads`)
  })

  // Route for skipped-review page (shown at end of batch when skipped cases remain)
  router.get('/reading/session/:sessionId/skipped-review', (req, res) => {
    const data = req.session.data
    const { sessionId } = req.params
    const session = getReadingSession(data, sessionId)
    if (!session) {
      return res.redirect('/reading')
    }
    const firstSkippedEventId = session.skippedEvents[0] || null
    res.render('reading/skipped-review', {
      session,
      sessionId,
      firstSkippedEventId
    })
  })

  // Route for viewing a session with specific view
  router.get('/reading/session/:sessionId/:view', (req, res) => {
    const data = req.session.data
    const { sessionId, view } = req.params
    const autoFinaliseWindowMinutes = 30
    const validViews = ['your-reads', 'all-reads']

    // Validate view parameter
    const selectedView = validViews.includes(view) ? view : 'your-reads'

    // Get the batch
    const session = getReadingSession(data, sessionId)
    if (!session) {
      // req.flash('error', 'Session not found')
      return res.redirect('/reading')
    }

    // Get enhanced events with reading metadata
    const enhancedEvents = session.eventIds
      .map((eventId) => data.events.find((e) => e.id === eventId))
      .filter(Boolean)
      .map((event) => {
        // Add participant data and reading metadata
        const participant = data.participants.find(
          (p) => p.id === event.participantId
        )
        const metadata = getReadingMetadata(event)

        return {
          ...event,
          participant,
          readingMetadata: metadata
        }
      })

    // Get reading status for the session
    const readingStatus = getReadingStatusForEvents(
      enhancedEvents,
      data.currentUser.id
    )

    // Find where the user should resume — first readable after the furthest
    // point they've reached (reads or skips), falling back to first readable
    const resumeEvent = getResumeEventForUser(
      enhancedEvents,
      data.currentUser.id,
      session.skippedEvents || []
    )

    // Countdown starts when the current user records their first opinion in this session
    const firstUserReadTimestamp = enhancedEvents
      .map((event) => event.imageReading?.reads?.[data.currentUser.id]?.timestamp)
      .filter(Boolean)
      .sort((a, b) => new Date(a) - new Date(b))[0]

    const autoFinaliseAt = firstUserReadTimestamp
      ? dayjs(firstUserReadTimestamp)
          .add(autoFinaliseWindowMinutes, 'minute')
          .toISOString()
      : dayjs().add(autoFinaliseWindowMinutes, 'minute').toISOString()

    // Clear any lingering opinion banner from a previous session
    delete data.readingOpinionBanner

    // Get clinic data if this is a clinic session
    let clinic = null
    if (session.clinicId) {
      clinic = data.clinics.find((c) => c.id === session.clinicId)
    }

    res.render('reading/session', {
      session,
      events: enhancedEvents,
      readingStatus,
      resumeEvent,
      autoFinaliseAt,
      clinic,
      view: selectedView
    })
  })

  // Middleware to make sure pages have the right data
  router.use(
    '/reading/session/:sessionId/events/:eventId',
    (req, res, next) => {
      const data = req.session.data
      const { sessionId, eventId } = req.params
      const currentUserId = data.currentUser?.id

      // Get the batch
      const session = getReadingSession(data, sessionId)
      if (!session) {
        // req.flash('error', 'Session not found')
        console.log('Session not found')
        return res.redirect('/reading')
      }

      // Check if event exists in this session
      if (!session.eventIds.includes(eventId)) {
        // req.flash('error', 'Event not found in this session')
        console.log(`Event ${sessionId} not found in this session`)
        return res.redirect(`/reading/session/${sessionId}`)
      }

      // Get the event data
      const event = data.events.find((e) => e.id === eventId)
      if (!event) {
        // req.flash('error', 'Event not found')
        console.log(`Event ${eventId} not found`)
        return res.redirect(`/reading/session/${sessionId}`)
      }

      // Get participant and clinic data
      const participant = data.participants.find(
        (p) => p.id === event.participantId
      )
      const clinic = data.clinics.find((c) => c.id === event.clinicId)
      const unit = data.breastScreeningUnits.find(
        (u) => u.id === clinic.breastScreeningUnitId
      )
      const location = unit.locations.find((l) => l.id === clinic.locationId)

      // Get reading progress for this session
      const progress = getSessionReadingProgress(data, sessionId, eventId)

      // Initialise or update imageReadingTemp for this event
      // Only do this on GET requests - POST requests should preserve form data
      if (req.method === 'GET') {
        if (
          !data.imageReadingTemp ||
          data.imageReadingTemp.eventId !== eventId
        ) {
          const existingRead = event.imageReading?.reads?.[currentUserId]
          if (existingRead) {
            // User has already read this event - populate temp from saved read
            console.log(
              `Loading existing read for event ${eventId} into imageReadingTemp`
            )
            data.imageReadingTemp = {
              eventId: eventId,
              ...existingRead
            }
          } else {
            // No existing read - initialise empty temp with eventId
            console.log(`Initialising imageReadingTemp for event ${eventId}`)
            data.imageReadingTemp = { eventId: eventId }
          }
          // Update res.locals.data to reflect the change (it was set before this middleware)
          res.locals.data.imageReadingTemp = data.imageReadingTemp
        }

        // Pass along opinion banner and remove from session
        // Bypassing req.flash as we couldn't get it to work - possibly due to redirect loops
        // Not great we're hardcoding these pages. Would be better to have a more general mechanism.
        if (
          (req.path.endsWith('/opinion') ||
            req.path.endsWith('/existing-read')) &&
          data.readingOpinionBanner
        ) {
          res.locals.readingOpinionBanner = data.readingOpinionBanner
          delete data.readingOpinionBanner
        }
      }

      // Set up locals for templates
      res.locals.isReadingWorkflow = true
      res.locals.session = session
      res.locals.eventData = { clinic, event, participant, unit, location }
      res.locals.clinic = clinic
      res.locals.event = event
      res.locals.participant = participant
      res.locals.unit = unit
      res.locals.location = location
      res.locals.sessionId = sessionId
      res.locals.eventId = eventId
      res.locals.progress = progress

      next()
    }
  )

  // Route for event reading within a batch
  // Redirects to existing-read if user has already read, otherwise to opinion
  router.get('/reading/session/:sessionId/events/:eventId', (req, res) => {
    const data = req.session.data
    const { sessionId, eventId } = req.params
    const currentUserId = data.currentUser?.id

    // Find the event
    const event = data.events.find((e) => e.id === eventId)
    if (!event) {
      return res.redirect(`/reading/session/${sessionId}`)
    }

    // Check if user has already read this event
    if (userHasReadEvent(event, currentUserId)) {
      return res.redirect(
        `/reading/session/${sessionId}/events/${eventId}/existing-read`
      )
    }

    // Check if event is awaiting priors (user or someone else requested)
    const { awaitingPriors } = require('../lib/utils/prior-mammograms')
    if (awaitingPriors(event)) {
      return res.redirect(
        `/reading/session/${sessionId}/events/${eventId}/existing-read`
      )
    }

    // Delete temporary data from previous steps
    delete data.imageReadingTemp

    res.redirect(`/reading/session/${sessionId}/events/${eventId}/opinion`)
  })

  // Handle skipping an event in a batch
  router.get('/reading/session/:sessionId/events/:eventId/skip', (req, res) => {
    const data = req.session.data
    const { sessionId, eventId } = req.params

    // Mark as skipped
    skipEventInSession(data, sessionId, eventId)

    // Top up the batch with the next eligible event if under target size
    topUpSession(data, sessionId)

    // Find next readable event after current position (no wrap)
    const currentUserId = data.currentUser.id
    const session = getReadingSession(data, sessionId)
    const sessionEvents = session.eventIds
      .map((id) => data.events.find((e) => e.id === id))
      .filter(Boolean)
    const nextUnreadEvent = getNextUserReadableEvent(
      sessionEvents,
      eventId,
      currentUserId,
      { wrap: false }
    )

    if (nextUnreadEvent) {
      res.redirect(`/reading/session/${sessionId}/events/${nextUnreadEvent.id}`)
    } else if (session.skippedEvents.length > 0) {
      res.redirect(`/reading/session/${sessionId}/skipped-review`)
    } else {
      res.redirect(`/reading/session/${sessionId}`)
    }
  })

  // Handle requesting prior images during reading
  router.post(
    '/reading/session/:sessionId/events/:eventId/request-priors-answer',
    (req, res) => {
      const data = req.session.data
      const { sessionId, eventId } = req.params
      const currentUserId = data.currentUser?.id

      // Get the IDs of mammograms to request
      let requestPriorIds = req.body.requestPriorIds || []
      if (!Array.isArray(requestPriorIds)) {
        requestPriorIds = [requestPriorIds]
      }

      const reason = req.body.requestPriorReason || ''

      // Find the event in the main events array
      const event = data.events.find((e) => e.id === eventId)
      if (event && event.previousMammograms) {
        event.previousMammograms.forEach((mammogram) => {
          if (requestPriorIds.includes(mammogram.id)) {
            mammogram.requestStatus = 'pending'
            mammogram.requestedDate = new Date().toISOString()
            mammogram.requestedBy = currentUserId
            if (reason) {
              mammogram.requestReason = reason
            }
          }
        })

        // Also update the mirrored event in data.event
        if (data.event && data.event.id === eventId) {
          data.event.previousMammograms = event.previousMammograms
        }
      }

      // Top up the batch with the next eligible event if under target size
      topUpSession(data, sessionId)

      // Find next readable event in batch after the current position, wrapping
      // to the start if needed. This mirrors the navigation in save-opinion.
      const session = getReadingSession(data, sessionId)
      const sessionEvents = session.eventIds
        .map((id) => data.events.find((e) => e.id === id))
        .filter(Boolean)
      const nextUnreadEvent = getNextUserReadableEvent(
        sessionEvents,
        eventId,
        currentUserId,
        { wrap: false }
      )

      // Only store the banner if there is a next case to show it on
      if (nextUnreadEvent) {
        const participant = data.participants.find(
          (person) => person.id === event.participantId
        )
        const shortName = getShortName(participant)
        data.readingOpinionBanner = {
          text: `Prior images requested for ${shortName}`,
          participantName: `${shortName}`,
          editHref: `/reading/session/${sessionId}/events/${eventId}/existing-read`
        }
        res.redirect(
          `/reading/session/${sessionId}/events/${nextUnreadEvent.id}`
        )
      } else if (session.skippedEvents.length > 0) {
        res.redirect(`/reading/session/${sessionId}/skipped-review`)
      } else {
        res.redirect(`/reading/session/${sessionId}`)
      }
    }
  )

  // Undo prior image requests - resets mammograms requested by current user
  // back to not_requested, allowing the reader to read the case
  // Supports GET (summary list action link) and POST
  router.all(
    '/reading/session/:sessionId/events/:eventId/undo-priors',
    (req, res) => {
      const data = req.session.data
      const { sessionId, eventId } = req.params
      const currentUserId = data.currentUser?.id

      const event = data.events.find((e) => e.id === eventId)
      if (event && event.previousMammograms) {
        event.previousMammograms.forEach((mammogram) => {
          if (
            mammogram.requestStatus === 'pending' &&
            mammogram.requestedBy === currentUserId
          ) {
            mammogram.requestStatus = 'not_requested'
            delete mammogram.requestedDate
            delete mammogram.requestedBy
            delete mammogram.requestReason
          }
        })

        // Also update the mirrored event in data.event
        if (data.event && data.event.id === eventId) {
          data.event.previousMammograms = event.previousMammograms
        }
      }

      // Redirect to opinion page so the reader can now read the case
      res.redirect(`/reading/session/${sessionId}/events/${eventId}/opinion`)
    }
  )

  // Render appropriate template for reading views
  router.get(
    '/reading/session/:sessionId/events/:eventId/:step',
    (req, res, next) => {
      const { sessionId, eventId, step } = req.params

      // Workflow steps (in reading/workflow/ folder)
      const workflowSteps = [
        'opinion',
        'normal-details',
        'confirm-normal',
        'technical-recall',
        'recall-for-assessment-details',
        'annotation',
        'annotation-simple',
        'annotate-v2',
        'confirm-abnormal',
        'recommended-assessment',
        'review',
        'existing-read',
        'compare',
        'request-priors',
        'medical-information'
      ]

      if (workflowSteps.includes(step)) {
        return res.render(`reading/workflow/${step}`)
      }

      return next()
    }
  )

  // Annotations start

  // Add annotation - clear temp data and redirect to form
  router.get(
    '/reading/session/:sessionId/events/:eventId/annotation/add',
    (req, res) => {
      const { side } = req.query
      const data = req.session.data

      // Validate side parameter
      if (!side || !['left', 'right'].includes(side)) {
        return res.redirect(
          `/reading/session/${req.params.sessionId}/events/${req.params.eventId}/recall-for-assessment-details`
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

      data.imageReadingTemp.annotationTemp = {
        side: side,
        annotationNumber: annotationNumber
      }

      // Redirect to simple (no-image) view when requested
      const target =
        req.query.simple === 'true' ? 'annotation-simple' : 'annotation'
      res.redirect(
        `/reading/session/${req.params.sessionId}/events/${req.params.eventId}/${target}`
      )
    }
  )

  // Edit existing annotation
  router.get(
    '/reading/session/:sessionId/events/:eventId/annotation/edit/:annotationId',
    (req, res) => {
      const { sessionId, eventId, annotationId } = req.params
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

      // Simple annotations have no positions — redirect to the simple form
      const isSimple = !annotation?.positions || Object.keys(annotation.positions || {}).length === 0
      const editTarget = isSimple ? 'annotation-simple' : 'annotation'
      res.redirect(`/reading/session/${sessionId}/events/${eventId}/${editTarget}`)
    }
  )

  // Save annotation - handles both 'save' and 'save-and-add'
  router.post(
    '/reading/session/:sessionId/events/:eventId/annotation/save',
    (req, res) => {
      const { sessionId, eventId } = req.params
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

      console.log(`annotation temp: ${JSON.stringify(annotationTemp)}`)

      if (!annotationTemp) {
        return res.redirect(
          `/reading/session/${sessionId}/events/${eventId}/recall-for-assessment-details`
        )
      }

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
        // Parse and validate positions have at least one marker
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
            text: `Mark the location on both ${annotationTemp.side} breast views`,
            name: 'positions',
            href: '#mammogram-section'
          })
        }
      }

      // Validate required fields

      // Text location not in use
      // if (!annotationTemp.location || annotationTemp.location.trim() === '') {
      //   errors.push({
      //     text: 'Enter the location of the abnormality',
      //     name: 'imageReadingTemp[annotationTemp][location]',
      //     href: '#location'
      //   })
      // }

      if (
        !annotationTemp.abnormalityType ||
        annotationTemp.abnormalityType.length === 0
      ) {
        errors.push({
          text: 'Select at least one abnormality type',
          name: 'imageReadingTemp[annotationTemp][abnormalityType]',
          href: '#abnormalityType'
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
        annotationTemp.abnormalityType &&
        annotationTemp.abnormalityType.length > 0
      ) {
        const abnormalityTypes = Array.isArray(annotationTemp.abnormalityType)
          ? annotationTemp.abnormalityType
          : [annotationTemp.abnormalityType]

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
          `/reading/session/${sessionId}/events/${eventId}/annotation`
        )
      }

      // Continue with existing save logic...
      if (data.imageReadingTemp?.annotationTemp) {
        const side = annotationTemp.side
        const comment = annotationTemp.comment
        const isNewAnnotation = !annotationTemp.id

        if (!side) {
          return res.redirect(
            `/reading/session/${sessionId}/events/${eventId}/recall-for-assessment-details`
          )
        }

        // Initialize side data if needed
        if (!data.imageReadingTemp[side]) {
          data.imageReadingTemp[side] = {}
        }
        if (!data.imageReadingTemp[side].annotations) {
          data.imageReadingTemp[side].annotations = []
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
          abnormalityType: annotationTemp.abnormalityType,
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
      }

      // Redirect based on action
      if (action === 'save-and-add') {
        const side =
          req.body.side || data.imageReadingTemp?.annotationTemp?.side
        res.redirect(
          `/reading/session/${sessionId}/events/${eventId}/annotation/add?side=${side}`
        )
      } else {
        res.redirect(
          `/reading/session/${sessionId}/events/${eventId}/recall-for-assessment-details`
        )
      }
    }
  )

  // Delete annotation
  router.get(
    '/reading/session/:sessionId/events/:eventId/annotation/delete/:annotationId',
    (req, res) => {
      const { sessionId, eventId, annotationId } = req.params
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
        `/reading/session/${sessionId}/events/${eventId}/recall-for-assessment-details`
      )
    }
  )

  // Save annotation without image markers
  router.post(
    '/reading/session/:sessionId/events/:eventId/annotation-simple/save',
    (req, res) => {
      const { sessionId, eventId } = req.params
      const data = req.session.data
      const action = req.body.action || 'save'

      const annotationTemp = data.imageReadingTemp?.annotationTemp

      if (!annotationTemp) {
        return res.redirect(
          `/reading/session/${sessionId}/events/${eventId}/recall-for-assessment-details`
        )
      }

      // Validate required fields (no position validation for this route)
      const errors = []

      if (!annotationTemp.location || annotationTemp.location.trim() === '') {
        errors.push({
          text: 'Enter a location for the abnormality',
          name: 'imageReadingTemp[annotationTemp][location]',
          href: '#location'
        })
      }

      if (
        !annotationTemp.abnormalityType ||
        annotationTemp.abnormalityType.length === 0
      ) {
        errors.push({
          text: 'Select an abnormality type',
          name: 'imageReadingTemp[annotationTemp][abnormalityType]',
          href: '#abnormalityType'
        })
      }

      if (!annotationTemp.levelOfConcern) {
        errors.push({
          text: 'Select a level of concern',
          name: 'imageReadingTemp[annotationTemp][levelOfConcern]',
          href: '#levelOfConcern'
        })
      }

      if (
        annotationTemp.abnormalityType === 'Other' &&
        (!annotationTemp.otherDetails ||
          annotationTemp.otherDetails.trim() === '')
      ) {
        errors.push({
          text: 'Provide details for other abnormality type',
          name: 'imageReadingTemp[annotationTemp][otherDetails]',
          href: '#otherDetails'
        })
      }

      if (errors.length > 0) {
        errors.forEach((error) => req.flash('error', error))
        return res.redirect(
          `/reading/session/${sessionId}/events/${eventId}/annotation-simple`
        )
      }

      const side = annotationTemp.side
      if (!side) {
        return res.redirect(
          `/reading/session/${sessionId}/events/${eventId}/recall-for-assessment-details`
        )
      }

      if (!data.imageReadingTemp[side]) data.imageReadingTemp[side] = {}
      if (!data.imageReadingTemp[side].annotations)
        data.imageReadingTemp[side].annotations = []

      const annotation = {
        id: annotationTemp.id || generateId(),
        side,
        location: annotationTemp.location || null,
        abnormalityType: annotationTemp.abnormalityType,
        levelOfConcern: annotationTemp.levelOfConcern,
        comment: annotationTemp.comment || null,
        positions: null,
        ...Object.keys(annotationTemp)
          .filter((key) => key.endsWith('Details'))
          .reduce((acc, key) => {
            acc[key] = annotationTemp[key]
            return acc
          }, {})
      }

      const existingIndex = data.imageReadingTemp[side].annotations.findIndex(
        (a) => a.id === annotation.id
      )
      if (existingIndex !== -1) {
        data.imageReadingTemp[side].annotations[existingIndex] = annotation
      } else {
        data.imageReadingTemp[side].annotations.push(annotation)
      }

      delete data.imageReadingTemp.annotationTemp

      if (action === 'save-and-add') {
        res.redirect(
          `/reading/session/${sessionId}/events/${eventId}/annotation/add?side=${side}&simple=true`
        )
      } else {
        res.redirect(
          `/reading/session/${sessionId}/events/${eventId}/recall-for-assessment-details`
        )
      }
    }
  )

  // Save all annotations from the v2 3-column annotation tool
  router.post(
    '/reading/session/:sessionId/events/:eventId/annotate-v2/save',
    (req, res) => {
      const { sessionId, eventId } = req.params
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
        `/reading/session/${sessionId}/events/${eventId}/recall-for-assessment-details`
      )
    }
  )

  // Annotations end

  // Handle technical recall form submission
  // Cleans up the data structure to only include selected views, then redirects to review
  router.post(
    '/reading/session/:sessionId/events/:eventId/technical-recall-answer',
    (req, res) => {
      const { sessionId, eventId } = req.params
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

      // 307 preserves POST method so opinion-details-complete can 307 to save-opinion
      // if the confirm-technical-recall setting is off
      res.redirect(
        307,
        `/reading/session/${sessionId}/events/${eventId}/opinion-details-complete`
      )
    }
  )

  // Central routing point after all opinion detail pages are complete.
  // Handles late comparison check and decides whether to show review or save directly.
  // All detail pages (normal-details, technical-recall, recall-for-assessment-details)
  // should route here on completion.
  router.all(
    '/reading/session/:sessionId/events/:eventId/opinion-details-complete',
    (req, res) => {
      const { sessionId, eventId } = req.params
      const data = req.session.data
      const currentUserId = data.currentUser?.id
      const formData = data.imageReadingTemp
      const opinion = formData?.opinion

      const event = data.events.find((e) => e.id === eventId)
      if (!event) return res.redirect(`/reading/session/${sessionId}`)

      // Check for late comparison if not already done
      const comparisonSetting = data.settings?.reading?.secondReaderComparison
      if (comparisonSetting === 'late' && !formData?.comparisonComplete) {
        if (
          shouldShowComparePage(event, formData, currentUserId, data.settings)
        ) {
          return res.redirect(
            `/reading/session/${sessionId}/events/${eventId}/compare`
          )
        }
      }

      // Route based on opinion type
      switch (opinion) {
        case 'normal':
          // opinion-details-complete is only reached for normal when the user
          // went through the normal-details page, so use confirmNormalWithDetails
          if (data.settings?.reading?.confirmNormalWithDetails === 'true') {
            return res.redirect(
              `/reading/session/${sessionId}/events/${eventId}/confirm-normal`
            )
          }
          return res.redirect(
            307,
            `/reading/session/${sessionId}/events/${eventId}/save-opinion`
          )
        case 'technical_recall':
          if (data.settings?.reading?.confirmTechnicalRecall !== 'false') {
            return res.redirect(
              `/reading/session/${sessionId}/events/${eventId}/review`
            )
          }
          return res.redirect(
            307,
            `/reading/session/${sessionId}/events/${eventId}/save-opinion`
          )
        case 'recall_for_assessment':
          if (data.settings?.reading?.confirmRecallForAssessment !== 'false') {
            return res.redirect(
              `/reading/session/${sessionId}/events/${eventId}/review`
            )
          }
          return res.redirect(
            307,
            `/reading/session/${sessionId}/events/${eventId}/save-opinion`
          )
        default:
          return res.redirect(
            `/reading/session/${sessionId}/events/${eventId}/review`
          )
      }
    }
  )

  // Handle recording a reading result
  // Save the reading opinion - reads opinion from imageReadingTemp.opinion
  router.post(
    '/reading/session/:sessionId/events/:eventId/save-opinion',
    (req, res) => {
      const { sessionId, eventId } = req.params
      const data = req.session.data
      const currentUserId = data.currentUser.id
      const formData = data.imageReadingTemp

      if (!formData || !formData.opinion) {
        console.log('No opinion in imageReadingTemp - cannot save')
        return res.redirect(`/reading/session/${sessionId}/events/${eventId}`)
      }

      // Find the event
      const event = data.events.find((e) => e.id === eventId)
      if (!event) {
        return res.redirect(`/reading/session/${sessionId}`)
      }

      delete data.imageReadingTemp
      delete res.locals.data?.imageReadingTemp

      // Create and save the reading
      const readResult = {
        readerId: currentUserId,
        readerType: data.currentUser.role,
        ...formData,
        timestamp: new Date().toISOString()
      }

      // Write the reading (passing session context to handle skipped events)
      writeReading(event, currentUserId, readResult, data, sessionId)

      // Top up the session with the next eligible event if under target size
      topUpSession(data, sessionId)

      // Find next unread event in session after the current position (no wrap)
      const session = getReadingSession(data, sessionId)
      const sessionEvents = session.eventIds
        .map((id) => data.events.find((e) => e.id === id))
        .filter(Boolean)
      const nextUnreadEvent = getNextUserReadableEvent(
        sessionEvents,
        eventId,
        currentUserId,
        { wrap: false }
      )

      // Store banner message for the next case, but only if there is one
      // Bypassing req.flash as we couldn't get it to work - possibly due to redirect loops
      // Todo: can we get this working with req.flash?
      if (nextUnreadEvent) {
        const participant = data.participants.find(
          (person) => person.id === event.participantId
        )
        const shortName = getShortName(participant)
        const resultLabels = {
          normal: 'Normal',
          technical_recall: 'Technical recall',
          recall_for_assessment: 'Recall for assessment'
        }
        const resultLabel = resultLabels[formData.opinion] || 'Opinion'
        const message = `${resultLabel} opinion recorded for ${shortName}`

        data.readingOpinionBanner = {
          text: message,
          participantName: `${shortName}`, // This didn't work when used directly - coerced to string instead.
          editHref: `/reading/session/${sessionId}/events/${eventId}/existing-read`
        }
      }

      // Redirect to next unread event or end-of-session page
      if (nextUnreadEvent) {
        res.redirect(
          modalBreakout(
            `/reading/session/${sessionId}/events/${nextUnreadEvent.id}`
          )
        )
      } else if (session.skippedEvents.length > 0) {
        res.redirect(
          modalBreakout(`/reading/session/${sessionId}/skipped-review`)
        )
      } else {
        res.redirect(modalBreakout(`/reading/session/${sessionId}`))
      }
    }
  )

  // Handle opinion form submission - stores result and routes to appropriate next step
  router.post(
    '/reading/session/:sessionId/events/:eventId/opinion-answer',
    (req, res) => {
      const { sessionId, eventId } = req.params
      const data = req.session.data

      // Debug logging
      console.log('opinion-answer received')
      console.log(
        'imageReadingTemp:',
        JSON.stringify(data.imageReadingTemp, null, 2)
      )

      // Opinion and previousOpinion are auto-saved to data.imageReadingTemp via form binding
      const opinion = data.imageReadingTemp?.opinion
      const previousOpinion = data.imageReadingTemp?.previousOpinion

      console.log('opinion:', opinion)
      console.log('previousOpinion:', previousOpinion)

      const event = data.events.find((e) => e.id === eventId)
      if (!event) return res.redirect(`/reading/session/${sessionId}`)

      // Ensure eventId is set for tracking
      if (!data.imageReadingTemp) {
        data.imageReadingTemp = { eventId: eventId }
      }
      data.imageReadingTemp.eventId = eventId

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

      // Check for early comparison (second reader only, not normal+normal)
      const comparisonSetting = data.settings?.reading?.secondReaderComparison
      if (comparisonSetting === 'early') {
        const currentUserId = data.currentUser?.id
        if (
          shouldShowComparePage(
            event,
            data.imageReadingTemp,
            currentUserId,
            data.settings
          )
        ) {
          // Second reader with opinions that need comparison
          return res.redirect(
            `/reading/session/${sessionId}/events/${eventId}/compare`
          )
        }
      }

      // Handle different opinion types
      switch (opinion) {
        case 'normal':
          // For late comparison, normal still needs to go through compare if discordant
          // (since there's no review page to intercept)
          if (comparisonSetting === 'late') {
            if (
              shouldShowComparePage(
                event,
                data.imageReadingTemp,
                data.currentUser?.id,
                data.settings
              )
            ) {
              return res.redirect(
                `/reading/session/${sessionId}/events/${eventId}/compare`
              )
            }
          }
          if (data.settings.reading.confirmNormal === 'true') {
            return res.redirect(
              `/reading/session/${sessionId}/events/${eventId}/confirm-normal`
            )
          } else {
            return res.redirect(
              307,
              `/reading/session/${sessionId}/events/${eventId}/save-opinion`
            )
          }
        case 'normal_with_details':
          // Result already set to 'normal' above - go to details page
          return res.redirect(
            `/reading/session/${sessionId}/events/${eventId}/normal-details`
          )
        case 'technical_recall':
          return res.redirect(
            `/reading/session/${sessionId}/events/${eventId}/technical-recall`
          )
        case 'recall_for_assessment':
          return res.redirect(
            `/reading/session/${sessionId}/events/${eventId}/recall-for-assessment-details`
          )
        default:
          return res.redirect(`/reading/session/${sessionId}/events/${eventId}`)
      }
    }
  )

  // Handle compare decision - keep opinion or adopt first reader's
  router.post(
    '/reading/session/:sessionId/events/:eventId/compare-answer',
    (req, res) => {
      const { sessionId, eventId } = req.params
      const data = req.session.data
      const decision = req.body.compareDecision
      const currentUserId = data.currentUser?.id

      const event = data.events.find((e) => e.id === eventId)
      if (!event) return res.redirect(`/reading/session/${sessionId}`)

      const opinion = data.imageReadingTemp?.opinion
      const comparisonInfo = getComparisonInfo(
        event,
        data.imageReadingTemp,
        currentUserId
      )
      const firstOpinion = comparisonInfo?.firstOpinion
      const forceNormalDetailsForDiscordantNormal =
        opinion === 'normal' && comparisonInfo?.discordant

      // Mark comparison as complete so save-opinion doesn't redirect back here
      data.imageReadingTemp.comparisonComplete = true

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

        // Go straight to review since we have complete data
        return res.redirect(
          `/reading/session/${sessionId}/events/${eventId}/review`
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
          `/reading/session/${sessionId}/events/${eventId}/opinion-details-complete`
        )
      }

      switch (opinion) {
        case 'normal':
          // Check if user originally wanted to add details
          if (wantsNormalDetails || forceNormalDetailsForDiscordantNormal) {
            return res.redirect(
              `/reading/session/${sessionId}/events/${eventId}/normal-details`
            )
          } else if (data.settings.reading.confirmNormal === 'true') {
            return res.redirect(
              `/reading/session/${sessionId}/events/${eventId}/confirm-normal`
            )
          } else {
            return res.redirect(
              307,
              `/reading/session/${sessionId}/events/${eventId}/save-opinion`
            )
          }
        case 'technical_recall':
          return res.redirect(
            `/reading/session/${sessionId}/events/${eventId}/technical-recall`
          )
        case 'recall_for_assessment':
          return res.redirect(
            `/reading/session/${sessionId}/events/${eventId}/recall-for-assessment-details`
          )
        default:
          return res.redirect(`/reading/session/${sessionId}/events/${eventId}`)
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

    // Get all recent readings across all events - last 30 days
    const thirtyDaysAgo = dayjs().subtract(30, 'days').toISOString()

    // Collect all readings from events
    const allReadings = []

    data.events.forEach((event) => {
      if (!event.imageReading?.reads) return

      const eventReadings = Object.entries(event.imageReading.reads).map(
        ([readerId, reading]) => {
          // Determine if this is a first or second read
          const readingsForEvent = Object.values(event.imageReading.reads)
          const sortedReadings = [...readingsForEvent].sort(
            (a, b) => new Date(a.timestamp) - new Date(b.timestamp)
          )

          const readOrder = sortedReadings.findIndex(
            (r) => r.readerId === readerId
          )

          const readType =
            readOrder === 0
              ? 'first'
              : readOrder === 1
                ? 'second'
                : 'arbitration'

          // Get participant info
          const participant = data.participants.find(
            (p) => p.id === event.participantId
          )

          // Get batch ID if available
          let sessionId = null
          if (data.readingSessions) {
            for (const [id, session] of Object.entries(data.readingSessions)) {
              if (session.eventIds.includes(event.id)) {
                sessionId = id
                break
              }
            }
          }

          return {
            eventId: event.id,
            clinicId: event.clinicId,
            sessionId,
            readerId: reading.readerId,
            readType,
            opinion: reading.opinion,
            timestamp: reading.timestamp,
            participant
          }
        }
      )

      allReadings.push(...eventReadings)
    })

    // Filter for recent readings
    const recentReadings = allReadings
      .filter((reading) => reading.timestamp > thirtyDaysAgo)
      .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))

    // Determine which readings to display based on view
    let readings = []
    if (view === 'mine') {
      readings = recentReadings.filter(
        (reading) => reading.readerId === currentUserId
      )
    } else {
      readings = recentReadings
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

        // Count cases the user has "dealt with" — either given an opinion or requested priors
        // This is separate from userReadCount so the utility stays semantically pure
        const sessionEvents = session.eventIds
          .map((id) => data.events.find((e) => e.id === id))
          .filter(Boolean)
        const userCompletedCount = sessionEvents.filter(
          (event) =>
            userHasReadEvent(event, currentUserId) ||
            userRequestedPriors(event, currentUserId)
        ).length

        return {
          ...session,
          progress,
          userCompletedCount
        }
      })
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))

    res.render('reading/history', {
      readings,
      sessions,
      view
    })
  })
}
