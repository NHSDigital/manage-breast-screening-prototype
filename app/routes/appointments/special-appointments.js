// app/routes/appointments/special-appointments.js
//
// Special appointment support types and temporary reasons.

const {
  saveTempParticipantToParticipant
} = require('../../lib/utils/participants')
const {
  saveTempAppointmentToAppointment
} = require('../../lib/utils/appointment-data')
const {
  getReturnUrl,
  urlWithReferrer,
  modalBreakout
} = require('../../lib/utils/referrers')
const { isAppointmentWorkflow } = require('../../lib/utils/status')

module.exports = (router) => {
  // Handle special appointment form submission
  router.post(
    '/clinics/:clinicId/appointments/:appointmentId/special-appointment/edit-answer',
    (req, res) => {
      const { clinicId, appointmentId } = req.params
      const data = req.session.data
      const supportTypes = data.appointment?.specialAppointment?.supportTypes || []
      const temporaryReasons = data.appointment?.specialAppointment?.temporaryReasons

      // Validate that temporaryReasons was answered
      // if (!temporaryReasons && supportTypes) {
      //   req.flash('error', {
      //     text: 'Select whether any of these reasons are temporary',
      //     name: 'appointment[specialAppointment][temporaryReasons]',
      //     href: '#temporaryReasons'
      //   })
      //   return res.redirect(
      //     `/clinics/${clinicId}/appointments/${appointmentId}/special-appointment/edit`
      //   )
      // }

      // // If user selected "yes", redirect to temporary reasons selection page
      // if (temporaryReasons === 'yes' && supportTypes?.length > 0) {
      //   res.redirect(
      //     urlWithReferrer(
      //       `/clinics/${clinicId}/appointments/${appointmentId}/special-appointment/temporary-reasons`,
      //       req.query.referrerChain
      //     )
      //   )
      // } else

      // Return user during workflow
      if (isAppointmentWorkflow(data.appointment, data.currentUser)) {
        // In workflow — skip confirm, leave data in temp store, return to workflow
        // if (temporaryReasons === 'no') {
        //   delete data.appointment.specialAppointment.temporaryReasonsList
        // }
        res.redirect(
          modalBreakout(
            getReturnUrl(
              `/clinics/${clinicId}/appointments/${appointmentId}`,
              req.query.referrerChain
            )
          )
        )
      } else {
        // Standalone — go to confirm page which will save
        if (temporaryReasons === 'no') {
          delete data.appointment.specialAppointment.temporaryReasonsList
        }
        res.redirect(
          `/clinics/${clinicId}/appointments/${appointmentId}/special-appointment/confirm`
        )
      }
    }
  )

  // Handle temporary reasons selection form submission
  router.post(
    '/clinics/:clinicId/appointments/:appointmentId/special-appointment/temporary-reasons-answer',
    (req, res) => {
      const { clinicId, appointmentId } = req.params
      const data = req.session.data

      if (isAppointmentWorkflow(data.appointment, data.currentUser)) {
        // In workflow — skip confirm, leave data in temp store, return to workflow
        res.redirect(
          modalBreakout(
            getReturnUrl(
              `/clinics/${clinicId}/appointments/${appointmentId}`,
              req.query.referrerChain
            )
          )
        )
      } else {
        // Standalone — go to confirm page which will save
        res.redirect(
          `/clinics/${clinicId}/appointments/${appointmentId}/special-appointment/confirm`
        )
      }
    }
  )

  // Handle special appointment confirmation
  router.post(
    '/clinics/:clinicId/appointments/:appointmentId/special-appointment/confirm-answer',
    (req, res) => {
      const { clinicId, appointmentId } = req.params
      const data = req.session.data

      const supportTypes = data.appointment?.specialAppointment?.supportTypes
      const temporaryReasons = data.appointment?.specialAppointment?.temporaryReasons
      const temporaryReasonsList =
        data.appointment?.specialAppointment?.temporaryReasonsList

      if (temporaryReasons === 'no') {
        delete data.appointment.specialAppointment.temporaryReasonsList
      }

      // Save the data and redirect back to main appointment page
      saveTempAppointmentToAppointment(data)
      saveTempParticipantToParticipant(data)

      req.flash('success', 'Special appointment requirements confirmed')
      const returnUrl = getReturnUrl(
        `/clinics/${clinicId}/appointments/${appointmentId}`,
        req.query.referrerChain
      )
      res.redirect(modalBreakout(returnUrl))
    }
  )
}
