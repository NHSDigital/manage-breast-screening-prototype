// app/lib/generators/medical-information/medical-history-generator.js

const { faker } = require('@faker-js/faker')
const weighted = require('weighted')
const generateId = require('../../utils/id-generator')

// Configuration for implanted medical device generation
const IMPLANTED_DEVICE_CONFIG = {
  deviceTypes: {
    'Cardiac device': 0.7,
    'Hickman line': 0.3
  }
}

// Configuration for breast implants/augmentation generation
const BREAST_IMPLANTS_CONFIG = {
  // Which breast(s) have implants
  breastChoice: {
    'right-only': 0.15,
    'left-only': 0.15,
    'both': 0.70
  }
}

// Configuration for breast cancer generation
const BREAST_CANCER_CONFIG = {
  // Which breast(s) affected
  breastAffected: {
    'right-only': 0.35,
    'left-only': 0.35,
    'both': 0.20,
    'unknown': 0.10
  },
  // Procedure types (radio options)
  procedureTypes: [
    'Lumpectomy',
    'Mastectomy (tissue remaining)',
    'Mastectomy (no tissue remaining)',
    'No procedure'
  ],
  // Other surgery options (checkboxes)
  otherSurgeryOptions: [
    'Lymph node surgery',
    'Reconstruction',
    'Symmetrisation'
  ],
  // Treatment options (checkboxes)
  treatmentOptions: [
    'Breast radiotherapy',
    'Lymph node radiotherapy'
  ],
  // Systemic treatment options
  systemicTreatmentOptions: [
    'Chemotherapy',
    'Hormone therapy'
  ]
}

/**
 * Generate a single breast cancer history item
 * @param {object} [options] - Generation options
 * @param {string} [options.addedByUserId] - User who added this information
 * @returns {object} Generated breast cancer item
 */
const generateBreastCancerItem = (options = {}) =>
{
  const { addedByUserId } = options

  // Determine which breast(s) affected
  const breastAffected = weighted.select(BREAST_CANCER_CONFIG.breastAffected)

  const item = {
    id: generateId(),
    dateAdded: new Date().toISOString(),
    addedBy: addedByUserId || null
  }

  // Cancer location
  if (breastAffected === 'right-only')
  {
    item.cancerLocation = ['Right breast']
  }
  else if (breastAffected === 'left-only')
  {
    item.cancerLocation = ['Left breast']
  }
  else if (breastAffected === 'both')
  {
    item.cancerLocation = ['Right breast', 'Left breast']
  }
  else
  {
    item.cancerLocation = ['Does not know']
  }

  // Procedure year (90% of the time)
  if (Math.random() < 0.9)
  {
    item.procedureYear = faker.number.int({ min: 2010, max: 2024 }).toString()
  }

  // Procedures - always generate based on which breast is affected
  // Even if cancer location is unknown, procedures might still be recorded
  if (breastAffected === 'right-only' || breastAffected === 'both')
  {
    item.proceduresRightBreast = faker.helpers.arrayElement(
      BREAST_CANCER_CONFIG.procedureTypes
    )
  }

  if (breastAffected === 'left-only' || breastAffected === 'both')
  {
    item.proceduresLeftBreast = faker.helpers.arrayElement(
      BREAST_CANCER_CONFIG.procedureTypes
    )
  }

  // If cancer location is unknown, still might have procedures recorded
  if (breastAffected === 'unknown')
  {
    // Randomly assign procedures to one or both breasts
    const unknownBreastChoice = weighted.select({
      'right': 0.4,
      'left': 0.4,
      'both': 0.2
    })

    if (unknownBreastChoice === 'right' || unknownBreastChoice === 'both')
    {
      item.proceduresRightBreast = faker.helpers.arrayElement(
        BREAST_CANCER_CONFIG.procedureTypes
      )
    }

    if (unknownBreastChoice === 'left' || unknownBreastChoice === 'both')
    {
      item.proceduresLeftBreast = faker.helpers.arrayElement(
        BREAST_CANCER_CONFIG.procedureTypes
      )
    }
  }

  // Other surgery - generate if we have a procedure field for that breast
  if (item.proceduresRightBreast)
  {
    // 80% chance of having other surgery (not 'No surgery')
    if (Math.random() < 0.8)
    {
      const numberOfOptions = weighted.select({ 1: 0.6, 2: 0.3, 3: 0.1 })
      item.otherSurgeryRightBreast = faker.helpers.arrayElements(
        BREAST_CANCER_CONFIG.otherSurgeryOptions,
        numberOfOptions
      )
    }
    else
    {
      item.otherSurgeryRightBreast = ['No surgery']
    }
  }

  if (item.proceduresLeftBreast)
  {
    // 80% chance of having other surgery (not 'No surgery')
    if (Math.random() < 0.8)
    {
      const numberOfOptions = weighted.select({ 1: 0.6, 2: 0.3, 3: 0.1 })
      item.otherSurgeryLeftBreast = faker.helpers.arrayElements(
        BREAST_CANCER_CONFIG.otherSurgeryOptions,
        numberOfOptions
      )
    }
    else
    {
      item.otherSurgeryLeftBreast = ['No surgery']
    }
  }

  // Radiotherapy treatment - generate if we have a procedure field for that breast
  if (item.proceduresRightBreast)
  {
    // 75% chance of having radiotherapy (not 'No radiotherapy')
    if (Math.random() < 0.75)
    {
      const numberOfOptions = weighted.select({ 1: 0.7, 2: 0.3 })
      item.treatmentRightBreast = faker.helpers.arrayElements(
        BREAST_CANCER_CONFIG.treatmentOptions,
        numberOfOptions
      )
    }
    else
    {
      item.treatmentRightBreast = ['No radiotherapy']
    }
  }

  if (item.proceduresLeftBreast)
  {
    // 75% chance of having radiotherapy (not 'No radiotherapy')
    if (Math.random() < 0.75)
    {
      const numberOfOptions = weighted.select({ 1: 0.7, 2: 0.3 })
      item.treatmentLeftBreast = faker.helpers.arrayElements(
        BREAST_CANCER_CONFIG.treatmentOptions,
        numberOfOptions
      )
    }
    else
    {
      item.treatmentLeftBreast = ['No radiotherapy']
    }
  }

  // Systemic treatments (90% chance)
  if (Math.random() < 0.9)
  {
    const numberOfTreatments = weighted.select({ 1: 0.6, 2: 0.4 })
    item.systemicTreatments = faker.helpers.arrayElements(
      BREAST_CANCER_CONFIG.systemicTreatmentOptions,
      numberOfTreatments
    )

    // 20% chance of "Other treatment" too
    if (Math.random() < 0.2)
    {
      item.systemicTreatments.push('Other treatment')
      item.otherTreatmentDetails = faker.helpers.arrayElement([
        'Immunotherapy',
        'Targeted therapy',
        'Clinical trial treatment'
      ])
    }
  }

  // Treatment location (90% of the time)
  if (Math.random() < 0.9)
  {
    const locationChoice = weighted.select({
      'at-this-service': 0.6,
      'at-another-service': 0.3,
      'do-not-know': 0.1
    })

    item.treatmentLocation = locationChoice

    if (locationChoice === 'at-another-service')
    {
      item.treatmentLocationDetails = faker.helpers.arrayElement([
        'Royal Marsden Hospital',
        'Christie Hospital Manchester',
        'University College Hospital London',
        'Addenbrooke\'s Hospital Cambridge'
      ])
    }
  }

  // Additional details (60% of the time)
  if (Math.random() < 0.6)
  {
    item.additionalDetails = faker.helpers.arrayElement([
      'Currently on five-year follow-up surveillance',
      'Completed treatment in ' + faker.number.int({ min: 2020, max: 2024 }),
      'Under ongoing monitoring by oncology team',
      'No complications reported during treatment'
    ])
  }

  return item
}

