// app/lib/generators/participant-generator.js

const { faker } = require('@faker-js/faker')
const generateId = require('../utils/id-generator')
const weighted = require('weighted')
const { generateBSUAppropriateAddress } = require('./address-generator')
const _ = require('lodash')
const riskLevels = require('../../data/risk-levels')
const dayjs = require('dayjs')

/**
 * Generate a precise date of birth within the specified age range
 * @param {Object} options - Generation options
 * @param {string} options.riskLevel - Risk level to use for age range
 * @param {Date} [options.referenceDate] - Date to calculate age from (defaults to today)
 * @returns {string} ISO date string for date of birth
 */
const generateDateOfBirth = (riskLevel, referenceDate = new Date() ) => {
  const refDate = dayjs(referenceDate)
  let minAge, maxAge

  if (riskLevel && riskLevels[riskLevel]) {
    const ageRange = riskLevels[riskLevel].ageRange
    minAge = ageRange.lower
    maxAge = ageRange.upper
  } else {
    // Default to routine screening age range if no risk level specified
    minAge = riskLevels.routine.ageRange.lower
    maxAge = riskLevels.routine.ageRange.upper
  }

  // Calculate start and end dates for the range
  const from = dayjs(refDate).subtract(maxAge, 'year').toDate()
  const to = dayjs(refDate).subtract(minAge, 'year').toDate()

  return faker.date.between({ from, to }).toISOString()
}


const generateEthnicity = (ethnicities) => {
  // 50% chance of having ethnicity data at all
  if (Math.random() > 0.5) {
    return {
      ethnicGroup: null,
      ethnicBackground: null
    }
  }

  const ethnicGroup = weighted.select(Object.keys(ethnicities), [0.85, 0.08, 0.03, 0.02, 0.02])

  // 20% chance of having background set to "Not provided"
  if (Math.random() < 0.2) {
    return {
      ethnicGroup,
      ethnicBackground: 'Prefer not to say'
    }
  }

  return {
    ethnicGroup,
    ethnicBackground: faker.helpers.arrayElement(ethnicities[ethnicGroup])
  }
}

// Pick a random risk level based on configured weights
const pickRiskLevel = () => {
  // Create weights object from risk levels
  const weights = {}
  Object.entries(riskLevels).forEach(([level, data]) => {
    if (data.weight) {
      weights[level] = data.weight
    }
  })

  return weighted.select(weights)
}

// Generate a UK mobile phone number
const generateUKMobileNumber = () => {
  const suffix = faker.number.int({ min: 900000, max: 900999 })
  return `07700${suffix}` // Ofcom reserved range
}

// Generate a UK landline/home phone number
const generateUKHomeNumber = () => {
  const areaCode = faker.helpers.arrayElement(['0118', '01865'])
  const suffix = faker.number.int({ min: 0, max: 999 }).toString().padStart(3, '0')
  return `${areaCode}4960${suffix}` // Ofcom reserved range
}

// Generate phone numbers for a participant
const generatePhoneNumbers = () => {
  // Phone number probabilities
  const phoneConfig = weighted.select({
    mobile_only: 0.6,    // 60% mobile only
    both: 0.35,          // 35% both mobile and home
    home_only: 0.05,     // 5% home only
  })

  const result = {
    mobilePhone: null,
    homePhone: null,
  }

  switch (phoneConfig) {
    case 'mobile_only':
      result.mobilePhone = generateUKMobileNumber()
      break
    case 'both':
      result.mobilePhone = generateUKMobileNumber()
      result.homePhone = generateUKHomeNumber()
      break
    case 'home_only':
      result.homePhone = generateUKHomeNumber()
      break
  }

  return result
}

// Function to generate SX number
const generateSXNumber = (bsuAbbreviation) => {
  const digits = Array.from({ length: 6 }, () =>
    faker.number.int(9)
  ).join('')
  return `${bsuAbbreviation}${digits}`
}

// NHS Number Generator
const generateNHSNumber = () => {
  // Generate 6 random digits
  // NHS numbers starting with 999 are never issued.
  // https://digital.nhs.uk/services/e-referral-service/document-library/synthetic-data-in-live-environments#synthetic-data-naming-convention
  const baseNumber = '999' + Array.from({ length: 6 }, () =>
    faker.number.int(9)
  ).join('')

  // Calculate check digit
  let sum = 0
  for (let i = 0; i < 9; i++) {
    sum += parseInt(baseNumber[i]) * (11 - (i + 1))
  }
  const checkDigit = (11 - (sum % 11)) % 11
  const finalCheckDigit = checkDigit === 10 ? 0 : checkDigit

  return `${baseNumber}${finalCheckDigit}`
}

const generateParticipant = ({
  ethnicities,
  breastScreeningUnits,
  riskLevel = null,
  overrides = null,
}) => {

  const id = generateId()

  // Determine risk level first as it affects age generation
  const participantRiskLevel = overrides?.config?.defaultRiskLevel || riskLevel || pickRiskLevel()

  // First get or generate BSU
  const assignedBSU = overrides?.assignedBSU
    ? breastScreeningUnits.find(bsu => bsu.id === overrides.assignedBSU)
    : faker.helpers.arrayElement(breastScreeningUnits)

  // Generate ethnicity data using new function
  const ethnicityData = generateEthnicity(ethnicities)

  // Generate phone numbers
  const phoneNumbers = generatePhoneNumbers()

  // Generate base random participant first
  const baseParticipant = {
    id: id,
    sxNumber: generateSXNumber(faker.helpers.arrayElement(breastScreeningUnits).abbreviation),
    assignedBSU: assignedBSU.id,
    hasRiskFactors: participantRiskLevel !== 'routine',
    seedRiskLevel: participantRiskLevel,
    demographicInformation: {
      firstName: faker.person.firstName('female'),
      middleName: Math.random() < 0.3 ? faker.person.firstName('female') : null,
      lastName: faker.person.lastName(),
      dateOfBirth: generateDateOfBirth(participantRiskLevel),
      address: generateBSUAppropriateAddress(assignedBSU),
      mobilePhone: phoneNumbers.mobilePhone,
      homePhone: phoneNumbers.homePhone,
      email: `${faker.internet.username().toLowerCase()}@example.com`,
      ethnicGroup: ethnicityData.ethnicGroup,
      ethnicBackground: ethnicityData.ethnicBackground,
    },
    medicalInformation: {
      nhsNumber: generateNHSNumber(),
    },
    currentHealthInformation: {
      isPregnant: false,
      onHRT: Math.random() < 0.1,
      recentBreastSymptoms: generateRecentSymptoms(),
    },
  }

  if (!overrides) {
    return baseParticipant
  }

  // If we have overrides, do a deep merge excluding the scheduling info
  const { scheduling, ...participantOverrides } = overrides
  return _.merge({}, baseParticipant, participantOverrides)
}

const generateRecentSymptoms = () => {
  if (Math.random() > 0.1) return null // 10% chance of recent symptoms

  return faker.helpers.arrayElements([
    'lump',
    'pain',
    'nipple_discharge',
    'skin_changes',
    'shape_change',
  ], { min: 1, max: 2 })
}

module.exports = {
  generateParticipant,
}