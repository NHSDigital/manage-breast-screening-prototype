// app/lib/generators/appointment-note-generator.js

const { faker } = require('@faker-js/faker')
const weighted = require('weighted')

// Categories of appointment notes with realistic examples
const NOTE_CATEGORIES = {
  medical: {
    weight: 0.35,
    notes: [
      'Pain in left breast, GP thinks it\'s blocked ducts and has given antibiotics',
      'Recent diagnosis, unable to tolerate more compression',
      'On blood thinners',
      'Lump removal left breast',
      'Reduction surgery - nothing on pictogram',
      'Surgery 2010',
      'Aching on left side',
      'Shoulder pain',
      'Patient feels left breast visibly bigger than right, feels pain sometimes',
      'General tenderness',
      'Recent CT scan',
      'On Manjaro since mid January 2025, lost 4 stone',
      'Lost 5 stone',
      'Diabetes type 2',
      'Kyphotic posture',
      'Twisted back, in a lot of pain'
    ]
  },
  
  familyHistory: {
    weight: 0.12,
    notes: [
      'Family history of breast cancer (both sisters)',
      'Maternal cousin breast cancer at 46 years',
      'Sister breast cancer at 50 years',
      'Family history: grandma at 40 years old (printed)',
    ]
  },
  
  procedural: {
    weight: 0.25,
    notes: [
      'Very nervous',
      'Struggled with compression',
      'Unable to tolerate full compression',
      'Difficulty with compression, consent given to complete',
      'Difficult, kept moving, pulled out of machine, compression sensitive',
      'No priors available',
      'Noticed artefact from detector',
      'No 16x24 paddles available',
      'Left side implant (cosmetic)',
      'Pain with mammogram and implants'
    ]
  },
  
  mobility: {
    weight: 0.08,
    notes: [
      'Difficulty with steps, uses zimmer frame - BCU appointments',
      'Static appointment please, 2 radiographers, double appointment time'
    ]
  },
  
  communication: {
    weight: 0.1,
    notes: [
      'No English spoken, very basic English',
      'No English, speaks Hindi',
      'No English, speaks Punjabi',
      'Learning difficulties, refused to come into the room'
    ]
  },
  
  personal: {
    weight: 0.1,
    notes: [
      'Husband has stage 4 cancer, feeling sad',
      'Going on holiday next week, may be difficult to contact',
      'Away for 3 weeks from next Monday, use mobile number only',
      'Prefers appointment letters sent to work address',
      'Recently bereaved, may need extra support',
      'Caring for elderly parent, limited availability for follow-up'
    ]
  }
}

/**
 * Generate an appointment note for an event
 * 
 * @param {object} options - Generation options
 * @param {boolean} options.isScheduled - Whether the event is scheduled (not yet happened)
 * @param {boolean} options.isCompleted - Whether the event is completed
 * @returns {string | null} Appointment note or null if no note should be generated
 */
const generateAppointmentNote = (options = {}) => {
  const { isScheduled = false, isCompleted = false } = options
  
  // Determine probability based on event status
  let probability = 0
  if (isScheduled) {
    probability = 0.2 // 5% of scheduled events have notes
  } else if (isCompleted) {
    probability = 0.2 // 10% of completed events have notes
  }
  
  // Check if this event should have a note
  if (Math.random() > probability) {
    return null
  }
  
  // Build weights object for category selection
  const categoryWeights = {}
  Object.entries(NOTE_CATEGORIES).forEach(([categoryName, config]) => {
    categoryWeights[categoryName] = config.weight
  })
  
  // Select a category
  const selectedCategory = weighted.select(categoryWeights)
  const categoryConfig = NOTE_CATEGORIES[selectedCategory]
  
  // Select a random note from that category
  const note = faker.helpers.arrayElement(categoryConfig.notes)
  
  return note
}

module.exports = {
  generateAppointmentNote,
  // Export for testing
  NOTE_CATEGORIES
}