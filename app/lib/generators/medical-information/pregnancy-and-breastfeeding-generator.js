// app/lib/generators/medical-information/pregnancy-and-breastfeeding-generator.js

const { faker } = require('@faker-js/faker')
const weighted = require('weighted')
const dayjs = require('dayjs')

// Generate a past date in 'MMMM YYYY' format
const randomPastDate = (minMonthsAgo, maxMonthsAgo) => {
  const monthsAgo = faker.number.int({ min: minMonthsAgo, max: maxMonthsAgo })
  return dayjs().subtract(monthsAgo, 'month').format('MMMM YYYY')
}

// Generate a future date in 'MMMM YYYY' format
const randomFutureDate = (minMonthsAhead, maxMonthsAhead) => {
  const monthsAhead = faker.number.int({ min: minMonthsAhead, max: maxMonthsAhead })
  return dayjs().add(monthsAhead, 'month').format('MMMM YYYY')
}

/**
 * Generate pregnancy and breastfeeding information
 *
 * @param {object} [options] - Generation options
 * @param {number} [options.probability] - Chance of having pregnancy/breastfeeding data (0-1)
 * @returns {object|null} Pregnancy and breastfeeding object or null
 */
const generatePregnancyAndBreastfeeding = (options = {}) => {
  const { probability } = options

  // Check if they have any pregnancy/breastfeeding information
  if (Math.random() > probability) {
    return null
  }

  const info = {}

  // Weighted selection of pregnancy status
  info.pregnancyStatus = weighted.select({
    'noNotPregnant': 0.7,      // Most common - not pregnant
    'noButRecently': 0.2,      // Recently gave birth
    'yes': 0.1                 // Currently pregnant
  })

  // Add conditional fields based on pregnancy status
  if (info.pregnancyStatus === 'yes') {
    // Due date 1-9 months in future
    info.pregnancyDueDate = randomFutureDate(1, 9)
  }
  else if (info.pregnancyStatus === 'noButRecently') {
    // Pregnancy ended 1-5 months ago
    info.pregnancyEndDate = randomPastDate(1, 5)
  }

  // Weighted selection of breastfeeding status
  // If recently pregnant, more likely to be breastfeeding
  if (info.pregnancyStatus === 'noButRecently') {
    info.breastfeedingStatus = weighted.select({
      'yes': 0.6,               // Likely breastfeeding if recently gave birth
      'recentlyStopped': 0.2,
      'no': 0.2
    })
  } else if (info.pregnancyStatus === 'yes') {
    // If pregnant, not breastfeeding
    info.breastfeedingStatus = 'no'
  } else {
    info.breastfeedingStatus = weighted.select({
      'no': 0.8,                // Most common
      'yes': 0.1,               // Currently breastfeeding
      'recentlyStopped': 0.1    // Recently stopped
    })
  }

  // Add conditional fields based on breastfeeding status
  if (info.breastfeedingStatus === 'yes') {
    // Started breastfeeding 2 weeks to 18 months ago
    info.breastfeedingStartDate = randomPastDate(0, 18)
  }
  else if (info.breastfeedingStatus === 'recentlyStopped') {
    // Stopped breastfeeding 1-4 months ago
    info.breastfeedingStopDate = randomPastDate(1, 4)
  }

  return info
}

module.exports = {
  generatePregnancyAndBreastfeeding
}
