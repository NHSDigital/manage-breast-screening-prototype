// app/routes/clinics.js

const dayjs = require('dayjs')
const {
  getClinic,
  getFilteredClinics,
  getClinicAppointments,
  updateClinic
} = require('../lib/utils/clinics')
const {
  filterAppointmentsByStatus,
  isInProgress,
  isFinal,
  hasStoppedDetails
} = require('../lib/utils/status')
const { getReturnUrl } = require('../lib/utils/referrers')
const { getParticipant } = require('../lib/utils/participants')
const { updateAppointmentStatus } = require('../lib/utils/appointment-status')
const { getAppointment, updateAppointmentData } = require('../lib/utils/appointment-data')
const { pluralise } = require('../lib/utils/strings')

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

// Status changes available from the close clinic page, keyed by the status
// being applied. Marking a final status records the appointment as resolved
// by this close flow, so that undoing 'all' only reverts appointments changed
// here - not ones that were already resolved before the flow started.
const CLOSE_STATUS_ACTIONS = {
  attended_not_screened: { from: 'checked_in', resolves: true },
  did_not_attend: { from: 'scheduled', resolves: true },
  checked_in: { from: 'attended_not_screened', resolves: false },
  scheduled: { from: 'did_not_attend', resolves: false }
}

/**
 * Appointments resolved during this session's close flow, per clinic
 */
const getCloseResolvedIds = (data, clinicId) => {
  return data.closeClinicResolvedIds?.[clinicId] || []
}

/**
 * Record (or forget) appointments as resolved by the close flow
 */
const trackCloseResolvedIds = (data, clinicId, appointmentIds, resolves) => {
  const existing = getCloseResolvedIds(data, clinicId)
  const updated = resolves
    ? [...new Set([...existing, ...appointmentIds])]
    : existing.filter((id) => !appointmentIds.includes(id))

  data.closeClinicResolvedIds = {
    ...data.closeClinicResolvedIds,
    [clinicId]: updated
  }
}

/**
 * Attended not screened but no reasons recorded yet - still needs action
 * before the clinic can close
 */
