// app/lib/utils/participants.js

const { safe: nunjucksSafe } = require('nunjucks/src/filters')
const riskLevels = require('../../data/risk-levels.js')
const dataStore = require('../data-store')
const { recordChange } = require('../shared-data')

/**
 * Get a participant by ID
 *
 * Reads the session's changed records first, then the shared store's id
 * index, so it avoids a linear scan of the merged participants array. Falls
 * back to scanning data.participants for records that exist only in the
 * passed data.
 *
 * @param {object} data - Session data containing participants
 * @param {string} participantId - Participant ID to search for
 * @returns {object | null} Participant object or null if not found
 */
const getParticipant = (data, participantId) => {
  return withRealImageDateOfBirth(
    data,
    data._changes?.participants?.[participantId] ??
      dataStore.state.participantsById.get(participantId) ??
      data.participants?.find((p) => p.id === participantId) ??
      null
  )
}

// Copies made by withRealImageDateOfBirth, so each record is copied once
const realImageCopies = new WeakMap()

/**
 * A participant as shown while real mammogram images are on: with a date of
 * birth that gives her real case's age. The dates come from
 * `data._realImageDatesOfBirth`, which app/routes.js sets per request only
 * when real images are on. Unchanged otherwise, or if her date of birth has
 * been changed this session.
 *
 * @param {object} data - Session data
 * @param {object | null} participant - Participant
 * @returns {object | null} The participant, or a copy with another date of birth
 */
const withRealImageDateOfBirth = (data, participant) => {
  const change =
    participant && data?._realImageDatesOfBirth?.get(participant.id)
  if (
    !change ||
    participant.demographicInformation?.dateOfBirth !== change.from
  ) {
    return participant
  }

  const copy = realImageCopies.get(participant)
  if (copy?.demographicInformation.dateOfBirth === change.to) return copy

  const newCopy = {
    ...participant,
    demographicInformation: {
      ...participant.demographicInformation,
      dateOfBirth: change.to
    }
  }
  realImageCopies.set(participant, newCopy)
  return newCopy
}

/**
 * Get full name (first, middle, last) of a participant as a Nunjucks-safe string
 *
 * @param {object} participant - Participant object
 * @returns {string} Full name, or empty string if unavailable
 */
const getFullName = (participant) => {
  if (!participant?.demographicInformation) return ''
  const { firstName, middleName, lastName } = participant.demographicInformation
  return nunjucksSafe(
    [firstName, middleName, lastName].filter(Boolean).join(' ')
  )
}

/**
 * Get short name in reversed 'LASTNAME, Firstname' format, with no middle names
 *
 * For lists, page headings and captions.
 *
 * @param {object} participant - Participant object
 * @returns {string} Reversed short name, or empty string if unavailable
 * @example
 * getShortNameReversed(participant) // 'SMITH, Jane'
 */
const getShortNameReversed = (participant) => {
  if (!participant?.demographicInformation) return ''
  const { firstName, lastName } = participant.demographicInformation
  return nunjucksSafe(`${lastName.toUpperCase()}, ${firstName}`)
}

/**
 * Get short name (first + last only) of participant as a Nunjucks-safe string
 *
 * @param {object} participant - Participant object
 * @returns {string} Short name, or empty string if unavailable
 */
const getShortName = (participant) => {
  if (!participant?.demographicInformation) return ''
  const { firstName, lastName } = participant.demographicInformation
  return nunjucksSafe(`${firstName} ${lastName}`)
}

/**
 * Find a participant by their SX number
 *
 * @param {Array} participants - Array of all participants
 * @param {string} sxNumber - SX number to search for
 * @returns {object | undefined} Matching participant or undefined
 */
const findBySXNumber = (participants, sxNumber) => {
  return participants.find((p) => p.sxNumber === sxNumber)
}

/**
 * Get participant's age
 *
 * @param {object} participant - Participant object
 * @param {Date} [referenceDate] - Optional date to calculate age from
 * @returns {number|null} Age in years or null if no date of birth
 */
const getAge = (participant, referenceDate = new Date()) => {
  if (!participant?.demographicInformation?.dateOfBirth) return null
  const dob = new Date(participant.demographicInformation.dateOfBirth)
  let age = referenceDate.getFullYear() - dob.getFullYear()
  const monthDiff = referenceDate.getMonth() - dob.getMonth()
  if (
    monthDiff < 0 ||
    (monthDiff === 0 && referenceDate.getDate() < dob.getDate())
  ) {
    age--
  }
  return age
}

