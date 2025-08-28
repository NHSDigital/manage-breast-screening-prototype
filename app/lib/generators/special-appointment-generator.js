// app/lib/generators/special-appointment-generator.js

const { faker } = require('@faker-js/faker')
const weighted = require('weighted')

// Support types and their realistic detail descriptions
const SUPPORT_TYPES = {
  'Physical restriction': {
    weight: 0.3,
    descriptions: [
      'Uses wheelchair, needs accessible positioning and additional time for transfers',
      'Limited mobility in right arm due to previous stroke, requires assistance with positioning',
      'Uses walking frame, needs extra time and support to position safely',
      'Severe arthritis in shoulders, requires gentle positioning and frequent breaks',
      'Recent hip replacement, needs assistance getting on and off equipment',
      'Limited range of motion in left arm, may need modified positioning',
      'Uses mobility scooter, needs wheelchair transfer for appointment',
      'Chronic back pain, requires frequent position changes and extra support'
    ]
  },
  'Vision': {
    weight: 0.15,
    descriptions: [
      'Registered blind, needs verbal guidance throughout procedure',
      'Severe visual impairment, requires clear verbal instructions and physical guidance',
      'Recently lost sight in left eye, needs extra orientation time',
      'Uses guide dog, needs space for dog during appointment',
      'Partial sight, benefits from good lighting and verbal description of each step',
      'Legally blind but has some light perception, needs detailed explanation of positioning',
      'Diabetic retinopathy causing severe vision loss, requires careful guidance'
    ]
  },
  'Hearing': {
    weight: 0.2,
    descriptions: [
      'Profoundly deaf, communicates through BSL interpreter',
      'Severe hearing loss, uses hearing aids but needs clear lip reading view',
      'Deaf in right ear, position team on left side for communication',
      'Uses cochlear implant, may need visual cues and written instructions',
      'Hard of hearing, speaks loudly and needs staff to face them when speaking',
      'Recently lost hearing, still adjusting and may need extra patience',
      'Partial hearing loss, benefits from clear, slow speech and good lighting'
    ]
  },
  'Social, emotional, and mental health': {
    weight: 0.25,
    descriptions: [
      'Severe anxiety about medical procedures, needs extra time and reassurance',
      'Autism spectrum condition, requires consistent routine and clear expectations',
      'PTSD related to previous medical trauma, may need breaks during procedure',
      'Agoraphobia, very anxious in medical settings and with physical contact',
      'Learning disability, needs simple language and extra time to process information',
      'Depression and anxiety, may need emotional support and encouragement',
      'OCD, has specific concerns about cleanliness and needs reassurance about hygiene',
      'Bipolar disorder, currently stable but needs calm, consistent approach'
    ]
  },
  'Language': {
    weight: 0.08,
    descriptions: [
      'Speaks limited English, Arabic interpreter arranged for appointment',
      'Polish is first language, may need translator for complex instructions',
      'Deaf and uses BSL as primary language, interpreter essential',
      'Recently arrived refugee, very limited English and high anxiety',
      'Speaks fluent English but prefers Urdu for medical discussions',
      'Turkish speaker, family member will interpret if professional interpreter unavailable'
    ]
  },
  'Breast implants': {
    weight: 0.12,
    descriptions: [
      'Silicone implants fitted 5 years ago, may require additional views or ultrasound',
      'Recent breast reconstruction following mastectomy, requires gentle handling',
      'Cosmetic breast implants, aware procedure may be more uncomfortable',
      'Implants following cancer treatment, ongoing monitoring required',
      'Older saline implants, concerned about potential rupture during compression'
    ]
  },
  'Implanted medical devices': {
    weight: 0.05,
    descriptions: [
      'Pacemaker fitted, requires careful positioning to avoid interference',
      'Insulin pump, needs to remain attached during procedure',
      'Cochlear implant, may need to remove external processor',
      'Deep brain stimulator for Parkinsons, positioning may need adjustment',
      'Port-a-cath in chest, needs to work around insertion site'
    ]
  },
  'Gender identity': {
    weight: 0.03,
    descriptions: [
      'Trans man, may experience dysphoria during chest examination',
      'Non-binary person, prefers gender-neutral language and approach',
      'Trans woman, anxious about chest examination and needs sensitivity',
      'Gender questioning, prefers female pronouns during appointment'
    ]
  },
  'Other': {
    weight: 0.02,
    descriptions: [
      'Severe claustrophobia, needs door to remain open and frequent breaks',
      'Multiple chemical sensitivity, requires scent-free environment',
      'Chronic fatigue syndrome, may need extended appointment time',
      'Fibromyalgia causing widespread pain, needs very gentle handling'
    ]
  }
}

