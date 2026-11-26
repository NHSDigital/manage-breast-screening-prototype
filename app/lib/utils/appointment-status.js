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
  updateAppointment,
  updateAppointmentData
} = require('./appointment-data')
const {
  syncEpisodeMammogramsForAppointment,
  syncReadingCasesForAppointment,
  advanceEpisodeForAppointmentStatus
} = require('./episodes')
const { getSimulatedNow, wasAttended } = require('./status')
const {
  getClinicAppointments,
  getAppointmentsInCompletionOrder
} = require('./clinics')

/**
 * Update appointment status and add to history
 * Also updates the temporary appointment data if it exists
 *
 * @param {object} data - Session data
 * @param {string} appointmentId - Appointment ID
 * @param {string} newStatus - New status
 * @param {object} [options] - Update options
 * @param {boolean} [options.useSavedAppointment=false] - Use the saved record rather than the working copy
 * @returns {object | null} Updated appointment or null if not found
 */
const updateAppointmentStatus = (
  data,
  appointmentId,
  newStatus,
  options = {}
) => {
  // Use temp appointment if it exists and matches, so unsaved status-relevant
  // history isn't lost
  const baseAppointment =
    !options.useSavedAppointment &&
    data.appointment &&
    data.appointment.id === appointmentId
      ? data.appointment
      : getAppointment(data, appointmentId)
  if (!baseAppointment) return null

  const nextAppointment = { ...baseAppointment, status: newStatus }
  const wasPreviouslyAttended = wasAttended(baseAppointment)
  const isNowAttended = wasAttended(nextAppointment)
  const updates = {
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
  }

  if (
    isNowAttended &&
    !wasPreviouslyAttended &&
    !baseAppointment.sessionDetails?.endedAt
  ) {
    updates.sessionDetails = {
      ...baseAppointment.sessionDetails,
      endedAt: getSimulatedNow().toISOString(),
      ...(baseAppointment.sessionDetails?.startedAt && {
        endedBy: data.currentUser?.id
      })
    }
  } else if (wasPreviouslyAttended && !isNowAttended) {
    const sessionDetails = { ...baseAppointment.sessionDetails }
    delete sessionDetails.endedAt
    delete sessionDetails.endedBy
    updates.sessionDetails = sessionDetails
    updates.completionOrder = null
  }

  let updatedAppointment = updateAppointmentData(
    data,
    appointmentId,
    updates,
    options
  )
  if (!updatedAppointment) return null

  if (wasPreviouslyAttended || isNowAttended) {
    const appointments = getAppointmentsInCompletionOrder(
      getClinicAppointments(data.appointments, updatedAppointment.clinicId)
    )
    appointments.forEach((appointment, index) => {
      if (appointment.completionOrder !== index + 1) {
        const updated = updateAppointment(data, appointment.id, {
          ...appointment,
          completionOrder: index + 1
        })
        if (data.appointment?.id === appointment.id) {
          data.appointment.completionOrder = index + 1
        }
        if (appointment.id === appointmentId) updatedAppointment = updated
      }
    })
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
