// app/lib/generators/symptoms-generator.js

const { faker } = require('@faker-js/faker')
const weighted = require('weighted')
const generateId = require('../utils/id-generator')

// Updated symptom types to match the form
const SYMPTOM_TYPES = {
  'Breast lump': {
    weight: 0.4,
    requiresLocation: true,
    descriptions: [
      'Hard lump that doesn\'t move',
      'Soft, moveable lump',
      'Small, pea-sized lump',
      'Several small lumps in the same area',
      'Tender lump that varies with menstrual cycle'
    ]
  },
  'Swelling or shape change': {
    weight: 0.2,
    requiresLocation: true,
    descriptions: [
      'Change in size or shape of breast',
      'Swelling that doesn\'t go down',
      'One breast has become larger',
      'Breast feels different to the other one',
      'Visible dent or dimpling'
    ]
  },
  'Nipple change': {
    weight: 0.15,
    requiresLocation: false, // Uses nippleChangeLocation instead
    nippleChangeTypes: [
      'discharge',
      'inversion or shape change',
      'rash',
      'colour change'
    ],
    nippleChangeDescriptions: {
      other: [
        'Cracking and soreness',
        'Scaling around the areola',
        'Unusual texture changes'
      ]
    }
  },
  'Skin change': {
    weight: 0.15,
    requiresLocation: true,
    skinChangeTypes: [
      'dimples or indentation',
      'rash',
      'colour change'
    ],
    skinChangeDescriptions: {
      other: [
        'Orange peel texture',
        'Unusual warmth in area',
        'Thickening of skin'
      ]
    }
  },
  'Other': {
    weight: 0.02,
    requiresLocation: true,
    descriptions: [
      'Unusual sensation or tenderness',
      'Heaviness in breast',
      'Tingling sensation',
      'Unusual firmness',
      'Persistent pain',
    ]
  }
}

const INVESTIGATION_DETAILS = [
  'GP examined and said to monitor for changes',
  'Discussed with practice nurse at last appointment',
  'Had ultrasound scan 2 weeks ago, waiting for results',
  'Doctor said it was normal but to come back if concerned',
  'Previously had mammogram which was clear',
  'GP did physical examination, referred for ultrasound',
  'Practice nurse checked at routine appointment',
  'Called 111, advised to see GP for assessment',
  'Saw GP yesterday, waiting for referral letter',
  'GP examined and said likely hormonal changes',
  'Breast clinic did examination last month, no concerns',
  'Hospital did scan, said to come back in 6 months',
  'Emergency GP examined, said not urgent but to monitor',
  'Consultant examined at last clinic visit',
  'Private clinic did mammogram, all normal',
  'GP prescribed antibiotics for possible infection',
  'Hospital breast clinic did biopsy, waiting for results',
  'Pharmacist recommended seeing GP, appointment next week',
  'Walk-in centre examined, advised follow up with GP',
  'GP took blood tests, coming back for results',
  'Hospital did ultrasound, said tissue changes normal',
  'Breast care nurse examined at screening unit',
  'GP wanted to monitor for three months then review',
  'Community clinic did examination, no immediate concerns',
  'Specialist examined, ordered further tests'
]

const APPROXIMATE_START_DATES = [
  '2 weeks ago',
  '1 month ago',
  '6 weeks ago',
  '3 months ago',
  'Last month',
  'Few weeks ago',
  'About 2 months ago',
  'Several weeks ago'
]

const APPROXIMATE_STOP_DATES = [
  '3 days ago',
  '1 week ago',
  'Few days ago',
  'Last week',
  '5 days ago'
]

const LOCATION_DESCRIPTIONS = {
  'right breast': [
    'Upper outer area',
    'Near the nipple',
    'Lower inner quadrant',
    'Along the outer edge',
    'Just below the nipple'
  ],
  'left breast': [
    'Upper outer area',
    'Near the nipple',
    'Lower inner quadrant',
    'Along the outer edge',
    'Just below the nipple'
  ],
  'both breasts': [
    'Similar areas on both sides',
    'Upper areas of both breasts',
    'Around both nipples',
    'Outer edges of both breasts'
  ],
  'other': [
    'Left armpit',
    'Right armpit',
    'Area between breasts',
    'Just above left breast'
  ]
}

/**
 * Generate a single symptom matching the new form format
 * @param {Object} options - Generation options
 * @param {string} [options.type] - Force specific symptom type
 * @param {boolean} [options.requireInvestigation] - Force investigation status
 * @param {string} [options.addedByUserId] - User ID who added the symptom
 * @returns {Object} Generated symptom
 */
