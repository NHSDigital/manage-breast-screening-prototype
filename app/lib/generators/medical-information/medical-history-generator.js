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

// Configuration for mastectomy/lumpectomy generation
const MASTECTOMY_LUMPECTOMY_CONFIG = {
  // Which breast(s) had surgery
  breastChoice: {
    'right-only': 0.4,
    'left-only': 0.4,
    'both': 0.2
  },
  // Procedure types (same as breast cancer but for prophylactic/elective surgery)
  procedureTypes: [
    'Lumpectomy',
    'Mastectomy (tissue remaining)',
    'Mastectomy (no tissue remaining)'
  ],
  // Other surgery options
  otherSurgeryOptions: [
    'Reconstruction',
    'Symmetrisation'
  ],
  // Surgery reasons (skip 'Other reason')
  surgeryReasons: {
    'Risk reduction': 0.7,
    'Gender-affirmation': 0.3
  }
}

// Configuration for cysts generation
const CYSTS_CONFIG = {
  // Cyst status options with weights
  statusOptions: {
    'Yes, not treated': 0.4,
    'Yes, drained or removed': 0.5,
    'No': 0.1
  }
}

// Configuration for benign lumps generation
const BENIGN_LUMPS_CONFIG = {
  // Which breast(s) had procedures
  breastChoice: {
    'right-only': 0.4,
    'left-only': 0.4,
    'both': 0.2
  },
  // Procedure options
  procedureOptions: [
    'Needle biopsy',
    'Lump removed'
  ]
}

