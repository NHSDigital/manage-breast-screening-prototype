// app/routes/clinics.js

const dayjs = require('dayjs')

const { getFilteredClinics, getClinicEvents } = require('../lib/utils/clinics')
const { updateEventStatus } = require('../lib/utils/event-data')
const { getParticipant } = require('../lib/utils/participants')
const { getReturnUrl } = require('../lib/utils/referrers')
const { filterEventsByStatus } = require('../lib/utils/status')

/**
 * Get clinic and its related data from id
 */
function getClinicData(data, clinicId) {
  const clinic = data.clinics.find((c) => c.id === clinicId)

  if (!clinic) {
    return null
  }

  // Get all events for this clinic
  const clinicEvents = data.events.filter((e) => e.clinicId === clinic.id)

  // Get all participants for these events and add their details to the events
  const eventsWithParticipants = clinicEvents.map((event) => {
    const participant = getParticipant(data, event.participantId)
    return {
      ...event,
      participant
    }
  })

  // Sort events by appointment time
  const sortedEvents = [...eventsWithParticipants].sort((a, b) => {
    return new Date(a.timing.startTime) - new Date(b.timing.startTime)
  })

  // Get screening unit details
  const unit = data.breastScreeningUnits.find(
    (u) => u.id === clinic.breastScreeningUnitId
  )

  return {
    clinic,
    events: sortedEvents,
    unit
  }
}

