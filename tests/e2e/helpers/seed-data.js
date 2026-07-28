// tests/e2e/helpers/seed-data.js
//
// Tests pick their subjects out of the generated seed data rather than naming
// ids, because the data is regenerated daily and on every profile change.
// Read at call time (not at import) so a regeneration triggered by the global
// setup is picked up.

const fs = require('fs')
const path = require('path')
const dayjs = require('dayjs')

const generatedDataPath = path.join(__dirname, '../../../app/data/generated')

/**
 * Read one of the generated collections
 *
 * @param {string} filename - File within app/data/generated
 * @param {string} key - Top-level key the collection sits under
 * @returns {Array<object>} The collection
 */
const readCollection = (filename, key) => {
  const contents = fs.readFileSync(
    path.join(generatedDataPath, filename),
    'utf8'
  )
  return JSON.parse(contents)[key]
}

/**
 * Find an appointment on a clinic running today, in a given status.
 *
 * @param {object} [options] - Options
 * @param {string} [options.status] - Appointment status to look for
 * @param {number} [options.index] - Which match to take, so two specs running
 *   in parallel can work on different appointments
 * @returns {{clinic: object, appointment: object, participant: object, fullName: string}} The subject
 */
const findTodayAppointment = ({ status = 'scheduled', index = 0 } = {}) => {
  const today = dayjs().format('YYYY-MM-DD')
  const clinics = readCollection('clinics.json', 'clinics')
  const appointments = readCollection('appointments.json', 'appointments')
  const participants = readCollection('participants.json', 'participants')

  const todayClinicIds = new Set(
    clinics.filter((clinic) => clinic.date === today).map((clinic) => clinic.id)
  )

  const matches = appointments.filter(
    (appointment) =>
      todayClinicIds.has(appointment.clinicId) && appointment.status === status
  )

  const appointment = matches[index]

  if (!appointment) {
    throw new Error(
      `Seed data has no appointment ${index + 1} with status "${status}" on a clinic today ` +
        `(found ${matches.length}). Regenerate the data with "npm run generate".`
    )
  }

  const clinic = clinics.find((item) => item.id === appointment.clinicId)
  const participant = participants.find(
    (item) => item.id === appointment.participantId
  )
  const { firstName, lastName } = participant.demographicInformation

  return {
    clinic,
    appointment,
    participant,
    fullName: `${firstName} ${lastName}`
  }
}

module.exports = {
  readCollection,
  findTodayAppointment
}
