// app/lib/utils/participants.js

const { safe: nunjucksSafe } = require('nunjucks/src/filters')
const riskLevels = require('../../data/risk-levels.js')

/**
 * Get a participant by ID
 * @param {Object} data - Session data containing participants
 * @param {string} participantId - Participant ID to search for
 * @returns {Object|null} Participant object or null if not found
 */
const getParticipant = (data, participantId) => {
  return data.participants.find((p) => p.id === participantId) || null
}

/**
 * Get full name of participant
 * @param {Object} participant - Participant object
 */
const getFullName = (participant) => {
  if (!participant?.demographicInformation) return ''
  const { firstName, middleName, lastName } = participant.demographicInformation
  return nunjucksSafe(
    [firstName, middleName, lastName].filter(Boolean).join(' ')
  )
}

/**
 * Get full name of participant
 * @param {Object} participant - Participant object
 */
const getFullNameReversed = (participant) => {
  if (!participant?.demographicInformation) return ''
  const { firstName, middleName, lastName } = participant.demographicInformation
  return [`${lastName},`, firstName, middleName].filter(Boolean).join(' ')
}

/**
 * Get short name (first + last) of participant
 * @param {Object} participant - Participant object
 */
const getShortName = (participant) => {
  if (!participant?.demographicInformation) return ''
  const { firstName, lastName } = participant.demographicInformation
  return nunjucksSafe(`${firstName} ${lastName}`)
}

/**
 * Find a participant by their SX number
 * @param {Array} participants - Array of all participants
 * @param {string} sxNumber - SX number to search for
 */
const findBySXNumber = (participants, sxNumber) => {
  return participants.find((p) => p.sxNumber === sxNumber)
}

/**
 * Get participant's age
 * @param {Object} participant - Participant object
 * @param {Date} [referenceDate=new Date()] - Optional date to calculate age from
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
 * Get clinic history for a participant with optional filters
 * @param {Object} data - Session data containing clinics and events
 * @param {string} participantId - Participant ID to get history for
 * @param {Object} options - Filter options
 * @param {string} options.filter - Filter type: 'historic', 'upcoming', or 'all'
 * @param {boolean} options.mostRecent - If true, returns only the most recent matching clinic
 * @returns {Array|Object} Array of clinic/event pairs, or single most recent pair
 */
const getParticipantClinicHistory = (data, participantId, options = {}) => {
  const { filter = 'all', mostRecent = false } = options

  if (!data?.events || !data?.clinics || !participantId) return []

  const today = new Date().setHours(0, 0, 0, 0)

  // Get participant events with clinic details
  const history = data.events
    .filter((event) => event.participantId === participantId)
    .map((event) => {
      const clinic = data.clinics.find((clinic) => clinic.id === event.clinicId)
      if (!clinic) return null

      const unit = data.breastScreeningUnits.find(
        (unit) => unit.id === clinic.breastScreeningUnitId
      )
      const location = unit.locations.find(
        (location) => location.id === clinic.locationId
      )

      return {
        clinic,
        unit,
        location,
        event
      }
    })
    .filter(Boolean) // Remove null entries

  // Apply date filtering
  const filtered = history.filter((item) => {
    const clinicDate = new Date(item.clinic.date).setHours(0, 0, 0, 0)

    switch (filter) {
      case 'historic':
        return clinicDate < today
      case 'upcoming':
        return clinicDate >= today
      default:
        return true
    }
  })

  // Sort by date, most recent first
  const sorted = filtered.sort(
    (a, b) => new Date(b.clinic.date) - new Date(a.clinic.date)
  )

  return mostRecent ? sorted[0] || null : sorted
}

// Helper functions for common use cases
const getParticipantMostRecentClinic = (data, participantId) =>
  getParticipantClinicHistory(data, participantId, {
    filter: 'historic',
    mostRecent: true
  })

const getParticipantMostRecentClinicDate = (data, participantId) => {
  const clinic = getParticipantClinicHistory(data, participantId, {
    filter: 'historic',
    mostRecent: true
  })
  if (clinic) {
    return clinic.event.timing.startTime
  } else return false
}

const getParticipantHistoricClinics = (data, participantId) =>
  getParticipantClinicHistory(data, participantId, { filter: 'historic' })

const getParticipantUpcomingClinics = (data, participantId) =>
  getParticipantClinicHistory(data, participantId, { filter: 'upcoming' })

/**
 * Determine a participant's current risk level based on age and risk factors
 * @param {Object} participant - Participant object
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
 * @param {Object} data - Session data
 * @param {string} participantId - Participant ID
 * @param {Object} updatedParticipant - Updated participant object
 * @returns {Object|null} Updated participant or null if not found
 */
const updateParticipant = (data, participantId, updatedParticipant) => {
  const participantIndex = data.participants.findIndex(
    (p) => p.id === participantId
  )
  if (participantIndex === -1) return null

  // Update in the array
  data.participants[participantIndex] = updatedParticipant
  return updatedParticipant
}

/**
 * Save temporary participant data back to the main participant
 * @param {Object} data - Session data
 * @returns {Object|null} Updated participant or null if no temp data
 *
 * This function takes the data.participant object and saves it back to the
 * participants array, then clears participant. Similar to saveTempEventToEvent.
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
  getFullNameReversed,
  getShortName,
  findBySXNumber,
  getAge,
  sortBySurname,
  getParticipantClinicHistory,
  getParticipantMostRecentClinic,
  getParticipantMostRecentClinicDate,
  getParticipantHistoricClinics,
  getParticipantUpcomingClinics,
  getCurrentRiskLevel,
  updateParticipant,
  saveTempParticipantToParticipant
}
