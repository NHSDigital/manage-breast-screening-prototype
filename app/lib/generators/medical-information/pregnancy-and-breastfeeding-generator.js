// app/lib/generators/medical-information/pregnancy-and-breastfeeding-generator.js

const { faker } = require('@faker-js/faker')
const weighted = require('weighted')

// Example pregnancy details
const PREGNANCY_DETAILS = [
  'due in November',
  'due in December',
  'due in January',
  'due next month',
  '8 weeks pregnant',
  '12 weeks pregnant',
  '20 weeks pregnant',
  '30 weeks pregnant'
]

// Example recent pregnancy details
const RECENT_PREGNANCY_DETAILS = [
  'gave birth two weeks ago',
  'gave birth one month ago',
  'gave birth six weeks ago',
  'gave birth two months ago',
  'gave birth three months ago'
]

// Example breastfeeding durations
const BREASTFEEDING_DURATIONS = [
  'since January',
  'since March',
  'for 2 weeks',
  'for 6 weeks',
  'for 3 months',
  'for 6 months',
  'for 1 year'
]

// Example recent breastfeeding stopped
const RECENTLY_STOPPED_BREASTFEEDING = [
  'two weeks ago',
  'one month ago',
  'two months ago',
  'three months ago',
  'stopped last week'
]

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
    info.currentlyPregnantDetails = faker.helpers.arrayElement(PREGNANCY_DETAILS)
  }
  else if (info.pregnancyStatus === 'noButRecently') {
    info.recentlyPregnantDetails = faker.helpers.arrayElement(RECENT_PREGNANCY_DETAILS)
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
    info.currentlyBreastfeedingDuration = faker.helpers.arrayElement(BREASTFEEDING_DURATIONS)
  }
  else if (info.breastfeedingStatus === 'recentlyStopped') {
    info.recentlyBreastfeedingDuration = faker.helpers.arrayElement(RECENTLY_STOPPED_BREASTFEEDING)
  }

  return info
}

module.exports = {
  generatePregnancyAndBreastfeeding
}