module.exports = (router) => {
  // Set clinics to active in nav for all urls starting with /clinics
  router.use('/clinics', (req, res, next) => {
    res.locals.navActive = 'screening'
    next()
  })

  // Redirect to default tab
  router.get('/clinics', (req, res) => {
    res.redirect('/clinics/today')
  })

  // Clinic tab options
  const clinicViews = [
    '/clinics/today',
    '/clinics/upcoming',
    '/clinics/completed',
    '/clinics/all'
  ]

  router.get(clinicViews, (req, res) => {
    const data = req.session.data

    // Extract filter from the URL path
    let filter = req.path.split('/').pop()

    // Check filter from either URL param or query string
    filter = filter || req.query.filter || 'all'

    // Add additional data needed for each clinic
    const clinicsWithData = data.clinics.map((clinic) => {
      const unit = data.breastScreeningUnits.find(
        (u) => u.id === clinic.breastScreeningUnitId
      )
      const location = unit.locations.find((l) => l.id === clinic.locationId)
      const events = getClinicEvents(data.events, clinic.id)

      return {
        ...clinic,
        unit,
        location,
        events
      }
    })

    // Filter for just the clinics we want
    const filteredClinics = getFilteredClinics(clinicsWithData, filter)

    res.render('clinics/index', {
      filter,
      clinics: clinicsWithData,
      filteredClinics,
      formatDate: (date) => dayjs(date).format('D MMMM YYYY')
    })
  })

  // const QUESTIONNAIRE_SECTIONS = ['health-status', 'medical-history', 'current-symptoms']

  // // Helper to get next section
  // const getNextSection = (currentSection) => {
  //   const currentIndex = QUESTIONNAIRE_SECTIONS.indexOf(currentSection)
  //   return QUESTIONNAIRE_SECTIONS[currentIndex + 1]
  // }

  // // Check your answers - route needs to be before later wildcard route
  // router.get('/clinics/:clinicId/participants/:participantId/questionnaire/summary', (req, res) => {
  //   const { clinicId, participantId } = req.params

  //   const participant = req.session.data.participants.find(p => p.id === participantId)
  //   const clinic = req.session.data.clinics.find(c => c.id === clinicId)
  //   const event = req.session.data.events.find(e =>
  //     e.clinicId === clinicId &&
  //     e.participantId === participantId
  //   )

  //   if (!participant || !clinic || !event) {
  //     res.redirect('/clinics/' + clinicId)
  //     return
  //   }

  //   // Collect all questionnaire data
  //   const questionnaireData = QUESTIONNAIRE_SECTIONS.reduce((acc, section) => {
  //     acc[section] = req.session.data[`questionnaire_${section}`] || {}
  //     return acc
  //   }, {})

  //   res.render('participants/questionnaire/summary', {
  //     participant,
  //     clinic,
  //     event,
  //     clinicId,
  //     participantId,
  //     questionnaireData,
  //   })
  // })

  // // Base questionnaire route
  // router.get('/clinics/:clinicId/participants/:participantId/questionnaire/:section', (req, res) => {
  //   const { clinicId, participantId, section } = req.params

  //   // Validate section name
  //   if (!QUESTIONNAIRE_SECTIONS.includes(section)) {
  //     res.redirect(`/clinics/${clinicId}/participants/${participantId}/questionnaire/health-status`)
  //     return
  //   }

  //   const participant = req.session.data.participants.find(p => p.id === participantId)
  //   const clinic = req.session.data.clinics.find(c => c.id === clinicId)
  //   const event = req.session.data.events.find(e =>
  //     e.clinicId === clinicId &&
  //     e.participantId === participantId
  //   )

  //   if (!participant || !clinic || !event) {
  //     res.redirect('/clinics/' + clinicId)
  //     return
  //   }

  //   res.render(`participants/questionnaire/${section}`, {
  //     participant,
  //     clinic,
  //     event,
  //     clinicId,
  //     participantId,
  //     currentSection: section,
  //     sections: QUESTIONNAIRE_SECTIONS,
  //   })
  // })

  // // After summary confirmation, we could save back to participant record
  // router.post('/clinics/:clinicId/participants/:participantId/questionnaire/complete', (req, res) => {
  //   const { clinicId, participantId } = req.params

  //   // Find participant
  //   const participantIndex = req.session.data.participants.findIndex(p => p.id === participantId)

  //   if (participantIndex !== -1) {
  //     // Update participant record with questionnaire data
  //     req.session.data.participants[participantIndex] = {
  //       ...req.session.data.participants[participantIndex],
  //       questionnaire: req.session.data.questionnaire,
  //     }
  //   }

  //   // Clear questionnaire data from session
  //   delete req.session.data.questionnaire

  //   res.redirect(`/clinics/${clinicId}/participants/${participantId}`)
  // })

  // // Handle form submissions
  // router.post('/clinics/:clinicId/participants/:participantId/questionnaire/:section', (req, res) => {
  //   const { clinicId, participantId, section } = req.params

  //   // Get next section
  //   const nextSection = getNextSection(section)

  //   if (nextSection) {
  //     res.redirect(`/clinics/${clinicId}/participants/${participantId}/questionnaire/${nextSection}`)
  //   } else {
  //     res.redirect(`/clinics/${clinicId}/participants/${participantId}/questionnaire/summary`)
  //   }
  // })

  // // Add a convenience redirect from the base questionnaire URL to the first section
  // router.get('/clinics/:clinicId/participants/:participantId/questionnaire', (req, res) => {
  //   const { clinicId, participantId } = req.params
  //   res.redirect(`/clinics/${clinicId}/participants/${participantId}/questionnaire/health-status`)
  // })

  // Handle check-in
  router.get('/clinics/:clinicId/check-in/:eventId', (req, res) => {
    const { clinicId, eventId } = req.params
    const data = req.session.data

    // Get current filter from query param, or default to the current page's filter
    const currentFilter =
      req.query.filter || req.query.currentFilter || 'remaining'

    // Find the event
    const eventIndex = data.events.findIndex(
      (e) => e.id === eventId && e.clinicId === clinicId
    )

    if (eventIndex === -1) {
      if (req.headers.accept?.includes('application/json')) {
        return res.status(404).json({ error: 'Event not found' })
      }
      return res.redirect(`/clinics/${clinicId}/${currentFilter}`)
    }

    // Update the event status
    const event = data.events[eventIndex]

    // Only allow check-in if currently scheduled
    if (event.status !== 'event_scheduled') {
      if (req.headers.accept?.includes('application/json')) {
        return res.status(400).json({ error: 'Event cannot be checked in' })
      }
      return res.redirect(`/clinics/${clinicId}/${currentFilter}`)
    }

    // Update the event
    updateEventStatus(data, eventId, 'event_checked_in')

    // Save back to session
    req.session.data = data

    // If this was an AJAX request, send JSON response
    if (req.headers.accept?.includes('application/json')) {
      return res.json({
        status: 'success',
        event: data.events[eventIndex]
      })
    }

    const returnUrl = getReturnUrl(
      `/clinics/${clinicId}/${currentFilter}`,
      req.query.referrerChain
    )
    res.redirect(returnUrl)
  })

  // Single clinic view
  const VALID_FILTERS = [
    'remaining',
    'scheduled',
    'checked-in',
    'in-progress',
    'complete',
    'all'
  ]

  // Support both /clinics/:id and /clinics/:id/:filter
  router.get(['/clinics/:id', '/clinics/:id/:filter'], (req, res, next) => {
    // Remaining is our default, so we can redirect to /clinics/:id
    if (req.params.filter == 'remaining') {
      res.redirect(`/clinics/${req.params.id}`)
      return
    }

    const clinicData = getClinicData(req.session.data, req.params.id)
    let remainingCount = filterEventsByStatus(
      clinicData.events,
      'remaining'
    ).length

    // Check filter from either URL param or query string
    let defaultFilter = 'remaining'
    if (clinicData.clinic?.status == 'scheduled') {
      defaultFilter = 'all'
    } else if (clinicData.clinic?.status == 'closed' || remainingCount == 0) {
      defaultFilter = 'complete'
    }

    const filter = req.params.filter || req.query.filter || defaultFilter

    // Validate filter
    if (!VALID_FILTERS.includes(filter) || req.params.id == 'reading') {
      // return res.redirect(`/clinics/${req.params.id}`)
      return next()
    }

    if (!clinicData) {
      return res.redirect('/clinics')
    }

    const filteredEvents = filterEventsByStatus(clinicData.events, filter)

    res.render('clinics/show', {
      clinicId: req.params.id,
      clinic: clinicData.clinic,
      allEvents: clinicData.events,
      filteredEvents,
      status: filter,
      unit: clinicData.unit,
      currentFilter: filter,
      formatDate: (date) => dayjs(date).format('D MMMM YYYY'),
      formatTime: (date) => dayjs(date).format('HH:mm')
    })
  })
}
