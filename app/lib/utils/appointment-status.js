// app/lib/utils/appointment-status.js
//
// The status-change funnel for appointments. Changing a status is what moves
// an appointment's episode along (check-in moves it to mammograms, a
// completed appointment moves it to reading, and so on), so the two updates
// live together here - routes don't each have to know episodes exist.
//
// This sits above appointment-data and episodes so requires stay
// one-directional: episodes reads appointments (getAppointment), and this
// module writes to both. When updateAppointmentStatus lived in
// appointment-data.js it needed a lazy require of episodes.js to dodge the
// resulting cycle.

const {
  getAppointment,
  updateAppointmentData
} = require('./appointment-data')
const {
  syncEpisodeMammogramsForAppointment,
  advanceEpisodeForAppointmentStatus
} = require('./episodes')

/**
 * Update appointment status and add to history
 * Also updates the temporary appointment data if it exists
 *
 * @param {object} data - Session data
 * @param {string} appointmentId - Appointment ID
 * @param {string} newStatus - New status
 * @returns {object | null} Updated appointment or null if not found
 */
const updateAppointmentStatus = (data, appointmentId, newStatus) => {
  // Use temp appointment if it exists and matches, so unsaved status-relevant
  // history isn't lost
  const baseAppointment =
    data.appointment && data.appointment.id === appointmentId
      ? data.appointment
      : getAppointment(data, appointmentId)
  if (!baseAppointment) return null

  const updatedAppointment = updateAppointmentData(data, appointmentId, {
    status: newStatus,
    statusHistory: [
      ...baseAppointment.statusHistory,
      {
        status: newStatus,
        timestamp: new Date().toISOString()
      }
    ]
  })
  if (!updatedAppointment) return null

  // Keep the appointment's episode in step, and record on the episode that
  // images were taken (or weren't after all, on an undo)
  syncEpisodeMammogramsForAppointment(data, updatedAppointment)
  advanceEpisodeForAppointmentStatus(data, updatedAppointment)

  return updatedAppointment
}

module.exports = {
  updateAppointmentStatus
}