/**
 * Generate a single breast implants/augmentation history item
 * @param {object} [options] - Generation options
 * @param {string} [options.addedByUserId] - User who added this information
 * @returns {object} Generated breast implants item
 */
const generateBreastImplantsItem = (options = {}) =>
{
  const { addedByUserId } = options

  const item = {
    id: generateId(),
    dateAdded: new Date().toISOString(),
    addedBy: addedByUserId || null
  }

  // Which breast(s) have implants
  const breastChoice = weighted.select(BREAST_IMPLANTS_CONFIG.breastChoice)

  if (breastChoice === 'right-only')
  {
    item.proceduresRightBreast = ['Breast implants']
    item.proceduresLeftBreast = ['No procedures']
  }
  else if (breastChoice === 'left-only')
  {
    item.proceduresLeftBreast = ['Breast implants']
    item.proceduresRightBreast = ['No procedures']
  }
  else // both
  {
    item.proceduresRightBreast = ['Breast implants']
    item.proceduresLeftBreast = ['Breast implants']
  }

  // Consent is required for breast implants - always set to 'yes' for generated data
  item.consentGiven = 'yes'

  // Procedure year (85% of the time)
  if (Math.random() < 0.85)
  {
    item.procedureYear = faker.number.int({ min: 2005, max: 2024 }).toString()
  }

  // Implants removed (20% chance)
  if (Math.random() < 0.2)
  {
    item.implantsRemoved = ['Implants have been removed']

    // Year removed (90% of the time if removed)
    if (Math.random() < 0.9)
    {
      const implantYear = item.procedureYear ? parseInt(item.procedureYear) : 2010
      item.yearRemoved = faker.number.int({
        min: implantYear,
        max: 2024
      }).toString()
    }
  }

  // Additional details (40% of the time)
  if (Math.random() < 0.4)
  {
    item.additionalDetails = faker.helpers.arrayElement([
      'Silicone implants',
      'Saline implants',
      'Regular monitoring in place',
      'No complications reported'
    ])
  }

  return item
}

