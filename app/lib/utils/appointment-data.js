// app/lib/utils/appointment-data.js
const { getParticipant } = require('./participants.js')
const { getClinic } = require('./clinics.js')
const dataStore = require('../data-store')

/**
 * Record a changed appointment so it persists for this session
 *
 * The appointments array attached to `data` is rebuilt from the shared data store
 * on every request; only records in data._changes survive across requests
 * (see the attach middleware in app/routes.js). Callers should also replace
 * the record in data.appointments so reads later in the same request see it.
 *
 * @param {object} data - Session data
 * @param {object} appointment - Whole replacement appointment record
 */
const recordAppointmentChange = (data, appointment) => {
  if (data._changes?.appointments) {
    data._changes.appointments[appointment.id] = appointment
  }
}

/**
 * Get an appointment by ID
 *
 * Reads the session's changed records first, then the shared store's id
 * index, so it avoids a linear scan of the merged appointments array. Falls back
 * to scanning data.appointments for records that exist only in the passed data.
 *
 * @param {object} data - Session data
 * @param {string} appointmentId - Appointment ID
 * @returns {object | null} Appointment object or null if not found
 */
const getAppointment = (data, appointmentId) => {
  return (
    data._changes?.appointments?.[appointmentId] ??
    dataStore.state.appointmentsById.get(appointmentId) ??
    data.appointments?.find((e) => e.id === appointmentId) ??
    null
  )
}

/**
 * Get appointment data bundle for a given clinic and appointment ID
 *
 * @param {object} data - Session data
 * @param {string} clinicId - Clinic ID
 * @param {string} appointmentId - Appointment ID
 * @returns {object | null} Bundle of {clinic, appointment, participant, location, unit} or null if not found
 */
const getAppointmentData = (data, clinicId, appointmentId) => {
  const clinic = getClinic(data, clinicId)
  if (!clinic) return null

  const appointment = getAppointment(data, appointmentId)
  if (!appointment || appointment.clinicId !== clinicId) return null

  const participant = getParticipant(data, appointment.participantId)
  const unit = data.breastScreeningUnits.find(
    (u) => u.id === clinic.breastScreeningUnitId
  )
  const location = unit?.locations.find((l) => l.id === clinic.locationId)

  return { clinic, appointment, participant, location, unit }
}

/**
 * Find and update an appointment in session data
 *
 * @param {object} data - Session data
 * @param {string} appointmentId - Appointment ID
 * @param {object} updatedAppointment - Updated appointment object
 * @returns {object | null} Updated appointment or null if not found
 */
const updateAppointment = (data, appointmentId, updatedAppointment) => {
  const appointmentIndex = data.appointments.findIndex((e) => e.id === appointmentId)
  if (appointmentIndex === -1) return null

  // Update in the attached array (same-request reads) and record the change
  // (persistence across requests)
  data.appointments[appointmentIndex] = updatedAppointment
  recordAppointmentChange(data, updatedAppointment)
  return updatedAppointment
}

/**
 * Update appointment with arbitrary data changes
 * Also updates the temporary appointment data if it exists and matches
 *
 * @param {object} data - Session data
 * @param {string} appointmentId - Appointment ID
 * @param {object} updates - Object containing updates to merge into the appointment
 * @returns {object | null} Updated appointment or null if not found
 */
const updateAppointmentData = (data, appointmentId, updates) => {
  const appointmentIndex = data.appointments.findIndex((e) => e.id === appointmentId)
  if (appointmentIndex === -1) return null

  // Use temp appointment if it exists and matches, otherwise use the array appointment
  const baseAppointment =
    data.appointment && data.appointment.id === appointmentId
      ? data.appointment
      : data.appointments[appointmentIndex]

  const updatedAppointment = {
    ...baseAppointment,
    ...updates
  }

  // Update main data
  data.appointments[appointmentIndex] = updatedAppointment
  recordAppointmentChange(data, updatedAppointment)

  // Also update temp appointment data if it exists and matches this appointment
  // Merge updates into existing temp appointment to preserve any unsaved changes
  if (data.appointment && data.appointment.id === appointmentId) {
    data.appointment = {
      ...data.appointment,
      ...updates
    }
  }

  return updatedAppointment
}

/**
 * Save temporary appointment data back to the main appointment
 *
 * This function takes the data.appointment object and saves it back to the
 * appointments array, then clears appointment. It's used at the end of a workflow
 * to commit changes made to the temporary appointment back to the main array.
 *
 * @param {object} data - Session data
 * @returns {object | null} Updated appointment or null if no temp data
 */
const saveTempAppointmentToAppointment = (data) => {
  if (!data.appointment || !data.appointment.id) {
    return null
  }

  const appointmentId = data.appointment.id

  // Use updateAppointment to save the temp data
  const updatedAppointment = updateAppointment(data, appointmentId, data.appointment)

  // Clear temp data
  delete data.appointment

  return updatedAppointment
}

module.exports = {
  getAppointment,
  getAppointmentData,
  updateAppointment,
  updateAppointmentData,
  saveTempAppointmentToAppointment
}
