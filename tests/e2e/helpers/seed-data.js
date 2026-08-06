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
  const { firstName, middleName, lastName } = participant.demographicInformation

  return {
    clinic,
    appointment,
    participant,
    // Built the same way getFullName does, middle name included - some
    // participants have one, and which participant a run picks depends on the
    // seed data, so a first+last name only matches some of the time
    fullName: [`${lastName.toUpperCase()},`, firstName, middleName].filter(Boolean).join(' ')
  }
}

/**
 * Find a reading case holding exactly one seeded read, ready for the current
 * user to give the second.
 *
 * The first read must be someone else's (nobody reads the same case twice) and
 * carry the requested opinion, so a test can mirror it and land a concordant
 * pair. Skips deferred cases and appointments awaiting priors, which the
 * reading routes would bounce to the existing-read page.
 *
 * @param {object} [options] - Options
 * @param {string} [options.firstOpinion] - Opinion the seeded read must carry
 * @returns {{episode: object, readingCase: object, appointment: object}} The subject
 */
const findCaseAwaitingSecondRead = ({ firstOpinion = 'normal' } = {}) => {
  // The journeys run as the default user, users[0] - the same pick
  // session-data-defaults.js makes for currentUser
  const users = require('../../../app/data/users')
  const currentUserId = users[0].id

  const episodes = readCollection('episodes.json', 'episodes')
  const appointments = readCollection('appointments.json', 'appointments')

  for (const episode of episodes) {
    for (const readingCase of episode.readingCases || []) {
      const reads = readingCase.reads || []
      if (reads.length !== 1) continue
      if (reads[0].opinion !== firstOpinion) continue
      if (reads[0].readerId === currentUserId) continue
      if (readingCase.deferral) continue

      const appointment = appointments.find(
        (item) => item.id === readingCase.appointmentId
      )
      if (!appointment) continue

      const priorsPending = (appointment.previousMammograms || []).some(
        (mammogram) =>
          mammogram.requestStatus === 'pending' ||
          mammogram.requestStatus === 'requested'
      )
      if (priorsPending) continue

      return { episode, readingCase, appointment }
    }
  }

  throw new Error(
    `Seed data has no case awaiting a second read with a "${firstOpinion}" ` +
      'first read from another reader. Regenerate the data with "npm run generate".'
  )
}

module.exports = {
  readCollection,
  findTodayAppointment,
  findCaseAwaitingSecondRead
}