// Configuration for other procedures generation
const OTHER_PROCEDURES_CONFIG = {
  // Procedure types with weights
  procedureTypes: {
    'Breast reduction': 0.35,
    'Breast symmetrisation': 0.30,
    'Nipple correction': 0.25,
    'Other': 0.10
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

  // Year (90% of the time)
  if (Math.random() < 0.9)
  {
    item.year = faker.number.int({ min: 2010, max: 2024 }).toString()
  }

  // Procedures - always generate based on which breast is affected
  // Remove 'No procedure' from options - if they have cancer history, at least one breast had a procedure
  const actualProcedureTypes = BREAST_CANCER_CONFIG.procedureTypes.filter(
    type => type !== 'No procedure'
  )

  // Even if cancer location is unknown, procedures might still be recorded
  if (breastAffected === 'right-only' || breastAffected === 'both')
  {
    item.proceduresRightBreast = faker.helpers.arrayElement(actualProcedureTypes)
  }

  if (breastAffected === 'left-only' || breastAffected === 'both')
  {
    item.proceduresLeftBreast = faker.helpers.arrayElement(actualProcedureTypes)
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
      item.proceduresRightBreast = faker.helpers.arrayElement(actualProcedureTypes)
    }

    if (unknownBreastChoice === 'left' || unknownBreastChoice === 'both')
    {
      item.proceduresLeftBreast = faker.helpers.arrayElement(actualProcedureTypes)
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

  // Location (90% of the time)
  if (Math.random() < 0.9)
  {
    const locationChoice = weighted.select({
      'At an NHS hospital': 0.6,
      'At a private clinic in the UK': 0.2,
      'Outside the UK': 0.1,
      'Exact location unknown': 0.1
    })

    item.location = locationChoice

    // Add conditional details for certain locations
    if (locationChoice === 'At an NHS hospital')
    {
      item.locationNhsHospitalDetails = faker.helpers.arrayElement([
        'Royal Marsden Hospital',
        'Christie Hospital Manchester',
        'University College Hospital London',
        'Addenbrooke\'s Hospital Cambridge'
      ])
    }
    else if (locationChoice === 'At a private clinic in the UK')
    {
      item.locationPrivateClinicDetails = faker.helpers.arrayElement([
        'Harley Street Clinic',
        'London Bridge Hospital',
        'Cromwell Hospital'
      ])
    }
    else if (locationChoice === 'Outside the UK')
    {
      item.locationOutsideUkDetails = faker.helpers.arrayElement([
        'France',
        'Spain',
        'Australia'
      ])
    }
  }

  // Additional details (75% of the time)
  if (Math.random() < 0.75)
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

  // Year (85% of the time)
  if (Math.random() < 0.85)
  {
    item.year = faker.number.int({ min: 2005, max: 2024 }).toString()
  }

  // Implants removed (20% chance)
  if (Math.random() < 0.2)
  {
    item.implantsRemoved = ['Implants have been removed']

    // Year removed (90% of the time if removed)
    if (Math.random() < 0.9)
    {
      const implantYear = item.year ? parseInt(item.year) : 2010
      item.yearRemoved = faker.number.int({
        min: implantYear,
        max: 2024
      }).toString()
    }
  }

  // Additional details (75% of the time)
  if (Math.random() < 0.75)
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
 * Generate a single mastectomy/lumpectomy history item
 * @param {object} [options] - Generation options
 * @param {string} [options.addedByUserId] - User who added this information
 * @returns {object} Generated mastectomy/lumpectomy item
 */
const generateMastectomyLumpectomyItem = (options = {}) =>
{
  const { addedByUserId } = options

  const item = {
    id: generateId(),
    dateAdded: new Date().toISOString(),
    addedBy: addedByUserId || null
  }

  // Which breast(s) had surgery
  const breastChoice = weighted.select(MASTECTOMY_LUMPECTOMY_CONFIG.breastChoice)

  if (breastChoice === 'right-only')
  {
    item.proceduresRightBreast = faker.helpers.arrayElement(
      MASTECTOMY_LUMPECTOMY_CONFIG.procedureTypes
    )
    item.proceduresLeftBreast = 'No procedures'
  }
  else if (breastChoice === 'left-only')
  {
    item.proceduresLeftBreast = faker.helpers.arrayElement(
      MASTECTOMY_LUMPECTOMY_CONFIG.procedureTypes
    )
    item.proceduresRightBreast = 'No procedures'
  }
  else // both
  {
    item.proceduresRightBreast = faker.helpers.arrayElement(
      MASTECTOMY_LUMPECTOMY_CONFIG.procedureTypes
    )
    item.proceduresLeftBreast = faker.helpers.arrayElement(
      MASTECTOMY_LUMPECTOMY_CONFIG.procedureTypes
    )
  }

  // Other surgery (70% chance)
  if (item.proceduresRightBreast && item.proceduresRightBreast !== 'No procedures')
  {
    if (Math.random() < 0.7)
    {
      const numberOfOptions = weighted.select({ 1: 0.7, 2: 0.3 })
      item.otherSurgeryRightBreast = faker.helpers.arrayElements(
        MASTECTOMY_LUMPECTOMY_CONFIG.otherSurgeryOptions,
        numberOfOptions
      )
    }
    else
    {
      item.otherSurgeryRightBreast = ['No surgery']
    }
  }

  if (item.proceduresLeftBreast && item.proceduresLeftBreast !== 'No procedures')
  {
    if (Math.random() < 0.7)
    {
      const numberOfOptions = weighted.select({ 1: 0.7, 2: 0.3 })
      item.otherSurgeryLeftBreast = faker.helpers.arrayElements(
        MASTECTOMY_LUMPECTOMY_CONFIG.otherSurgeryOptions,
        numberOfOptions
      )
    }
    else
    {
      item.otherSurgeryLeftBreast = ['No surgery']
    }
  }

  // Year (85% of the time)
  if (Math.random() < 0.85)
  {
    item.year = faker.number.int({ min: 2010, max: 2024 }).toString()
  }

  // Surgery reason (always required)
  item.mastectomyLumpectomySurgeryReason = weighted.select(
    MASTECTOMY_LUMPECTOMY_CONFIG.surgeryReasons
  )

  // Additional details (75% of the time)
  if (Math.random() < 0.75)
  {
    item.additionalDetails = faker.helpers.arrayElement([
      'Prophylactic surgery following genetic testing',
      'Family history of breast cancer',
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

  // Year (80% of the time)
  if (Math.random() < 0.8)
  {
    item.year = faker.number.int({ min: 2010, max: 2024 }).toString()
  }

  // Device removed (30% chance)
  if (Math.random() < 0.3)
  {
    item.deviceRemoved = ['Implanted device has been removed']

    // Year removed (90% of the time if removed)
    if (Math.random() < 0.9)
    {
      const implantYear = item.year ? parseInt(item.year) : 2015
      item.yearRemoved = faker.number.int({
        min: implantYear,
        max: 2024
      }).toString()
    }
  }

  // Additional details (75% of the time)
  if (Math.random() < 0.75)
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
 * Generate a single cysts history item
 * @param {object} [options] - Generation options
 * @param {string} [options.addedByUserId] - User who added this information
 * @returns {object} Generated cysts item
 */
const generateCystsItem = (options = {}) =>
{
  const { addedByUserId } = options

  const item = {
    id: generateId(),
    dateAdded: new Date().toISOString(),
    addedBy: addedByUserId || null
  }

  // Cyst status
  item.cystsStatus = weighted.select(CYSTS_CONFIG.statusOptions)

  // Additional details (75% of the time, but only if status is not "No")
  if (item.cystsStatus !== 'No' && Math.random() < 0.75)
  {
    if (item.cystsStatus === 'Yes, not treated')
    {
      item.additionalDetails = faker.helpers.arrayElement([
        'Simple cysts identified on ultrasound',
        'Multiple small cysts present',
        'Monitored regularly, no treatment required',
        'Benign cysts confirmed'
      ])
    }
    else if (item.cystsStatus === 'Yes, drained or removed')
    {
      item.additionalDetails = faker.helpers.arrayElement([
        'Aspirated in clinic, fluid drained successfully',
        'Drained ' + faker.number.int({ min: 6, max: 36 }) + ' months ago',
        'Recurrent cyst, drained multiple times',
        'Large cyst removed surgically'
      ])
    }
  }

  return item
}

/**
 * Generate a single benign lumps history item
 * @param {object} [options] - Generation options
 * @param {string} [options.addedByUserId] - User who added this information
 * @returns {object} Generated benign lumps item
 */
const generateBenignLumpsItem = (options = {}) =>
{
  const { addedByUserId } = options

  const item = {
    id: generateId(),
    dateAdded: new Date().toISOString(),
    addedBy: addedByUserId || null
  }

  // Which breast(s) had procedures
  const breastChoice = weighted.select(BENIGN_LUMPS_CONFIG.breastChoice)

  if (breastChoice === 'right-only')
  {
    // Always have procedures on right breast if this is right-only
    const numberOfOptions = weighted.select({ 1: 0.7, 2: 0.3 })
    item.proceduresRightBreast = faker.helpers.arrayElements(
      BENIGN_LUMPS_CONFIG.procedureOptions,
      numberOfOptions
    )
    item.proceduresLeftBreast = ['No procedures']
  }
  else if (breastChoice === 'left-only')
  {
    // Always have procedures on left breast if this is left-only
    const numberOfOptions = weighted.select({ 1: 0.7, 2: 0.3 })
    item.proceduresLeftBreast = faker.helpers.arrayElements(
      BENIGN_LUMPS_CONFIG.procedureOptions,
      numberOfOptions
    )
    item.proceduresRightBreast = ['No procedures']
  }
  else // both
  {
    // At least one breast must have actual procedures
    // 80% chance of having procedures on right
    const rightHasProcedures = Math.random() < 0.8
    // 80% chance of having procedures on left
    const leftHasProcedures = Math.random() < 0.8

    // If both randomly became 'No procedures', force at least one to have procedures
    if (!rightHasProcedures && !leftHasProcedures)
    {
      // Randomly pick which breast will have procedures
      if (Math.random() < 0.5)
      {
        const numberOfOptions = weighted.select({ 1: 0.7, 2: 0.3 })
        item.proceduresRightBreast = faker.helpers.arrayElements(
          BENIGN_LUMPS_CONFIG.procedureOptions,
          numberOfOptions
        )
        item.proceduresLeftBreast = ['No procedures']
      }
      else
      {
        const numberOfOptions = weighted.select({ 1: 0.7, 2: 0.3 })
        item.proceduresLeftBreast = faker.helpers.arrayElements(
          BENIGN_LUMPS_CONFIG.procedureOptions,
          numberOfOptions
        )
        item.proceduresRightBreast = ['No procedures']
      }
    }
    else
    {
      // Generate normally based on the random checks
      if (rightHasProcedures)
      {
        const numberOfOptions = weighted.select({ 1: 0.7, 2: 0.3 })
        item.proceduresRightBreast = faker.helpers.arrayElements(
          BENIGN_LUMPS_CONFIG.procedureOptions,
          numberOfOptions
        )
      }
      else
      {
        item.proceduresRightBreast = ['No procedures']
      }

      if (leftHasProcedures)
      {
        const numberOfOptions = weighted.select({ 1: 0.7, 2: 0.3 })
        item.proceduresLeftBreast = faker.helpers.arrayElements(
          BENIGN_LUMPS_CONFIG.procedureOptions,
          numberOfOptions
        )
      }
      else
      {
        item.proceduresLeftBreast = ['No procedures']
      }
    }
  }

  // Year (80% of the time)
  if (Math.random() < 0.8)
  {
    item.year = faker.number.int({ min: 2015, max: 2024 }).toString()
  }

  // Location (70% of the time)
  if (Math.random() < 0.7)
  {
    const locationChoice = weighted.select({
      'At an NHS hospital': 0.7,
      'At a private clinic in the UK': 0.2,
      'Outside the UK': 0.05,
      'Exact location unknown': 0.05
    })

    item.location = locationChoice

    // Add conditional details for certain locations
    if (locationChoice === 'At an NHS hospital')
    {
      item.locationNhsHospitalDetails = faker.helpers.arrayElement([
        'Local NHS hospital',
        'District general hospital',
        'Teaching hospital'
      ])
    }
    else if (locationChoice === 'At a private clinic in the UK')
    {
      item.locationPrivateClinicDetails = faker.helpers.arrayElement([
        'Private diagnostic clinic',
        'Independent hospital'
      ])
    }
    else if (locationChoice === 'Outside the UK')
    {
      item.locationOutsideUkDetails = faker.helpers.arrayElement([
        'France',
        'Spain',
        'Australia'
      ])
    }
  }

  // Additional details (75% of the time)
  if (Math.random() < 0.75)
  {
    item.additionalDetails = faker.helpers.arrayElement([
      'Confirmed as fibroadenoma',
      'Biopsy results were benign',
      'No further treatment needed',
      'Regular monitoring recommended'
    ])
  }

  return item
}

/**
 * Generate a single other procedures history item
 * @param {object} [options] - Generation options
 * @param {string} [options.addedByUserId] - User who added this information
 * @returns {object} Generated other procedures item
 */
const generateOtherProceduresItem = (options = {}) =>
{
  const { addedByUserId } = options

  const item = {
    id: generateId(),
    dateAdded: new Date().toISOString(),
    addedBy: addedByUserId || null
  }

  // Procedure type
  item.type = weighted.select(OTHER_PROCEDURES_CONFIG.procedureTypes)

  // Add conditional details based on type
  if (item.type === 'Breast reduction')
  {
    item.breastReductionDetails = faker.helpers.arrayElement([
      'Bilateral breast reduction',
      'Reduction due to back pain',
      'Cosmetic breast reduction'
    ])
  }
  else if (item.type === 'Breast symmetrisation')
  {
    item.breastSymmetrisationDetails = faker.helpers.arrayElement([
      'Following unilateral surgery',
      'To correct asymmetry',
      'Bilateral symmetrisation'
    ])
  }
  else if (item.type === 'Nipple correction')
  {
    item.nippleCorrectionDetails = faker.helpers.arrayElement([
      'Inverted nipple correction',
      'Nipple reconstruction',
      'Cosmetic nipple surgery'
    ])
  }
  else if (item.type === 'Other')
  {
    item.typeOtherDetails = faker.helpers.arrayElement([
      'Breast lift surgery',
      'Scar revision',
      'Tissue expansion'
    ])
  }

  // Year (80% of the time)
  if (Math.random() < 0.8)
  {
    item.year = faker.number.int({ min: 2015, max: 2024 }).toString()
  }

  // Additional details (75% of the time)
  if (Math.random() < 0.75)
  {
    item.additionalDetails = faker.helpers.arrayElement([
      'Procedure completed successfully',
      'No complications reported',
      'Regular follow-up in place'
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

  if (forceMedicalHistoryTypes.includes('mastectomyLumpectomy'))
  {
    const numberOfItems = weighted.select({
      1: 0.85,
      2: 0.15
    })
    history.mastectomyLumpectomy = Array.from({ length: numberOfItems }, () =>
      generateMastectomyLumpectomyItem({ addedByUserId })
    )
  }

  if (forceMedicalHistoryTypes.includes('cysts'))
  {
    // Cysts can only have one entry (single entry only)
    history.cysts = [generateCystsItem({ addedByUserId })]
  }

  if (forceMedicalHistoryTypes.includes('benignLumps'))
  {
    const numberOfItems = weighted.select({
      1: 0.85,
      2: 0.15
    })
    history.benignLumps = Array.from({ length: numberOfItems }, () =>
      generateBenignLumpsItem({ addedByUserId })
    )
  }

  if (forceMedicalHistoryTypes.includes('otherProcedures'))
  {
    const numberOfItems = weighted.select({
      1: 0.85,
      2: 0.15
    })
    history.otherProcedures = Array.from({ length: numberOfItems }, () =>
      generateOtherProceduresItem({ addedByUserId })
    )
  }

  // If we have forced types, skip probability check - we already have history
  if (forceMedicalHistoryTypes.length === 0)
  {
    // Check if they have any medical history (normal random generation)
    if (Math.random() > probability)
    {
      return {}
    }

    // They have medical history - decide how many types (1-4, weighted towards 1-2)
    const numberOfTypes = weighted.select({
      1: 0.5,   // 50% have just 1 type
      2: 0.3,   // 30% have 2 types
      3: 0.15,  // 15% have 3 types
      4: 0.05   // 5% have 4 types
    })

    // Weights for each type (more common conditions have higher weights)
    const typeWeights = {
      cysts: 0.25,                        // Most common
      benignLumps: 0.20,                  // Common
      mastectomyLumpectomy: 0.15,         // Fairly common
      implantedMedicalDevice: 0.15,       // Fairly common
      breastCancer: 0.10,                 // Less common
      otherProcedures: 0.10,              // Less common
      breastImplantsAugmentation: 0.05    // Least common
    }

    // Select types randomly based on weights, ensuring no duplicates
    const availableTypes = Object.keys(typeWeights)
    const selectedTypes = []

    while (selectedTypes.length < numberOfTypes && availableTypes.length > 0)
    {
      // Build weights object for remaining types
      const remainingWeights = {}
      availableTypes.forEach(type =>
      {
        remainingWeights[type] = typeWeights[type]
      })

      // Select a type
      const selectedType = weighted.select(remainingWeights)
      selectedTypes.push(selectedType)

      // Remove from available types
      const index = availableTypes.indexOf(selectedType)
      availableTypes.splice(index, 1)
    }

    // Generate items for each selected type
    selectedTypes.forEach(type =>
    {
      if (type === 'breastCancer')
      {
        const numberOfItems = weighted.select({
          1: 0.85,
          2: 0.15
        })
        history.breastCancer = Array.from({ length: numberOfItems }, () =>
          generateBreastCancerItem({ addedByUserId })
        )
      }
      else if (type === 'implantedMedicalDevice')
      {
        const numberOfItems = weighted.select({
          1: 0.85,
          2: 0.15
        })
        history.implantedMedicalDevice = Array.from({ length: numberOfItems }, () =>
          generateImplantedDeviceItem({ addedByUserId })
        )
      }
      else if (type === 'breastImplantsAugmentation')
      {
        // Breast implants can only have one entry (single entry only)
        history.breastImplantsAugmentation = [generateBreastImplantsItem({ addedByUserId })]
      }
      else if (type === 'mastectomyLumpectomy')
      {
        const numberOfItems = weighted.select({
          1: 0.85,
          2: 0.15
        })
        history.mastectomyLumpectomy = Array.from({ length: numberOfItems }, () =>
          generateMastectomyLumpectomyItem({ addedByUserId })
        )
      }
      else if (type === 'cysts')
      {
        // Cysts can only have one entry (single entry only)
        history.cysts = [generateCystsItem({ addedByUserId })]
      }
      else if (type === 'benignLumps')
      {
        const numberOfItems = weighted.select({
          1: 0.85,
          2: 0.15
        })
        history.benignLumps = Array.from({ length: numberOfItems }, () =>
          generateBenignLumpsItem({ addedByUserId })
        )
      }
      else if (type === 'otherProcedures')
      {
        const numberOfItems = weighted.select({
          1: 0.85,
          2: 0.15
        })
        history.otherProcedures = Array.from({ length: numberOfItems }, () =>
          generateOtherProceduresItem({ addedByUserId })
        )
      }
    })
  }

  return history
}

module.exports = {
  generateMedicalHistory,
  generateBreastCancerItem,
  generateImplantedDeviceItem,
  generateBreastImplantsItem,
  generateMastectomyLumpectomyItem,
  generateCystsItem,
  generateBenignLumpsItem,
  generateOtherProceduresItem
}
