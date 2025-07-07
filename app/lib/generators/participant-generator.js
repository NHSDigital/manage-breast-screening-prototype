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

// List of possible extra needs
const EXTRA_NEEDS = [
  'Agoraphobia',
  // 'Breast implants', // needs consent journey that isn't designed yet
  'Learning difficulties',
  'Physical restriction',
  'Registered disabled',
  'Social reasons',
  'Wheelchair user',
  'Transgender',
  // 'Other' // need to come up with some free text replies before using this
]

// Generate extra needs for a participant
const generateExtraNeeds = (config = { probability: 0.08 }) => {
  // Check if they should have extra needs
  if (Math.random() > config.probability) {
    return null
  }

  // Use weighted to determine how many needs they should have
  const needCount = weighted.select({
    1: 0.7, // 70% chance of 1 need
    2: 0.2, // 20% chance of 2 needs
    3: 0.1, // 10% chance of 3 needs
  })

  // Select that many random needs
  return faker.helpers.arrayElements(EXTRA_NEEDS, {
    min: needCount,
    max: needCount,
  })
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

// New medical history generators
const generateMedicalHistorySurvey = () => {
  // 50% chance of having completed the survey
  if (Math.random() > 0.5) {
    return null
  }

  return {
    completedAt: faker.date.past({ years: 1 }).toISOString(),

    // Non-cancerous procedures/diagnoses
    nonCancerousProcedures: generateNonCancerousProcedures(),

    // Current hormone therapy (if they had previous cancer)
    onHormoneTherapy: Math.random() < 0.3, // 30% of those with cancer history

    // Other medical history
    otherMedicalHistory: Math.random() < 0.3
      ? faker.helpers.arrayElements([
        'Type 2 diabetes - diet controlled',
        'High blood pressure - medication',
        'Osteoarthritis',
        'Previous shoulder surgery',
        'Rheumatoid arthritis',
      ], { min: 1, max: 2 })
      : null,
  }
}

const generateNonCancerousProcedures = () => {
  const procedures = []

  const possibleProcedures = {
    benign_lump: {
      probability: 0.15,
      details: () => ({
        dateDiscovered: faker.date.past({ years: 5 }).toISOString(),
        position: faker.helpers.arrayElement(['Left breast', 'Right breast']),
        wasRemoved: Math.random() < 0.7,
        pathology: 'Fibroadenoma',
      }),
    },
    cyst_aspiration: {
      probability: 0.1,
      details: () => ({
        date: faker.date.past({ years: 3 }).toISOString(),
        location: faker.helpers.arrayElement(['Left breast', 'Right breast']),
        notes: 'Simple cyst, fluid aspirated',
      }),
    },
    non_implant_augmentation: {
      probability: 0.02,
      details: () => ({
        date: faker.date.past({ years: 5 }).toISOString(),
        procedure: 'Fat transfer procedure',
        hospital: 'General Hospital',
      }),
    },
    breast_reduction: {
      probability: 0.03,
      details: () => ({
        date: faker.date.past({ years: 5 }).toISOString(),
        notes: 'Bilateral breast reduction',
        hospital: 'City Hospital',
      }),
    },
    previous_biopsy: {
      probability: 0.08,
      details: () => ({
        date: faker.date.past({ years: 2 }).toISOString(),
        result: 'Benign',
        location: faker.helpers.arrayElement(['Left breast', 'Right breast']),
      }),
    },
    skin_lesion: {
      probability: 0.05,
      details: () => ({
        date: faker.date.past({ years: 3 }).toISOString(),
        type: faker.helpers.arrayElement(['Seborrheic keratosis', 'Dermatofibroma']),
        location: faker.helpers.arrayElement(['Left breast', 'Right breast']),
      }),
    },
  }

  Object.entries(possibleProcedures).forEach(([type, config]) => {
    if (Math.random() < config.probability) {
      procedures.push({
        type,
        ...config.details(),
      })
    }
  })

  return procedures
}

const generateParticipant = ({
  ethnicities,
  breastScreeningUnits,
  extraNeedsConfig = { probability: 0.08 },
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
    extraNeeds: generateExtraNeeds(extraNeedsConfig),
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
      riskFactors: generateRiskFactors(),
      familyHistory: generateFamilyHistory(),
      previousCancerHistory: generatePreviousCancerHistory(),
      medicalHistorySurvey: generateMedicalHistorySurvey(),
    },
    currentHealthInformation: {
      isPregnant: false,
      onHRT: Math.random() < 0.1,
      hasBreastImplants: Math.random() < 0.05,
      recentBreastSymptoms: generateRecentSymptoms(),
      medications: generateMedications(),
    },
  }

  if (!overrides) {
    return baseParticipant
  }

  // If we have overrides, do a deep merge excluding the scheduling info
  const { scheduling, ...participantOverrides } = overrides
  return _.merge({}, baseParticipant, participantOverrides)
}

