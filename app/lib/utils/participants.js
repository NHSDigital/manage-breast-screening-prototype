// app/lib/utils/participants.js

const { safe: nunjucksSafe } = require('nunjucks/src/filters')
const riskLevels = require('../../data/risk-levels.js')
const dataStore = require('../data-store')

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
  return (
    data._changes?.participants?.[participantId] ??
    dataStore.state.participantsById.get(participantId) ??
    data.participants?.find((p) => p.id === participantId) ??
    null
  )
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
 * Get first names (first + middle) of a participant as a Nunjucks-safe string
 *
 * @param {object} participant - Participant object
 * @returns {string} First names, or empty string if unavailable
 */
const getFirstNames = (participant) => {
  if (!participant?.demographicInformation) return ''
  const { firstName, middleName } = participant.demographicInformation
  return nunjucksSafe([firstName, middleName].filter(Boolean).join(' '))
}

/**
 * Get full name in reversed 'Last, First Middle' format
 *
 * @param {object} participant - Participant object
 * @returns {string} Reversed full name, or empty string if unavailable
 * @example
 * getFullNameReversed(participant) // 'Smith, Jane Louise'
 */
const getFullNameReversed = (participant) => {
  if (!participant?.demographicInformation) return ''
  const { firstName, middleName, lastName } = participant.demographicInformation
  return [`${lastName},`, firstName, middleName].filter(Boolean).join(' ')
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

  // Update in the attached array (same-request reads) and record the change
  // in data._changes (persistence - the attached array is rebuilt from the
  // shared data store on every request; see middleware in app/routes.js)
  data.participants[participantIndex] = updatedParticipant
  if (data._changes?.participants) {
    data._changes.participants[participantId] = updatedParticipant
  }
  return updatedParticipant
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
  getFullName,
  getFirstNames,
  getFullNameReversed,
  getShortName,
  findBySXNumber,
  getAge,
  sortBySurname,
  getCurrentRiskLevel,
  updateParticipant,
  saveTempParticipantToParticipant
}
