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

const { getAppointment, updateAppointmentData } = require('./appointment-data')
const {
  syncEpisodeMammogramsForAppointment,
  syncReadingCasesForAppointment,
  advanceEpisodeForAppointmentStatus
} = require('./episodes')
const { getSimulatedNow } = require('./status')
const { getClinicAppointments } = require('./clinics')

/**
 * Take an appointment out of its clinic's order of screening, for one that
 * ended without screening. Later appointments move up so the numbers stay
 * in step with the screened participants.
 *
 * @param {object} data - Session data
 * @param {object} appointment - The appointment leaving the order
 */
const removeFromScreeningOrder = (data, appointment) => {
  const removedOrder = appointment.screeningOrder
  if (typeof removedOrder !== 'number') return

  updateAppointmentData(data, appointment.id, { screeningOrder: null })

  getClinicAppointments(data.appointments, appointment.clinicId)
    .filter(
      (other) =>
        typeof other.screeningOrder === 'number' &&
        other.screeningOrder > removedOrder
    )
    .forEach((other) => {
      updateAppointmentData(data, other.id, {
        screeningOrder: other.screeningOrder - 1
      })
    })
}

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
        // Stamp the simulated clinic clock, not real time, so a live check-in
        // matches the seed data's simulated times and its wait reads correctly
        timestamp: getSimulatedNow().toISOString()
      }
    ]
  })
  if (!updatedAppointment) return null

  if (newStatus === 'attended_not_screened' || newStatus === 'cancelled') {
    removeFromScreeningOrder(data, baseAppointment)
  }

  // Keep the appointment's episode in step, and record on the episode that
  // images were taken (or weren't after all, on an undo). A new set of images
  // is both a mammogram entry and a new case to read, so the two sync together
  syncEpisodeMammogramsForAppointment(data, updatedAppointment)
  syncReadingCasesForAppointment(data, updatedAppointment)
  advanceEpisodeForAppointmentStatus(data, updatedAppointment)

  return updatedAppointment
}

module.exports = {
  updateAppointmentStatus
}
