// app/lib/generators/medical-information/hrt-generator.js

const { faker } = require('@faker-js/faker')
const weighted = require('weighted')

// Example durations for current HRT use
const CURRENT_HRT_DURATIONS = [
  '6 months',
  '18 months',
  '2 years',
  '3 years',
  '5 years',
  '7 years',
  '10 years'
]

// Example timeframes for when stopped
const STOPPED_TIMEFRAMES = [
  'two weeks ago',
  'one month ago',
  'six weeks ago',
  'three months ago',
  'four months ago'
]

// Example durations before stopping
const DURATION_BEFORE_STOPPING = [
  '6 months',
  '1 year',
  '2 years',
  '3 years',
  '5 years',
  '8 years'
]

/**
 * Generate HRT information
 *
 * @param {object} [options] - Generation options
 * @param {number} [options.probability] - Chance of having HRT data (0-1)
 * @returns {object|null} HRT object or null if no HRT data
 */
const generateHRT = (options = {}) => {
  const { probability } = options

  // Check if they have any HRT information
  if (Math.random() > probability) {
    return null
  }

  // Weighted selection of HRT status
  const hrtQuestion = weighted.select({
    'yes': 0.5,                    // Currently taking
    'no-recently-stopped': 0.3,    // Recently stopped
    'no': 0.2                      // No HRT
  })

  const hrt = { hrtQuestion }

  // Add conditional fields based on status
  if (hrtQuestion === 'yes') {
    hrt.hrtDuration = faker.helpers.arrayElement(CURRENT_HRT_DURATIONS)
  }
  else if (hrtQuestion === 'no-recently-stopped') {
    hrt.hrtDurationSinceStopped = faker.helpers.arrayElement(STOPPED_TIMEFRAMES)
    hrt.hrtDurationBeforeStopping = faker.helpers.arrayElement(DURATION_BEFORE_STOPPING)
  }

  return hrt
}

module.exports = {
  generateHRT
}