/**
 * Generate a single implanted medical device history item
 * @param {object} [options] - Generation options
 * @param {string} [options.addedByUserId] - User who added this information
 * @returns {object} Generated implanted device item
 */
const generateImplantedDeviceItem = (options = {}) =>
{
  const { addedByUserId } = options

  const item = {
    id: generateId(),
    dateAdded: new Date().toISOString(),
    addedBy: addedByUserId || null
  }

  // Device type
  item.type = weighted.select(IMPLANTED_DEVICE_CONFIG.deviceTypes)

  // Procedure year (80% of the time)
  if (Math.random() < 0.8)
  {
    item.procedureYear = faker.number.int({ min: 2010, max: 2024 }).toString()
  }

  // Device removed (30% chance)
  if (Math.random() < 0.3)
  {
    item.deviceRemoved = ['Implanted device has been removed']

    // Year removed (90% of the time if removed)
    if (Math.random() < 0.9)
    {
      const implantYear = item.procedureYear ? parseInt(item.procedureYear) : 2015
      item.yearRemoved = faker.number.int({
        min: implantYear,
        max: 2024
      }).toString()
    }
  }

  // Additional details (40% of the time)
  if (Math.random() < 0.4)
  {
    item.additionalDetails = faker.helpers.arrayElement([
      'Device functioning normally',
      'Regular monitoring in place',
      'Patient has device identification card'
    ])
  }

  return item
}

/**
 * Generate medical history for an event
 * @param {object} [options] - Generation options
 * @param {number} [options.probability=0.20] - Chance of having any medical history
 * @param {string} [options.addedByUserId] - User who added this information
 * @param {object} [options.medicalHistory] - Complete override for medical history
 * @param {Array} [options.forceMedicalHistoryTypes] - Force specific types to be included
 * @param {object} [options.config] - Participant config for overrides
 * @returns {object} Medical history object with arrays for each type
 */
const generateMedicalHistory = (options = {}) =>
{
  const {
    probability = 0.20,
    addedByUserId,
    medicalHistory,
    forceMedicalHistoryTypes = [],
    config
  } = options

  // Support complete override from test scenarios
  if (medicalHistory)
  {
    return medicalHistory
  }

  const history = {}

  // Always generate forced types first
  if (forceMedicalHistoryTypes.includes('breastCancer'))
  {
    const numberOfItems = weighted.select({
      1: 0.85,
      2: 0.15
    })
    history.breastCancer = Array.from({ length: numberOfItems }, () =>
      generateBreastCancerItem({ addedByUserId })
    )
  }

  if (forceMedicalHistoryTypes.includes('implantedMedicalDevice'))
  {
    const numberOfItems = weighted.select({
      1: 0.85,
      2: 0.15
    })
    history.implantedMedicalDevice = Array.from({ length: numberOfItems }, () =>
      generateImplantedDeviceItem({ addedByUserId })
    )
  }

  if (forceMedicalHistoryTypes.includes('breastImplantsAugmentation'))
  {
    // Breast implants can only have one entry (single entry only)
    history.breastImplantsAugmentation = [generateBreastImplantsItem({ addedByUserId })]
  }

  // If we have forced types, skip probability check - we already have history
  if (forceMedicalHistoryTypes.length === 0)
  {
    // Check if they have any medical history (normal random generation)
    if (Math.random() > probability)
    {
      return {}
    }

    // They have medical history - check each type independently
    // This allows multiple types per event for testing
    // Set to 100% (1.0) for maximum test coverage

    // Breast cancer (100% for testing)
    if (Math.random() < 1.0)
    {
      const numberOfItems = weighted.select({
        1: 0.85,
        2: 0.15
      })
      history.breastCancer = Array.from({ length: numberOfItems }, () =>
        generateBreastCancerItem({ addedByUserId })
      )
    }

    // Implanted medical device (100% for testing)
    if (Math.random() < 1.0)
    {
      const numberOfItems = weighted.select({
        1: 0.85,
        2: 0.15
      })
      history.implantedMedicalDevice = Array.from({ length: numberOfItems }, () =>
        generateImplantedDeviceItem({ addedByUserId })
      )
    }

    // Breast implants (100% for testing)
    if (Math.random() < 1.0)
    {
      // Breast implants can only have one entry (single entry only)
      history.breastImplantsAugmentation = [generateBreastImplantsItem({ addedByUserId })]
    }
  }

  // TODO: Add other medical history types here
  // - mastectomyLumpectomy
  // - cysts
  // - benignLumps
  // - otherProcedures

  return history
}

module.exports = {
  generateMedicalHistory,
  generateBreastCancerItem,
  generateImplantedDeviceItem,
  generateBreastImplantsItem
}
