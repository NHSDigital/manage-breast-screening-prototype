// app/routes/appointments/appointment-notes.js
//
// Appointment notes: save and delete.

const {
  saveTempAppointmentToAppointment
} = require('../../lib/utils/appointment-data')
const {
  getReturnUrl,
  modalBreakout
} = require('../../lib/utils/referrers')

module.exports = (router) => {
  // Handle appointment note form submission
  router.post(
    '/clinics/:clinicId/appointments/:appointmentId/appointment-note-answer',
    (req, res) => {
      const { clinicId, appointmentId } = req.params
      const data = req.session.data

      // Save the appointment note from temp appointment to permanent appointment
      saveTempAppointmentToAppointment(data)

      req.flash('success', 'Appointment note saved')

      const returnUrl = getReturnUrl(
        `/clinics/${clinicId}/appointments/${appointmentId}`,
        req.query.referrerChain
      )
      res.redirect(modalBreakout(returnUrl))
    }
  )

  // Delete appointment note
  router.get(
    '/clinics/:clinicId/appointments/:appointmentId/appointment-note/delete',
    (req, res) => {
      const { clinicId, appointmentId } = req.params
      const data = req.session.data

      // Delete the appointment note
      delete data.appointment.appointmentNote

      // Save changes
      saveTempAppointmentToAppointment(data)

      req.flash('success', 'Appointment note deleted')

      const returnUrl = getReturnUrl(
        `/clinics/${clinicId}/appointments/${appointmentId}`,
        req.query.referrerChain
      )
      res.redirect(modalBreakout(returnUrl))
    }
  )
}
