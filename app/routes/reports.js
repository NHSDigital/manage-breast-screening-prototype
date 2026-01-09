// app/routes/reports.js

const { getClinicEvents } = require('../lib/utils/clinics')

module.exports = (router) => {
  router.use('/reports', (req, res, next) => {
    res.locals.navActive = 'reports'
    next()
  })

  // Main reports index page with cards
  router.get('/reports', (req, res) => {
    res.render('reports/index')
  })

  // Screening reports handler function
  const screeningReportsHandler = (req, res) => {
    const data = req.session.data
    // Extract view from path - default to 'by-clinic'
    const pathParts = req.path.split('/')
    const view =
      pathParts[pathParts.length - 1] === 'screening'
        ? 'by-clinic'
        : pathParts[pathParts.length - 1]

    if (!data.clinics) {
      return res.render('reports/screening/index', {
        clinics: [],
        view
      })
    }

    const clinics = data.clinics.map((clinic) => {
      const unit = data.breastScreeningUnits.find(
        (u) => u.id === clinic.breastScreeningUnitId
      )

      let location = {}
      if (unit && unit.locations) {
        location = unit.locations.find((l) => l.id === clinic.locationId)
      }

      // Get events count for context
      const events = getClinicEvents(data.events, clinic.id)

      return {
        ...clinic,
        unit,
        location,
        events
      }
    })

    res.render('reports/screening/index', {
      clinics,
      view
    })
  }

  // Screening reports routes - MUST come before :clinicId route
  router.get('/reports/screening', screeningReportsHandler)
  router.get('/reports/screening/by-clinic', screeningReportsHandler)
  router.get('/reports/screening/by-day', screeningReportsHandler)

  // Individual clinic report - this catches any other /reports/:id pattern
  router.get('/reports/:clinicId', (req, res) => {
    const { clinicId } = req.params
    const data = req.session.data

    // Skip if this is actually a screening route
    if (clinicId === 'screening') {
      return screeningReportsHandler(req, res)
    }

    const clinic = data.clinics.find((c) => c.id === clinicId)
    if (!clinic) return res.redirect('/reports/screening')

    const unit = data.breastScreeningUnits.find(
      (u) => u.id === clinic.breastScreeningUnitId
    )
    const location = unit
      ? unit.locations.find((l) => l.id === clinic.locationId)
      : {}
    const events = getClinicEvents(data.events, clinic.id)
    const isClinicClosed = clinic.status === 'closed'

    // Calculate appointment outcomes based on status
    const outcomeCounts = events.reduce(
      (acc, event) => {
        const status = event.status
        if (
          status === 'event_complete' ||
          status === 'event_partially_screened'
        ) {
          acc.screened++
        } else if (status === 'event_did_not_attend') {
          acc.dna++
        } else {
          // Includes scheduled, checked_in, in_progress, paused, etc.
          if (isClinicClosed) {
            // If clinic is closed, count pending as DNA
            acc.dna++
          } else {
            acc.pending++
          }
        }
        return acc
      },
      { screened: 0, dna: 0, pending: 0 }
    )

    res.render('reports/clinic', {
      clinic,
      unit,
      location,
      events,
      outcomeCounts,
      isClinicClosed
    })
  })
}
