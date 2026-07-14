// app/routes/clinics.js

const dayjs = require('dayjs')
const {
  getClinic,
  getFilteredClinics,
  getClinicAppointments
} = require('../lib/utils/clinics')
const { filterAppointmentsByStatus } = require('../lib/utils/status')
const {
  getReturnUrl,
  urlWithReferrer,
  appendReferrer
} = require('../lib/utils/referrers')
const { getParticipant } = require('../lib/utils/participants')
const { updateAppointmentStatus } = require('../lib/utils/appointment-status')

/**
 * Get clinic and its related data from id
 */
function getClinicData(data, clinicId) {
  const clinic = getClinic(data, clinicId)

  if (!clinic) {
    return null
  }

  // Get all appointments for this clinic
  const clinicAppointments = data.appointments.filter((e) => e.clinicId === clinic.id)

  // Get all participants for these appointments and add their details to the appointments
  const appointmentsWithParticipants = clinicAppointments.map((appointment) => {
    const participant = getParticipant(data, appointment.participantId)
    return {
      ...appointment,
      participant
    }
  })

  // Sort appointments by appointment time
  const sortedAppointments = [...appointmentsWithParticipants].sort((a, b) => {
    return new Date(a.timing.startTime) - new Date(b.timing.startTime)
  })

  // Get screening unit details
  const unit = data.breastScreeningUnits.find(
    (u) => u.id === clinic.breastScreeningUnitId
  )

  return {
    clinic,
    appointments: sortedAppointments,
    unit
  }
}

module.exports = (router) => {
  // Set clinics to active in nav for all urls starting with /clinics
  router.use('/clinics', (req, res, next) => {
    res.locals.navActive = 'clinics'
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
      const appointments = getClinicAppointments(data.appointments, clinic.id)

      return {
        ...clinic,
        unit,
        location,
        appointments
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

  // Handle check-in
  router.get('/clinics/:clinicId/check-in/:appointmentId', (req, res) => {
    const { clinicId, appointmentId } = req.params
    const data = req.session.data

    // Get current filter from query param, or default to the current page's filter
    const currentFilter =
      req.query.filter || req.query.currentFilter || 'remaining'

    // Find the appointment
    const appointmentIndex = data.appointments.findIndex(
      (e) => e.id === appointmentId && e.clinicId === clinicId
    )

    if (appointmentIndex === -1) {
      if (req.headers.accept?.includes('application/json')) {
        return res.status(404).json({ error: 'Appointment not found' })
      }
      return res.redirect(`/clinics/${clinicId}/${currentFilter}`)
    }

    // Update the appointment status
    const appointment = data.appointments[appointmentIndex]

    // Only allow check-in if currently scheduled
    if (appointment.status !== 'scheduled') {
      if (req.headers.accept?.includes('application/json')) {
        return res.status(400).json({ error: 'Appointment cannot be checked in' })
      }
      return res.redirect(`/clinics/${clinicId}/${currentFilter}`)
    }

    // Update the appointment
    updateAppointmentStatus(data, appointmentId, 'checked_in')

    // Save back to session
    req.session.data = data

    // If this was an AJAX request, send JSON response
    if (req.headers.accept?.includes('application/json')) {
      return res.json({
        status: 'success',
        appointment: data.appointments[appointmentIndex]
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
    let remainingCount = filterAppointmentsByStatus(
      clinicData.appointments,
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

    const filteredAppointments = filterAppointmentsByStatus(clinicData.appointments, filter)

    res.render('clinics/show', {
      clinicId: req.params.id,
      clinic: clinicData.clinic,
      allAppointments: clinicData.appointments,
      filteredAppointments,
      status: filter,
      unit: clinicData.unit,
      currentFilter: filter,
      formatDate: (date) => dayjs(date).format('D MMMM YYYY'),
      formatTime: (date) => dayjs(date).format('HH:mm')
    })
  })
}
