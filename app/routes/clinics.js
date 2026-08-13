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
  appendReferrer,
  modalBreakout
} = require('../lib/utils/referrers')
const { getParticipant, getFullName } = require('../lib/utils/participants')
const { updateAppointmentStatus } = require('../lib/utils/appointment-status')
const { getAppointment, updateAppointmentData } = require('../lib/utils/appointment-data')

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

  // Close clinic page
  router.get('/clinics/:id/close', (req, res) => {
    const clinicData = getClinicData(req.session.data, req.params.id)

    if (!clinicData) {
      return res.redirect('/clinics')
    }

    const resolvedKey = `closeClinicResolved_${req.params.id}`

    // Group by status so similar statuses appear together
    const statusOrder = ["in_progress", "paused", "checked_in", "scheduled", "attended_not_screened", "did_not_attend", "complete", "partially_screened", "cancelled", "rescheduled"]
    const sortedAppointments = [...clinicData.appointments].sort((a, b) =>
      statusOrder.indexOf(a.status) - statusOrder.indexOf(b.status)
    )

    res.render('clinics/close', {
      clinicId: req.params.id,
      clinic: clinicData.clinic,
      allAppointments: sortedAppointments
    })
  })

  // Mark appointment as attended not screened from close clinic page
  router.get('/clinics/:id/close/attended-not-screened/:appointmentId', (req, res) => {
    const { id, appointmentId } = req.params
    updateAppointmentStatus(req.session.data, appointmentId, 'attended_not_screened')
    const resolvedKey = `closeClinicResolved_${id}`
    if (!req.session[resolvedKey]) req.session[resolvedKey] = []
    if (!req.session[resolvedKey].includes(appointmentId)) req.session[resolvedKey].push(appointmentId)
    if (req.headers.accept?.includes('application/json')) {
      return res.json({ status: 'success' })
    }
    res.redirect(`/clinics/${id}/close`)
  })

  // Undo attended not screened
  router.get('/clinics/:id/close/undo-attended-not-screened/:appointmentId', (req, res) => {
    const { id, appointmentId } = req.params
    updateAppointmentStatus(req.session.data, appointmentId, 'checked_in')
    const resolvedKey = `closeClinicResolved_${id}`
    if (req.session[resolvedKey]) req.session[resolvedKey] = req.session[resolvedKey].filter((i) => i !== appointmentId)
    if (req.headers.accept?.includes('application/json')) {
      return res.json({ status: 'success' })
    }
    res.redirect(`/clinics/${id}/close`)
  })

  // Mark appointment as did not attend from close clinic page
  router.get('/clinics/:id/close/did-not-attend/:appointmentId', (req, res) => {
    const { id, appointmentId } = req.params
    updateAppointmentStatus(req.session.data, appointmentId, 'did_not_attend')
    const resolvedKey = `closeClinicResolved_${id}`
    if (!req.session[resolvedKey]) req.session[resolvedKey] = []
    if (!req.session[resolvedKey].includes(appointmentId)) req.session[resolvedKey].push(appointmentId)
    if (req.headers.accept?.includes('application/json')) {
      return res.json({ status: 'success' })
    }
    res.redirect(`/clinics/${id}/close`)
  })

  // Undo did not attend
  router.get('/clinics/:id/close/undo-did-not-attend/:appointmentId', (req, res) => {
    const { id, appointmentId } = req.params
    updateAppointmentStatus(req.session.data, appointmentId, 'scheduled')
    const resolvedKey = `closeClinicResolved_${id}`
    if (req.session[resolvedKey]) req.session[resolvedKey] = req.session[resolvedKey].filter((i) => i !== appointmentId)
    if (req.headers.accept?.includes('application/json')) {
      return res.json({ status: 'success' })
    }
    res.redirect(`/clinics/${id}/close`)
  })

  // Bulk mark all checked-in as attended not screened
  router.get('/clinics/:id/close/attended-not-screened-all', (req, res) => {
    const { id } = req.params
    const data = req.session.data
    const appointments = data.appointments.filter(
      (a) => a.clinicId === id && a.status === 'checked_in'
    )
    const resolvedKey = `closeClinicResolved_${id}`
    if (!req.session[resolvedKey]) req.session[resolvedKey] = []
    appointments.forEach((a) => {
      updateAppointmentStatus(data, a.id, 'attended_not_screened')
      if (!req.session[resolvedKey].includes(a.id)) req.session[resolvedKey].push(a.id)
    })
    if (req.headers.accept?.includes('application/json')) {
      return res.json({ status: 'success', count: appointments.length })
    }
    res.redirect(`/clinics/${id}/close`)
  })

  // Bulk undo attended not screened (revert to checked_in)
  router.get('/clinics/:id/close/undo-attended-not-screened-all', (req, res) => {
    const { id } = req.params
    const data = req.session.data
    const resolvedKey = `closeClinicResolved_${id}`
    const resolvedIds = req.session[resolvedKey] || []
    const appointments = data.appointments.filter(
      (a) => a.clinicId === id && a.status === 'attended_not_screened' && resolvedIds.includes(a.id)
    )
    appointments.forEach((a) => {
      updateAppointmentStatus(data, a.id, 'checked_in')
    })
    if (req.session[resolvedKey]) {
      req.session[resolvedKey] = req.session[resolvedKey].filter(
        (i) => !appointments.find((a) => a.id === i)
      )
    }
    if (req.headers.accept?.includes('application/json')) {
      return res.json({ status: 'success', count: appointments.length })
    }
    res.redirect(`/clinics/${id}/close`)
  })

  // Bulk mark all remaining as did not attend
  router.get('/clinics/:id/close/did-not-attend-all', (req, res) => {
    const { id } = req.params
    const data = req.session.data
    const appointments = data.appointments.filter(
      (a) => a.clinicId === id && a.status === 'scheduled'
    )
    const resolvedKey = `closeClinicResolved_${id}`
    if (!req.session[resolvedKey]) req.session[resolvedKey] = []
    appointments.forEach((a) => {
      updateAppointmentStatus(data, a.id, 'did_not_attend')
      if (!req.session[resolvedKey].includes(a.id)) req.session[resolvedKey].push(a.id)
    })
    if (req.headers.accept?.includes('application/json')) {
      return res.json({ status: 'success', count: appointments.length })
    }
    res.redirect(`/clinics/${id}/close`)
  })

  // Bulk undo did not attend (revert to scheduled)
  router.get('/clinics/:id/close/undo-did-not-attend-all', (req, res) => {
    const { id } = req.params
    const data = req.session.data
    const resolvedKey = `closeClinicResolved_${id}`
    const resolvedIds = req.session[resolvedKey] || []
    const appointments = data.appointments.filter(
      (a) => a.clinicId === id && a.status === 'did_not_attend' && resolvedIds.includes(a.id)
    )
    appointments.forEach((a) => {
      updateAppointmentStatus(data, a.id, 'scheduled')
    })
    if (req.session[resolvedKey]) {
      req.session[resolvedKey] = req.session[resolvedKey].filter(
        (i) => !appointments.find((a) => a.id === i)
      )
    }
    if (req.headers.accept?.includes('application/json')) {
      return res.json({ status: 'success', count: appointments.length })
    }
    res.redirect(`/clinics/${id}/close`)
  })

  // Attended-not-screened reason page (opens in modal from close page)
  router.get('/clinics/:id/close/reason/:appointmentId', (req, res) => {
    const { id, appointmentId } = req.params
    const data = req.session.data

    const appointment = data.appointments.find((a) => a.id === appointmentId)
    if (!appointment) {
      return res.redirect(`/clinics/${id}/close`)
    }

    const participant = getParticipant(data, appointment.participantId)
    const clinic = getClinic(data, id)

    // Pre-populate form with existing data, syncing both session and locals
    const formData = appointment.appointmentStopped
      ? { ...appointment.appointmentStopped }
      : {}
    data.closeReasonForm = formData
    res.locals.data.closeReasonForm = formData

    res.render('clinics/close-attended-not-screened-reason', {
      clinicId: id,
      clinic,
      appointment,
      participant
    })
  })

  router.post('/clinics/:id/close/reason/:appointmentId', (req, res) => {
    const { id, appointmentId } = req.params
    const data = req.session.data

    const appointment = data.appointments.find((a) => a.id === appointmentId)
    if (!appointment) {
      return res.redirect(`/clinics/${id}/close`)
    }

    const formData = data.closeReasonForm || {}
    const stoppedReason = formData.stoppedReason
    const needsReschedule = formData.needsReschedule
    const otherDetails = formData.otherDetails
    const hasOtherReasonButNoDetails =
      stoppedReason?.includes('Other reason') && !otherDetails

    // Validation
    if (!stoppedReason || !needsReschedule || hasOtherReasonButNoDetails) {
      if (!stoppedReason) {
        req.flash('error', {
          text: 'Select why this appointment has been stopped',
          name: 'closeReasonForm[stoppedReason]',
          href: '#stoppedReason'
        })
      }
      if (hasOtherReasonButNoDetails) {
        req.flash('error', {
          text: 'Provide details about the other reason',
          name: 'closeReasonForm[otherDetails]',
          href: '#otherDetails'
        })
      }
      if (!needsReschedule) {
        req.flash('error', {
          text: 'Select whether the appointment should be rescheduled',
          name: 'closeReasonForm[needsReschedule]',
          href: '#needsReschedule'
        })
      }
      return res.redirect(`/clinics/${id}/close/reason/${appointmentId}`)
    }

    // Save the reason data to the appointment via updateAppointmentData (not direct mutation)
    updateAppointmentData(data, appointmentId, {
      appointmentStopped: {
        stoppedReason,
        needsReschedule,
        otherDetails: formData.otherDetails,
        failedIdentityDetails: formData.failedIdentityDetails,
        painDetails: formData.painDetails,
        symptomaticDetails: formData.symptomaticDetails,
        consentDetails: formData.consentDetails,
        physicalHealthDetails: formData.physicalHealthDetails,
        mentalHealthDetails: formData.mentalHealthDetails,
        languageDetails: formData.languageDetails,
        mammographerDetails: formData.mammographerDetails,
        technicalDetails: formData.technicalDetails,
        optOutDetails: formData.optOutDetails
      }
    })

    delete data.closeReasonForm

    // If reschedule requested, go to reschedule step
    if (needsReschedule === 'yes') {
      return res.redirect(`/clinics/${id}/close/reschedule/${appointmentId}`)
    }

    // In modal context, close without page reload
    if (req.query._modal === '1' || req.body?._modal === '1') {
      return res.send('')
    }
    res.redirect(`/clinics/${id}/close`)
  })

  // Reschedule step (follows reason page when reschedule selected)
  router.get('/clinics/:id/close/reschedule/:appointmentId', (req, res) => {
    const { id, appointmentId } = req.params
    const data = req.session.data

    const appointment = data.appointments.find((a) => a.id === appointmentId)
    if (!appointment) {
      return res.redirect(`/clinics/${id}/close`)
    }

    const participant = getParticipant(data, appointment.participantId)
    const clinic = getClinic(data, id)

    // Pre-populate form with existing data, syncing both session and locals
    const rescheduleFormData = appointment.reschedule
      ? { ...appointment.reschedule }
      : {}
    data.closeRescheduleForm = rescheduleFormData
    res.locals.data.closeRescheduleForm = rescheduleFormData

    res.render('clinics/close-reschedule', {
      clinicId: id,
      clinic,
      appointment,
      participant
    })
  })

  router.post('/clinics/:id/close/reschedule/:appointmentId', (req, res) => {
    const { id, appointmentId } = req.params
    const data = req.session.data

    const appointment = data.appointments.find((a) => a.id === appointmentId)
    if (!appointment) {
      return res.redirect(`/clinics/${id}/close`)
    }

    const formData = data.closeRescheduleForm || {}
    const timing = formData.timing

    if (!timing) {
      req.flash('error', {
        text: 'Select when the appointment should be rescheduled',
        name: 'closeRescheduleForm[timing]',
        href: '#timing'
      })
      return res.redirect(`/clinics/${id}/close/reschedule/${appointmentId}`)
    }

    updateAppointmentData(data, appointmentId, {
      reschedule: {
        timing,
        note: formData.note
      }
    })
    updateAppointmentStatus(data, appointmentId, 'rescheduled')

    delete data.closeRescheduleForm
    res.redirect(modalBreakout(`/clinics/${id}/close`))
  })

  // Confirm and close clinic
  router.post('/clinics/:id/close', (req, res) => {
    const { id } = req.params
    const data = req.session.data

    // Check all appointments have a final outcome
    const finalStatuses = ['complete', 'partially_screened', 'did_not_attend', 'attended_not_screened', 'cancelled', 'rescheduled']
    const clinicAppointments = data.appointments.filter((a) => a.clinicId === id)
    const unresolved = clinicAppointments.filter((a) => !finalStatuses.includes(a.status))

    if (unresolved.length > 0) {
      req.flash('error', [{
        text: `${unresolved.length} participant${unresolved.length === 1 ? '' : 's'} still need${unresolved.length === 1 ? 's' : ''} an outcome recorded before the clinic can be closed`
      }])
      return res.redirect(`/clinics/${id}/close`)
    }

    // Check attended-not-screened appointments have details recorded
    const ansNeedsDetails = clinicAppointments.filter(
      (a) => a.status === 'attended_not_screened' && !a.appointmentStopped?.stoppedReason?.length
    )

    if (ansNeedsDetails.length > 0) {
      req.flash('error', [{
        text: `${ansNeedsDetails.length} participant${ansNeedsDetails.length === 1 ? '' : 's'} marked as attended not screened still need${ansNeedsDetails.length === 1 ? 's' : ''} details added`
      }])
      return res.redirect(`/clinics/${id}/close`)
    }

    const clinicIndex = data.clinics.findIndex((c) => c.id === id)

    if (clinicIndex !== -1) {
      const updatedClinic = { ...data.clinics[clinicIndex], status: 'closed' }
      data.clinics[clinicIndex] = updatedClinic
      if (data._changes?.clinics) {
        data._changes.clinics[id] = updatedClinic
      }
      req.flash('success', `Clinic ${updatedClinic.clinicCode} closed`)
    }

    // Clean up resolved tracking
    delete req.session[`closeClinicResolved_${id}`]

    res.redirect('/clinics/completed')
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
