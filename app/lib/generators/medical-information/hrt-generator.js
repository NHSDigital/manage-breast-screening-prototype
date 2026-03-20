// app/lib/generators/medical-information/hrt-generator.js

const { faker } = require('@faker-js/faker')
const weighted = require('weighted')
const dayjs = require('dayjs')

// Generate a past date in 'MMMM YYYY' format (e.g., 'September 2022')
const randomPastDate = (minMonthsAgo, maxMonthsAgo) => {
  const monthsAgo = faker.number.int({ min: minMonthsAgo, max: maxMonthsAgo })
  return dayjs().subtract(monthsAgo, 'month').format('MMMM YYYY')
}

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
    // Date HRT was started (6 months to 15 years ago)
    hrt.hrtDateStarted = randomPastDate(6, 180)
  }
  else if (hrtQuestion === 'no-recently-stopped') {
    // Date HRT was stopped (1-11 months ago)
    hrt.hrtDateStopped = randomPastDate(1, 11)
    hrt.hrtDurationBeforeStopping = faker.helpers.arrayElement(DURATION_BEFORE_STOPPING)
  }

  return hrt
}

module.exports = {
  generateHRT
}