// Modified family history generator to add more detail
const generateFamilyHistory = () => {
  if (Math.random() > 0.15) return null // 15% chance of family history

  const affectedRelatives = faker.helpers.arrayElements(
    [
      { relation: 'mother', age: faker.number.int({ min: 35, max: 75 }) },
      { relation: 'sister', age: faker.number.int({ min: 30, max: 70 }) },
      { relation: 'daughter', age: faker.number.int({ min: 25, max: 45 }) },
      { relation: 'grandmother', age: faker.number.int({ min: 45, max: 85 }) },
      { relation: 'aunt', age: faker.number.int({ min: 40, max: 80 }) },
    ],
    { min: 1, max: 3 }
  )

  return {
    hasFirstDegreeHistory: affectedRelatives.some(r =>
      ['mother', 'sister', 'daughter'].includes(r.relation)
    ),
    affectedRelatives,
    additionalDetails: Math.random() < 0.3
      ? 'Multiple occurrences on maternal side'
      : null,
  }
}

const generateRiskFactors = () => {
  const factors = []
  const possibleFactors = {
    family_history: 0.15,
    dense_breast_tissue: 0.1,
    previous_radiation_therapy: 0.05,
    obesity: 0.2,
    alcohol_consumption: 0.15,
  }

  Object.entries(possibleFactors).forEach(([factor, probability]) => {
    if (Math.random() < probability) {
      factors.push(factor)
    }
  })

  return factors
}

// Modified previous cancer history to include more detail
const generatePreviousCancerHistory = () => {
  if (Math.random() > 0.02) return null // 2% chance of previous cancer

  const treatments = faker.helpers.arrayElements(
    [
      { type: 'surgery', details: 'Wide local excision' },
      { type: 'radiotherapy', details: '15 fractions' },
      { type: 'chemotherapy', details: '6 cycles' },
      { type: 'hormone_therapy', details: '5 years tamoxifen' },
    ],
    { min: 1, max: 3 }
  )

  return {
    yearDiagnosed: faker.date.past({ years: 20 }).getFullYear(),
    type: faker.helpers.arrayElement([
      'ductal_carcinoma_in_situ',
      'invasive_ductal_carcinoma',
      'invasive_lobular_carcinoma',
    ]),
    position: faker.helpers.arrayElement([
      'Left breast - upper outer quadrant',
      'Right breast - upper outer quadrant',
      'Left breast - lower inner quadrant',
      'Right breast - lower inner quadrant',
    ]),
    treatments,
    hospital: faker.helpers.arrayElement([
      'City General Hospital',
      'Royal County Hospital',
      'Memorial Cancer Centre',
      'University Teaching Hospital',
    ]),
    additionalNotes: Math.random() < 0.3
      ? 'Regular follow-up completed'
      : null,
  }
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

const generateMedications = () => {
  if (Math.random() > 0.3) return [] // 30% chance of medications

  return faker.helpers.arrayElements([
    'hormone_replacement_therapy',
    'blood_pressure_medication',
    'diabetes_medication',
    'cholesterol_medication',
  ], { min: 1, max: 3 })
}

module.exports = {
  generateParticipant,
}