const generateSymptom = (options = {}) => {
  // Pick symptom type if not specified
  const type = options.type || weighted.select(
    Object.fromEntries(
      Object.entries(SYMPTOM_TYPES).map(([key, data]) => [key, data.weight])
    )
  )

  const typeData = SYMPTOM_TYPES[type]

  // Generate basic symptom data matching form structure
  const symptom = {
    id: generateId(),
    type,
    dateType: weighted.select({
      'dateKnown': 0.3,
      'approximateDate': 0.6,
      'notSure': 0.1
    }),
    hasBeenInvestigated: options.requireInvestigation ?? (Math.random() < 0.3 ? 'yes' : 'no'),
    dateAdded: new Date().toISOString()
  }

  // Add user who added the symptom
  if (options.addedByUserId) {
    symptom.addedByUserId = options.addedByUserId
  }

  // Add investigation details if investigated
  if (symptom.hasBeenInvestigated === 'yes') {
    symptom.investigatedDescription = faker.helpers.arrayElement(INVESTIGATION_DETAILS)
  }

  // Handle dates based on dateType
  if (symptom.dateType === 'dateKnown') {
    const startDate = faker.date.past({ years: 1 })
    symptom.dateStarted = {
      month: startDate.getMonth() + 1,
      year: startDate.getFullYear()
    }
  } else if (symptom.dateType === 'approximateDate') {
    symptom.approximateDateStarted = faker.helpers.arrayElement(APPROXIMATE_START_DATES)
  }

  // 30% chance the symptom has recently stopped
  symptom.hasStopped = Math.random() < 0.3
  if (symptom.hasStopped) {
    symptom.approximateDateStopped = faker.helpers.arrayElement(APPROXIMATE_STOP_DATES)
  }

  // Handle type-specific fields
  if (type === 'Other') {
    symptom.otherDescription = faker.helpers.arrayElement(typeData.descriptions)
  } else if (type === 'Nipple change') {
    const changeType = faker.helpers.arrayElement(typeData.nippleChangeTypes)
    symptom.nippleChangeType = changeType

    if (changeType === 'other') {
      symptom.nippleChangeDescription = faker.helpers.arrayElement(typeData.nippleChangeDescriptions.other)
    }

    symptom.nippleChangeLocation = weighted.select({
      'right nipple': 0.4,
      'left nipple': 0.4,
      'both nipples': 0.2
    })
  } else if (type === 'Skin change') {
    const changeType = faker.helpers.arrayElement(typeData.skinChangeTypes)
    symptom.skinChangeType = changeType

    if (changeType === 'other') {
      symptom.skinChangeDescription = faker.helpers.arrayElement(typeData.skinChangeDescriptions.other)
    }
  }

  // Add location for symptoms that need it (not Nipple change)
  if (typeData.requiresLocation) {
    const location = weighted.select({
      'right breast': 0.4,
      'left breast': 0.4,
      'both breasts': 0.15,
      'other': 0.05
    })

    symptom.location = location

    // Add location-specific descriptions
    const locationDescriptions = LOCATION_DESCRIPTIONS[location]
    if (locationDescriptions) {
      const description = faker.helpers.arrayElement(locationDescriptions)

      if (location === 'right breast') {
        symptom.rightBreastDescription = description
      } else if (location === 'left breast') {
        symptom.leftBreastDescription = description
      } else if (location === 'both breasts') {
        symptom.bothBreastsDescription = description
      } else if (location === 'other') {
        symptom.otherLocationDescription = description
      }
    }
  }

  // 20% chance of additional info
  if (Math.random() < 0.2) {
    const additionalInfoOptions = [
      'Noticed during self-examination',
      'Partner noticed the change',
      'Gets worse during certain times of month',
      'No family history of breast problems',
      'Concerned as mother had similar symptoms'
    ]
    symptom.additionalInfo = faker.helpers.arrayElement(additionalInfoOptions)
  }

  return symptom
}

/**
 * Generate a set of symptoms for a person matching new medicalInformation structure
 * @param {Object} options - Generation options
 * @param {number} [options.probabilityOfSymptoms=0.15] - Chance of having any symptoms
 * @param {number} [options.maxSymptoms=3] - Maximum number of symptoms to generate
 * @param {Array} [options.users] - Array of users to pick from for addedByUserId
 * @returns {Array} Array of generated symptoms
 */
const generateSymptoms = (options = {}) => {
  const {
    probabilityOfSymptoms = 0.15,
    maxSymptoms = 3,
    users = []
  } = options

  // Determine if they have any symptoms
  if (Math.random() > probabilityOfSymptoms) {
    return []
  }

  // Determine how many symptoms (weighted towards fewer)
  const numberOfSymptoms = weighted.select({
    1: 0.8,
    2: 0.15,
    3: 0.05
  })

  // Pick a consistent user for all symptoms for this participant
  const addedByUserId = users.length > 0 ?
    faker.helpers.arrayElement(users).id : null

  // Track used types to avoid duplicates
  const usedTypes = new Set()
  const symptoms = []

  // Generate symptoms, avoiding duplicate types
  while (symptoms.length < numberOfSymptoms && symptoms.length < maxSymptoms) {
    // Filter to unused types
    const availableTypes = Object.keys(SYMPTOM_TYPES)
      .filter(type => !usedTypes.has(type))

    // Stop if no types left
    if (availableTypes.length === 0) break

    // Generate weights object from remaining types
    const weights = Object.fromEntries(
      availableTypes.map(type => [type, SYMPTOM_TYPES[type].weight])
    )

    // Pick a type and generate symptom
    const type = weighted.select(weights)
    const symptom = generateSymptom({
      type,
      addedByUserId
    })

    usedTypes.add(type)
    symptoms.push(symptom)
  }

  return symptoms
}

module.exports = {
  generateSymptom,
  generateSymptoms,
  // Export constants for testing/reference
  SYMPTOM_TYPES,
  INVESTIGATION_DETAILS
}