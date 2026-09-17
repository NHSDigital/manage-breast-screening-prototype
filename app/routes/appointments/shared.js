// app/routes/appointments/shared.js
//
// Helpers used by more than one appointment route module.

const {
  getAppointment,
  updateAppointmentData
} = require('../../lib/utils/appointment-data')

/**
 * Capture session end time for an appointment
 * @param {object} data - Session data
 * @param {string} appointmentId - Appointment ID
 * @param {string} userId - User ID ending the session
 */
function captureSessionEndTime(data, appointmentId, userId) {
  const appointment = getAppointment(data, appointmentId)
  updateAppointmentData(data, appointmentId, {
    sessionDetails: {
      ...appointment.sessionDetails,
      endedAt: new Date().toISOString(),
      endedBy: userId
    }
  })
}

module.exports = {
  captureSessionEndTime
}
