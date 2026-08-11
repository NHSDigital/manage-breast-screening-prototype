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
const { getParticipant, getFullName } = require('../lib/utils/participants')
const { updateAppointmentStatus } = require('../lib/utils/appointment-status')
const { getAppointment } = require('../lib/utils/appointment-data')

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

  // Sequential reason collection for attended-not-screened appointments
  router.get('/clinics/:id/close/reason/:appointmentId', (req, res) => {
    const { id, appointmentId } = req.params
    const data = req.session.data
    const queueKey = `closeClinicReasonQueue_${id}`
    const queue = req.session[queueKey] || []

    const appointment = data.appointments.find((a) => a.id === appointmentId)
    if (!appointment) {
      return res.redirect(`/clinics/${id}/close`)
    }

    const participant = getParticipant(data, appointment.participantId)
    const clinic = getClinic(data, id)
    const currentIndex = queue.indexOf(appointmentId)

    // Ensure form data object exists for template access
    if (!data.closeReasonForm) {
      data.closeReasonForm = {}
    }

    res.render('clinics/close-attended-not-screened-reason', {
      clinicId: id,
      clinic,
      appointment,
      participant,
      currentIndex: currentIndex + 1,
      totalCount: queue.length
    })
  })

  router.post('/clinics/:id/close/reason/:appointmentId', (req, res) => {
    const { id, appointmentId } = req.params
    const data = req.session.data
    const queueKey = `closeClinicReasonQueue_${id}`
    const queue = req.session[queueKey] || []

    const appointment = data.appointments.find((a) => a.id === appointmentId)
    if (!appointment) {
      return res.redirect(`/clinics/${id}/close`)
    }

    // Extract form values
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

    // Save the reason data to the appointment
    appointment.appointmentStopped = {
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

    // Clear form data
    delete data.closeReasonForm

    // If reschedule requested, go to reschedule step before advancing
    if (needsReschedule === 'yes') {
      return res.redirect(`/clinics/${id}/close/reschedule/${appointmentId}`)
    }

    // Advance to next in queue or close the clinic
    advanceCloseQueue(req, res, id, appointmentId)
  })

  // Reschedule step within the close loop
  router.get('/clinics/:id/close/reschedule/:appointmentId', (req, res) => {
    const { id, appointmentId } = req.params
    const data = req.session.data
    const queueKey = `closeClinicReasonQueue_${id}`
    const queue = req.session[queueKey] || []

    const appointment = data.appointments.find((a) => a.id === appointmentId)
    if (!appointment) {
      return res.redirect(`/clinics/${id}/close`)
    }

    const participant = getParticipant(data, appointment.participantId)
    const clinic = getClinic(data, id)
    const currentIndex = queue.indexOf(appointmentId)

    // Ensure form data object exists for template access
    if (!data.closeRescheduleForm) {
      data.closeRescheduleForm = {}
    }

    res.render('clinics/close-reschedule', {
      clinicId: id,
      clinic,
      appointment,
      participant,
      currentIndex: currentIndex + 1,
      totalCount: queue.length
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

    // Save reschedule data to the appointment
    appointment.reschedule = {
      timing,
      note: formData.note
    }
    updateAppointmentStatus(data, appointmentId, 'rescheduled')

    // Clear form data
    delete data.closeRescheduleForm

    // Advance to next in queue or close the clinic
    advanceCloseQueue(req, res, id, appointmentId)
  })

  // Shared helper: advance to the next appointment in queue or close the clinic
  const advanceCloseQueue = (req, res, clinicId, currentAppointmentId) => {
    const data = req.session.data
    const queueKey = `closeClinicReasonQueue_${clinicId}`
    const queue = req.session[queueKey] || []
    const currentIndex = queue.indexOf(currentAppointmentId)
    const nextIndex = currentIndex + 1

    if (nextIndex < queue.length) {
      return res.redirect(`/clinics/${clinicId}/close/reason/${queue[nextIndex]}`)
    }

    // Queue complete — close the clinic
    delete req.session[queueKey]

    const clinicIndex = data.clinics.findIndex((c) => c.id === clinicId)
    if (clinicIndex !== -1) {
      const updatedClinic = { ...data.clinics[clinicIndex], status: 'closed' }
      data.clinics[clinicIndex] = updatedClinic
      if (data._changes?.clinics) {
        data._changes.clinics[clinicId] = updatedClinic
      }
      req.flash('success', `Clinic ${updatedClinic.clinicCode} closed`)
    }

    delete req.session[`closeClinicResolved_${clinicId}`]
    res.redirect('/clinics/completed')
  }

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

    // Check for attended-not-screened appointments missing a reason
    const needsReason = clinicAppointments.filter(
      (a) => a.status === 'attended_not_screened' && !a.appointmentStopped?.stoppedReason?.length
    )

    if (needsReason.length > 0) {
      const queueKey = `closeClinicReasonQueue_${id}`
      req.session[queueKey] = needsReason.map((a) => a.id)
      return res.redirect(`/clinics/${id}/close/reason/${needsReason[0].id}`)
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
