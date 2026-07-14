// app/routes/appointments/cancel-reschedule.js
//
// Cancelling and rescheduling appointments, and undoing either.
// The undo paths can reopen a closed episode (via updateAppointmentStatus),
// so they get extra care - see notes/2026-07-12-event-rename/.

const {
  getFullName,
  saveTempParticipantToParticipant
} = require('../../lib/utils/participants')
const {
  getAppointment,
  saveTempAppointmentToAppointment,
  updateAppointmentStatus
} = require('../../lib/utils/appointment-data')
const {
  getReturnUrl,
  modalBreakout
} = require('../../lib/utils/referrers')
const { captureSessionEndTime } = require('./shared')

module.exports = (router) => {
  // Handle cancel or reschedule appointment form submission
  router.post(
    '/clinics/:clinicId/appointments/:appointmentId/cancel-or-reschedule-appointment/cancel-or-reschedule-appointment-answer',
    (req, res) => {
      const { clinicId, appointmentId } = req.params
      const data = req.session.data

      const participantName = getFullName(data.participant)
      const participantAppointmentUrl = `/clinics/${clinicId}/appointments/${appointmentId}`

      const rescheduleChoice = data.appointment?.cancellation?.reschedule

      // Validate that a reschedule option was selected
      if (!rescheduleChoice) {
        req.flash('error', {
          text: 'Select whether the appointment should be rescheduled',
          name: 'appointment[cancellation][reschedule]',
          href: '#reschedule'
        })
        return res.redirect(
          `/clinics/${clinicId}/appointments/${appointmentId}/cancel-or-reschedule-appointment/details`
        )
      }

      // If yes, redirect to reschedule page
      if (rescheduleChoice === 'yes') {
        res.redirect(
          `/clinics/${clinicId}/appointments/${appointmentId}/cancel-or-reschedule-appointment/reschedule`
        )
      } else {
        // Capture session end time only if appointment was started
        const appointment = getAppointment(data, appointmentId)
        if (appointment?.sessionDetails?.startedAt) {
          captureSessionEndTime(data, appointmentId, data.currentUser.id)
        }

        // Save the cancellation data
        saveTempAppointmentToAppointment(data)
        saveTempParticipantToParticipant(data)

        // Update appointment status to cancelled
        updateAppointmentStatus(data, appointmentId, 'cancelled')

        // Set success message based on choice
        let successMessage
        if (rescheduleChoice === 'no-invite') {
          successMessage = `${participantName}'s appointment has been cancelled. <a href="${participantAppointmentUrl}" class="app-nowrap">View their appointment</a>`
        } else if (rescheduleChoice === 'no-opt-out') {
          successMessage = `An opt out request has been submitted for ${participantName}. <a href="${participantAppointmentUrl}" class="app-nowrap">View their appointment</a>`
        }

        req.flash('success', { wrapWithHeading: successMessage })

        // Return to clinic page
        res.redirect(modalBreakout(`/clinics/${clinicId}`))
      }
    }
  )

  // Handle reschedule appointment form submission
  router.post(
    '/clinics/:clinicId/appointments/:appointmentId/cancel-or-reschedule-appointment/reschedule-answer',
    (req, res) => {
      const { clinicId, appointmentId } = req.params
      const data = req.session.data

      const participantName = getFullName(data.participant)
      const participantAppointmentUrl = `/clinics/${clinicId}/appointments/${appointmentId}`

      const timing = data.appointment?.reschedule?.timing

      // Validate that timing was selected
      if (!timing) {
        req.flash('error', {
          text: 'Select when the appointment should be rescheduled',
          name: 'appointment[reschedule][timing]',
          href: '#timing'
        })
        return res.redirect(
          `/clinics/${clinicId}/appointments/${appointmentId}/cancel-or-reschedule-appointment/reschedule`
        )
      }

      // Capture session end time only if appointment was started (appointments might be rescheduled over the phone or that never started)
      const appointment = getAppointment(data, appointmentId)
      if (appointment?.sessionDetails?.startedAt) {
        captureSessionEndTime(data, appointmentId, data.currentUser.id)
      }

      // Save the reschedule data
      saveTempAppointmentToAppointment(data)
      saveTempParticipantToParticipant(data)

      // Update appointment status to rescheduled
      updateAppointmentStatus(data, appointmentId, 'rescheduled')

      const successMessage = `Appointment cancelled and a reschedule request has been submitted for ${participantName}. <a href="${participantAppointmentUrl}" class="app-nowrap">View their appointment</a>`

      req.flash('success', { wrapWithHeading: successMessage })

      // Return to clinic page — break out of any modal so the browser navigates fully
      res.redirect(modalBreakout(`/clinics/${clinicId}`))
    }
  )

  // Handle undo cancel appointment
  router.get('/clinics/:clinicId/appointments/:appointmentId/undo-cancel', (req, res) => {
    const { clinicId, appointmentId } = req.params
    const data = req.session.data
    const appointment = getAppointment(data, appointmentId)

    if (appointment && appointment.status === 'cancelled') {
      // Clear cancellation data
      delete data.appointment.cancellation
      delete data.appointment.reschedule

      // Save changes
      saveTempAppointmentToAppointment(data)

      // Revert to scheduled status
      updateAppointmentStatus(data, appointmentId, 'scheduled')

      req.flash('success', 'Appointment cancellation undone')
    }

    // Use referrer system to return to originating page
    const returnUrl = getReturnUrl(
      `/clinics/${clinicId}/appointments/${appointmentId}/appointment`,
      req.query.referrerChain
    )
    res.redirect(returnUrl)
  })

  // Handle undo reschedule appointment
  router.get(
    '/clinics/:clinicId/appointments/:appointmentId/undo-reschedule',
    (req, res) => {
      const { clinicId, appointmentId } = req.params
      const data = req.session.data
      const appointment = getAppointment(data, appointmentId)

      if (appointment && appointment.status === 'rescheduled') {
        // Clear reschedule and cancellation data
        delete data.appointment.cancellation
        delete data.appointment.reschedule

        // Save changes
        saveTempAppointmentToAppointment(data)

        // Revert to scheduled status
        updateAppointmentStatus(data, appointmentId, 'scheduled')

        req.flash('success', 'Appointment cancellation undone')
      }

      // Use referrer system to return to originating page
      const returnUrl = getReturnUrl(
        `/clinics/${clinicId}/appointments/${appointmentId}/appointment`,
        req.query.referrerChain
      )
      res.redirect(returnUrl)
    }
  )
}