/**
 * Sort participants by surname
 *
 * @param {Array} participants - Array of participants to sort
 * @returns {Array} Sorted participants array
 */
const sortBySurname = (participants) => {
  return [...participants].sort((a, b) => {
    const surnameA = a.demographicInformation?.lastName?.toLowerCase() || ''
    const surnameB = b.demographicInformation?.lastName?.toLowerCase() || ''
    return surnameA.localeCompare(surnameB)
  })
}

/**
 * Determine a participant's current risk level based on age and risk factors
 *
 * @param {object} participant - Participant object
 * @returns {string} Current risk level (routine, family history, or high)
 */
const getCurrentRiskLevel = (participant, referenceDate = new Date()) => {
  const age = getAge(participant, referenceDate)
  if (!age) return 'routine'

  // If they don't have risk factors, they're routine
  if (!participant.hasRiskFactors) {
    return 'routine'
  }

  // Check if they're in the family history risk age range
  const familyHistoryRange = riskLevels['family history'].ageRange
  if (age >= familyHistoryRange.lower && age < familyHistoryRange.upper) {
    return 'family history'
  }

  // Check if they're in the high risk age range
  const highRange = riskLevels.high.ageRange
  if (age >= highRange.lower && age <= highRange.upper) {
    return 'high'
  }

  // Default to routine for any other age ranges
  return 'routine'
}

/**
 * Get the display name of a participant's current screening protocol
 *
 * @param {object} participant - Participant object
 * @param {Date} [referenceDate] - Date to work out their age at
 * @returns {string} Protocol name, such as 'Routine' or 'Family history: moderate risk'
 */
const getScreeningProtocolName = (participant, referenceDate = new Date()) => {
  return riskLevels[getCurrentRiskLevel(participant, referenceDate)].name
}

// Saving data

/**
 * Find and update a participant in session data
 *
 * @param {object} data - Session data
 * @param {string} participantId - Participant ID
 * @param {object} updatedParticipant - Updated participant object
 * @returns {object | null} Updated participant or null if not found
 */
const updateParticipant = (data, participantId, updatedParticipant) => {
  const participantIndex = data.participants.findIndex(
    (p) => p.id === participantId
  )
  if (participantIndex === -1) return null

  // Real image ages are shown, not saved (see withRealImageDateOfBirth)
  const realImageChange = data._realImageDatesOfBirth?.get(participantId)
  if (
    realImageChange &&
    updatedParticipant.demographicInformation?.dateOfBirth ===
      realImageChange.to
  ) {
    updatedParticipant = {
      ...updatedParticipant,
      demographicInformation: {
        ...updatedParticipant.demographicInformation,
        dateOfBirth: realImageChange.from
      }
    }
  }

  // Update in the attached array (same-request reads) and record the change
  // in data._changes (persistence - the attached array is rebuilt from the
  // shared data store on every request; see middleware in app/routes.js)
  data.participants[participantIndex] = withRealImageDateOfBirth(
    data,
    updatedParticipant
  )
  recordChange(data, 'participants', updatedParticipant)
  return data.participants[participantIndex]
}

/**
 * Save temporary participant data back to the main participant
 *
 * This function takes the data.participant object and saves it back to the
 * participants array, then clears participant. Similar to saveTempAppointmentToAppointment.
 *
 * @param {object} data - Session data
 * @returns {object | null} Updated participant or null if no temp data
 */
const saveTempParticipantToParticipant = (data) => {
  if (!data.participant || !data.participant.id) {
    return null
  }

  const participantId = data.participant.id

  // Use updateParticipant to save the temp data
  const updatedParticipant = updateParticipant(
    data,
    participantId,
    data.participant
  )

  // Clear temp data
  delete data.participant

  return updatedParticipant
}

module.exports = {
  getParticipant,
  withRealImageDateOfBirth,
  getFullName,
  getShortNameReversed,
  getShortName,
  findBySXNumber,
  getAge,
  sortBySurname,
  getCurrentRiskLevel,
  getScreeningProtocolName,
  updateParticipant,
  saveTempParticipantToParticipant
}