/**
 * Generate special appointment requirements for an event
 *
 * @param {object} [options] - Generation options
 * @param {number} [options.probability] - Probability of needing special appointment
 * @param {number} [options.maxSupportTypes] - Maximum number of support types to select
 * @returns {object | null} Special appointment object or null if not needed
 */
const generateSpecialAppointment = (options = {}) => {
  const { probability = 0.08, maxSupportTypes = 3 } = options

  // Check if they need special appointment support
  if (Math.random() > probability) {
    return null
  }

  // Create weights object for weighted selection
  const typeWeights = {}
  Object.entries(SUPPORT_TYPES).forEach(([typeName, config]) => {
    typeWeights[typeName] = config.weight
  })

  // Determine how many support types (weighted towards fewer)
  const numberOfTypes = weighted.select({
    1: 0.7,
    2: 0.25,
    3: 0.05
  })

  const selectedTypes = []
  const usedTypes = new Set()
  const availableTypes = Object.keys(SUPPORT_TYPES)

  // Select unique support types
  while (
    selectedTypes.length < numberOfTypes &&
    selectedTypes.length < maxSupportTypes
  ) {
    // Create weights for remaining types
    const remainingWeights = {}
    availableTypes.forEach((typeName) => {
      if (!usedTypes.has(typeName)) {
        remainingWeights[typeName] = typeWeights[typeName]
      }
    })

    // If no types remaining, break
    if (Object.keys(remainingWeights).length === 0) break

    const selectedType = weighted.select(remainingWeights)
    selectedTypes.push(selectedType)
    usedTypes.add(selectedType)
  }

  // Build the special appointment object
  const specialAppointment = {
    supportTypes: selectedTypes
  }

  // Add detail descriptions for each selected type
  selectedTypes.forEach((type) => {
    const typeConfig = SUPPORT_TYPES[type]
    const description = faker.helpers.arrayElement(typeConfig.descriptions)

    // Convert type name to camelCase field name
    const fieldName = convertToFieldName(type)
    specialAppointment[fieldName] = description
  })

  // Determine if any reasons are temporary (30% chance)
  if (Math.random() < 0.3) {
    specialAppointment.temporaryReasons = 'yes'

    // Select which types are temporary (usually just one)
    const temporaryCount = Math.min(1, selectedTypes.length)
    specialAppointment.temporaryReasonsList = faker.helpers.arrayElements(
      selectedTypes,
      { min: temporaryCount, max: temporaryCount }
    )
  } else {
    specialAppointment.temporaryReasons = 'no'
  }

  return specialAppointment
}

/**
 * Convert support type name to camelCase field name for details
 *
 * @param {string} typeName - Support type name
 * @returns {string} CamelCase field name with 'Details' suffix
 */
const convertToFieldName = (typeName) => {
  const fieldMap = {
    'Physical restriction': 'physicalRestrictionDetails',
    'Vision': 'visionDetails',
    'Hearing': 'hearingDetails',
    'Social, emotional, and mental health':
      'socialEmotionalMentalHealthDetails',
    'Language': 'languageDetails',
    'Breast implants': 'implantDetails',
    'Implanted medical devices': 'implantedMedicalDevicesDetails',
    'Gender identity': 'genderIdentityDetails',
    'Other': 'otherDetails'
  }

  return fieldMap[typeName] || 'otherDetails'
}

module.exports = {
  generateSpecialAppointment,
  // Export for testing
  SUPPORT_TYPES
}
