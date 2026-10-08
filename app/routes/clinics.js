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
  isSpecialAppointment,
  getWaitingMinutes
} = require('../lib/utils/status')
const { getReturnUrl } = require('../lib/utils/referrers')
const { getParticipant } = require('../lib/utils/participants')
const { participantMatchesQuery } = require('../lib/utils/search')
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

// Status changes available from the close clinic page: each status that can
// be applied, and the statuses it can be applied from. Checking the current
// status stops a stale link overwriting a status changed elsewhere.
const CLOSE_STATUS_ACTIONS = {
  did_not_attend: ['scheduled'],
  scheduled: ['did_not_attend', 'checked_in'],
  checked_in: ['scheduled', 'attended_not_screened', 'rescheduled']
}

// Statuses whose stop reasons can be recorded or changed from the close page
const STOPPABLE_STATUSES = ['checked_in', 'attended_not_screened', 'rescheduled']

/**
 * Discard the attended-not-screened reason and reschedule answers, so undoing
 * the status leaves no stale reason behind
 */
const clearStoppedDetails = (data, appointmentId) => {
  updateAppointmentData(data, appointmentId, {
    appointmentStopped: null,
    reschedule: null
  })
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

  // Stop a stale link or form overwriting an outcome recorded elsewhere
  const requireStoppableStatus = (req, res, next) => {
    if (!STOPPABLE_STATUSES.includes(res.locals.appointment.status)) {
      return res.redirect(`/clinics/${req.params.clinicId}/close`)
    }
    next()
  }

  // Close clinic page
  router.get('/clinics/:clinicId/close', (req, res) => {
    const data = req.session.data
    const { appointments, unit } = getClinicData(data, req.params.clinicId)

    // Discard stop reasons from a flow abandoned before the reschedule step
    delete data.closeReasonForm

    res.render('clinics/close', {
      unit,
      needsOutcomeCount: appointments.filter((a) => !isFinal(a)).length,
      inProgressAppointments: appointments.filter((a) => isInProgress(a)),
      checkedInAppointments: appointments.filter((a) => a.status === 'checked_in'),
      scheduledAppointments: appointments.filter((a) => a.status === 'scheduled'),
      outcomeRecordedAppointments: appointments.filter((a) => isFinal(a))
    })
  })

  // Change one appointment's outcome from the close page. GET so the actions
  // work as plain links without JS, mirroring the check-in route above.
  // Fetch requests get the re-rendered row so the page can update in place.
  router.get('/clinics/:clinicId/close/set-status/:appointmentId/:status', loadCloseAppointment, (req, res) => {
    const { clinicId, appointmentId, status } = req.params
    const allowedFrom = CLOSE_STATUS_ACTIONS[status]
    if (!allowedFrom?.includes(res.locals.appointment.status)) {
      return res.redirect(`/clinics/${clinicId}/close`)
    }

    const data = req.session.data
    updateAppointmentStatus(data, appointmentId, status)

    // Back to checked in undoes attended not screened or rescheduled
    if (status === 'checked_in') {
      clearStoppedDetails(data, appointmentId)
    }

    if (req.xhr) {
      return res.render('clinics/close-appointment-row', {
        appointment: getAppointment(data, appointmentId)
      })
    }
    res.redirect(`/clinics/${clinicId}/close`)
  })

  // Re-render a single appointment row - fetched by close-clinic.js after a
  // modal form saves, so the row can update without a page reload
  router.get('/clinics/:clinicId/close/appointment-row/:appointmentId', loadCloseAppointment, (req, res) => {
    res.render('clinics/close-appointment-row')
  })

  // Attended-not-screened reason page (opens in modal from close page)
  router.get('/clinics/:clinicId/close/reason/:appointmentId', loadCloseAppointment, requireStoppableStatus, (req, res) => {
    const { appointmentId } = req.params
    const data = req.session.data

    // Start from the saved answers, unless answers for this appointment are
    // already in progress - after a validation error, or back from the
    // reschedule step. Replacing the whole store drops other appointments' answers.
    if (!data.closeReasonForm?.[appointmentId]) {
      data.closeReasonForm = {
        [appointmentId]: structuredClone(res.locals.appointment.appointmentStopped || {})
      }
      res.locals.data.closeReasonForm = data.closeReasonForm
    }

    res.render('clinics/close-attended-not-screened-reason')
  })

  router.post('/clinics/:clinicId/close/reason/:appointmentId', loadCloseAppointment, requireStoppableStatus, (req, res) => {
    const { clinicId, appointmentId } = req.params
    const data = req.session.data

    const formData = data.closeReasonForm?.[appointmentId] || {}
    const fieldPrefix = `closeReasonForm[${appointmentId}]`
    const { stoppedReason, needsReschedule, otherDetails } = formData
    // Checkboxes post an empty array when none are ticked
    const hasNoReason = !stoppedReason?.length
    const hasOtherReasonButNoDetails =
      stoppedReason?.includes('Other reason') && !otherDetails

    // Validation
    if (hasNoReason || !needsReschedule || hasOtherReasonButNoDetails) {
      if (hasNoReason) {
        req.flash('error', {
          text: 'Select why this appointment has been stopped',
          name: `${fieldPrefix}[stoppedReason]`,
          href: '#stoppedReason'
        })
      }
      if (hasOtherReasonButNoDetails) {
        req.flash('error', {
          text: 'Provide details about the other reason',
          name: `${fieldPrefix}[otherDetails]`,
          href: '#otherDetails'
        })
      }
      if (!needsReschedule) {
        req.flash('error', {
          text: 'Select whether the appointment should be rescheduled',
          name: `${fieldPrefix}[needsReschedule]`,
          href: '#needsReschedule'
        })
      }
      return res.redirect(`/clinics/${clinicId}/close/reason/${appointmentId}`)
    }

    // The reschedule step saves these answers along with its own, so leaving
    // the flow part way through changes nothing
    if (needsReschedule === 'yes') {
      return res.redirect(`/clinics/${clinicId}/close/reschedule/${appointmentId}`)
    }

    // Save the whole form rather than maintaining a field list here. Clear any
    // reschedule answers from an earlier 'yes'.
    updateAppointmentData(data, appointmentId, {
      appointmentStopped: { ...formData },
      reschedule: null
    })
    delete data.closeReasonForm

    // Skip when already in that status, so editing the details doesn't add a
    // redundant status history entry
    if (res.locals.appointment.status !== 'attended_not_screened') {
      updateAppointmentStatus(data, appointmentId, 'attended_not_screened')
    }

    // In modal context reply with an empty success, so the modal closes and
    // the page updates the row in place rather than reloading
    if (res.locals.parentLayout) {
      return res.send('')
    }
    res.redirect(`/clinics/${clinicId}/close`)
  })

  // Reschedule step (follows reason page when reschedule selected)
  router.get('/clinics/:clinicId/close/reschedule/:appointmentId', loadCloseAppointment, requireStoppableStatus, (req, res) => {
    const { clinicId, appointmentId } = req.params
    const data = req.session.data

    // The stop reasons are saved with this step, so they must be answered first
    if (!data.closeReasonForm?.[appointmentId]) {
      return res.redirect(`/clinics/${clinicId}/close/reason/${appointmentId}`)
    }

    // Seed from the saved appointment unless re-rendering a validation error
    // (the locals middleware has already moved any flash into res.locals.flash)
    const hasValidationErrors = Boolean(res.locals.flash?.error?.length)
    if (!hasValidationErrors) {
      data.closeRescheduleForm = structuredClone(res.locals.appointment.reschedule || {})
      res.locals.data.closeRescheduleForm = data.closeRescheduleForm
    }

    res.render('clinics/close-reschedule')
  })

  router.post('/clinics/:clinicId/close/reschedule/:appointmentId', loadCloseAppointment, requireStoppableStatus, (req, res) => {
    const { clinicId, appointmentId } = req.params
    const data = req.session.data

    const stoppedAnswers = data.closeReasonForm?.[appointmentId]
    if (!stoppedAnswers) {
      return res.redirect(`/clinics/${clinicId}/close/reason/${appointmentId}`)
    }

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
      appointmentStopped: { ...stoppedAnswers },
      reschedule: { ...formData }
    })
    if (res.locals.appointment.status !== 'rescheduled') {
      updateAppointmentStatus(data, appointmentId, 'rescheduled')
    }

    delete data.closeReasonForm
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

    const updatedClinic = updateClinic(data, clinicId, { status: 'closed' })
    if (updatedClinic) {
      req.flash('success', {
        wrapWithHeading: `Clinic ${updatedClinic.clinicCode} closed. <a href="/reports/${clinicId}">View report</a>`
      })
    }

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
    if (!clinicData) {
      return res.redirect('/clinics')
    }
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

    // Free-text search narrows the list by participant, keeping the counts and
    // the current tab in step. Empty query matches everyone.
    const search = req.query.search?.trim() || ''
    // Checkbox filter - the unchecked-checkbox script posts "_unchecked" when
    // off, so match on the "yes" value rather than mere presence
    const filterSpecialAppointment = []
      .concat(req.query.specialAppointment || [])
      .includes('yes')

    let matchedAppointments = clinicData.appointments
    if (search) {
      matchedAppointments = matchedAppointments.filter((appointment) =>
        participantMatchesQuery(appointment.participant, search)
      )
    }
    if (filterSpecialAppointment) {
      matchedAppointments = matchedAppointments.filter((appointment) =>
        isSpecialAppointment(appointment)
      )
    }

    let filteredAppointments = filterAppointmentsByStatus(matchedAppointments, filter)

    // Optional column sort (NHS sortable table, server-side). Time sorts by
    // appointment time; the Appointment column sorts by waiting time, with
    // not-yet-checked-in appointments sinking to the bottom in time order.
    const SORTS = [
      'time-ascending',
      'time-descending',
      'waiting-ascending',
      'waiting-descending'
    ]
    const sort = SORTS.includes(req.query.sort) ? req.query.sort : ''
    const sortDescending = sort.endsWith('descending')
    if (sort.startsWith('waiting')) {
      filteredAppointments = [...filteredAppointments].sort((a, b) => {
        const aWaiting = getWaitingMinutes(a)
        const bWaiting = getWaitingMinutes(b)
        if (aWaiting === null && bWaiting === null) return 0
        if (aWaiting === null) return 1
        if (bWaiting === null) return -1
        return sortDescending ? bWaiting - aWaiting : aWaiting - bWaiting
      })
    } else if (sort.startsWith('time')) {
      filteredAppointments = [...filteredAppointments].sort((a, b) => {
        const diff =
          new Date(a.timing.startTime) - new Date(b.timing.startTime)
        return sortDescending ? -diff : diff
      })
    }

    res.render('clinics/show', {
      clinicId: req.params.id,
      clinic: clinicData.clinic,
      allAppointments: matchedAppointments,
      filteredAppointments,
      search,
      specialAppointment: filterSpecialAppointment,
      sort,
      status: filter,
      unit: clinicData.unit,
      currentFilter: filter,
      formatDate: (date) => dayjs(date).format('D MMMM YYYY'),
      formatTime: (date) => dayjs(date).format('HH:mm')
    })
  })
}