const needsStoppedDetails = (appointment) => {
  return appointment.status === 'attended_not_screened' && !hasStoppedDetails(appointment)
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
      return res.redirect(`/clinics/${clinicId}/${currentFilter}`)
    }

    // Update the appointment status
    const appointment = data.appointments[appointmentIndex]

    // Only allow check-in if currently scheduled
    if (appointment.status !== 'scheduled') {
      return res.redirect(`/clinics/${clinicId}/${currentFilter}`)
    }

    // Update the appointment
    updateAppointmentStatus(data, appointmentId, 'checked_in')

    // Save back to session
    req.session.data = data

    // Fetch requests get the re-rendered row so the page can update in place
    if (req.xhr) {
      const updatedAppointment = data.appointments[appointmentIndex]
      return res.render('clinics/clinic-appointment-row', {
        appointment: updatedAppointment,
        participant: getParticipant(data, updatedAppointment.participantId),
        clinicId
      })
    }

    const returnUrl = getReturnUrl(
      `/clinics/${clinicId}/${currentFilter}`,
      req.query.referrerChain
    )
    res.redirect(returnUrl)
  })

  // Close clinic flow - resolve the clinic once for every close page
  router.use('/clinics/:clinicId/close', (req, res, next) => {
    const clinic = getClinic(req.session.data, req.params.clinicId)
    if (!clinic) {
      return res.redirect('/clinics')
    }
    res.locals.clinic = clinic
    res.locals.clinicId = clinic.id
    next()
  })

  // Resolve the appointment and participant for close routes acting on one
  const loadCloseAppointment = (req, res, next) => {
    const { clinicId, appointmentId } = req.params
    const data = req.session.data
    const appointment = data.appointments.find(
      (a) => a.id === appointmentId && a.clinicId === clinicId
    )
    if (!appointment) {
      return res.redirect(`/clinics/${clinicId}/close`)
    }
    res.locals.appointment = appointment
    res.locals.participant = getParticipant(data, appointment.participantId)
    next()
  }

  // Close clinic page
  router.get('/clinics/:clinicId/close', (req, res) => {
    const { appointments, unit } = getClinicData(req.session.data, req.params.clinicId)

    // Attended not screened only counts as an outcome once reasons are
    // recorded - until then it stays in the 'needs an outcome' group
    res.render('clinics/close', {
      unit,
      appointmentCount: appointments.length,
      needsOutcomeCount: appointments.filter((a) => !isFinal(a) || needsStoppedDetails(a)).length,
      inProgressAppointments: appointments.filter((a) => isInProgress(a)),
      checkedInAppointments: [
        ...appointments.filter((a) => a.status === 'checked_in'),
        ...appointments.filter((a) => needsStoppedDetails(a))
      ],
      scheduledAppointments: appointments.filter((a) => a.status === 'scheduled'),
      outcomeRecordedAppointments: appointments.filter((a) => isFinal(a) && !needsStoppedDetails(a))
    })
  })

  // Change one appointment's outcome from the close page. GET so the actions
  // work as plain links without JS, mirroring the check-in route above.
  // Fetch requests get the re-rendered row so the page can update in place.
  router.get('/clinics/:clinicId/close/set-status/:appointmentId/:status', loadCloseAppointment, (req, res) => {
    const { clinicId, appointmentId, status } = req.params
    const action = CLOSE_STATUS_ACTIONS[status]
    if (!action) {
      return res.redirect(`/clinics/${clinicId}/close`)
    }

    const data = req.session.data
    updateAppointmentStatus(data, appointmentId, status)
    trackCloseResolvedIds(data, clinicId, [appointmentId], action.resolves)

    if (req.xhr) {
      return res.render('clinics/close-appointment-row', {
        appointment: getAppointment(data, appointmentId),
        showActions: true
      })
    }
    res.redirect(`/clinics/${clinicId}/close`)
  })

  // Bulk version - applies the change to every appointment in the source
  // status. Undoing (back to a non-final status) only touches appointments
  // resolved by this flow.
  router.get('/clinics/:clinicId/close/set-status-all/:status', (req, res) => {
    const { clinicId, status } = req.params
    const action = CLOSE_STATUS_ACTIONS[status]
    if (!action) {
      return res.redirect(`/clinics/${clinicId}/close`)
    }

    const data = req.session.data
    const resolvedIds = getCloseResolvedIds(data, clinicId)
    const appointments = data.appointments.filter((a) =>
      a.clinicId === clinicId &&
      a.status === action.from &&
      (action.resolves || resolvedIds.includes(a.id))
    )

    appointments.forEach((a) => updateAppointmentStatus(data, a.id, status))
    trackCloseResolvedIds(data, clinicId, appointments.map((a) => a.id), action.resolves)

    if (req.xhr) {
      return res.json({
        count: appointments.length,
        appointmentIds: appointments.map((a) => a.id)
      })
    }
    res.redirect(`/clinics/${clinicId}/close`)
  })

  // Re-render a single appointment row - fetched by close-clinic.js after a
  // modal form saves, so the row can update without a page reload
  router.get('/clinics/:clinicId/close/appointment-row/:appointmentId', loadCloseAppointment, (req, res) => {
    res.render('clinics/close-appointment-row', {
      showActions: req.query.showActions === 'true'
    })
  })

  // Attended-not-screened reason page (opens in modal from close page)
  router.get('/clinics/:clinicId/close/reason/:appointmentId', loadCloseAppointment, (req, res) => {
    const data = req.session.data

    // Seed the form from the saved appointment - but not when re-rendering
    // after a validation error, which must keep the user's answers. By this
    // point the locals middleware has moved any flash into res.locals.flash.
    const hasValidationErrors = Boolean(res.locals.flash?.error?.length)
    if (!hasValidationErrors) {
      data.closeReasonForm = structuredClone(res.locals.appointment.appointmentStopped || {})
      res.locals.data.closeReasonForm = data.closeReasonForm
    }

    res.render('clinics/close-attended-not-screened-reason')
  })

  router.post('/clinics/:clinicId/close/reason/:appointmentId', loadCloseAppointment, (req, res) => {
    const { clinicId, appointmentId } = req.params
    const data = req.session.data

    const formData = data.closeReasonForm || {}
    const { stoppedReason, needsReschedule, otherDetails } = formData
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
      return res.redirect(`/clinics/${clinicId}/close/reason/${appointmentId}`)
    }

    // Save the whole form rather than maintaining a field list here
    updateAppointmentData(data, appointmentId, {
      appointmentStopped: { ...formData }
    })

    delete data.closeReasonForm

    // If reschedule requested, go to reschedule step
    if (needsReschedule === 'yes') {
      return res.redirect(`/clinics/${clinicId}/close/reschedule/${appointmentId}`)
    }

    // In modal context reply with an empty success, so the modal closes and
    // the page updates the row in place rather than reloading
    if (res.locals.parentLayout) {
      return res.send('')
    }
    res.redirect(`/clinics/${clinicId}/close`)
  })

  // Reschedule step (follows reason page when reschedule selected)
  router.get('/clinics/:clinicId/close/reschedule/:appointmentId', loadCloseAppointment, (req, res) => {
    const data = req.session.data

    // Seed from the saved appointment unless re-rendering a validation error
    // (the locals middleware has already moved any flash into res.locals.flash)
    const hasValidationErrors = Boolean(res.locals.flash?.error?.length)
    if (!hasValidationErrors) {
      data.closeRescheduleForm = structuredClone(res.locals.appointment.reschedule || {})
      res.locals.data.closeRescheduleForm = data.closeRescheduleForm
    }

    res.render('clinics/close-reschedule')
  })

  router.post('/clinics/:clinicId/close/reschedule/:appointmentId', loadCloseAppointment, (req, res) => {
    const { clinicId, appointmentId } = req.params
    const data = req.session.data

    const formData = data.closeRescheduleForm || {}

    if (!formData.timing) {
      req.flash('error', {
        text: 'Select when the appointment should be rescheduled',
        name: 'closeRescheduleForm[timing]',
        href: '#timing'
      })
      return res.redirect(`/clinics/${clinicId}/close/reschedule/${appointmentId}`)
    }

    updateAppointmentData(data, appointmentId, {
      reschedule: { ...formData }
    })
    updateAppointmentStatus(data, appointmentId, 'rescheduled')

    delete data.closeRescheduleForm

    // In modal context reply with an empty success, so the modal closes and
    // the page updates the row in place rather than reloading
    if (res.locals.parentLayout) {
      return res.send('')
    }
    res.redirect(`/clinics/${clinicId}/close`)
  })

  // Confirm and close clinic
  router.post('/clinics/:clinicId/close', (req, res) => {
    const { clinicId } = req.params
    const data = req.session.data

    const clinicAppointments = data.appointments.filter((a) => a.clinicId === clinicId)

    // Every appointment needs a final outcome before the clinic can close
    const unresolved = clinicAppointments.filter((a) => !isFinal(a))
    if (unresolved.length > 0) {
      req.flash('error', [{
        text: `An outcome still needs to be recorded for ${unresolved.length} ${pluralise('participant', unresolved.length)} before the clinic can be closed`
      }])
      return res.redirect(`/clinics/${clinicId}/close`)
    }

    // Attended-not-screened appointments also need their reasons recorded
    const missingDetails = clinicAppointments.filter((a) => needsStoppedDetails(a))
    if (missingDetails.length > 0) {
      req.flash('error', [{
        text: `Details still need to be added for ${missingDetails.length} ${pluralise('participant', missingDetails.length)} marked as attended not screened`
      }])
      return res.redirect(`/clinics/${clinicId}/close`)
    }

    const updatedClinic = updateClinic(data, clinicId, { status: 'closed' })
    if (updatedClinic) {
      req.flash('success', `Clinic ${updatedClinic.clinicCode} closed`)
    }

    // This clinic's close flow is finished - drop its resolved tracking
    delete data.closeClinicResolvedIds?.[clinicId]

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
