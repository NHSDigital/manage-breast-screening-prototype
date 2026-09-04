// app/lib/generators/medical-information/breast-density-factors-generator.js

/**
 * Generate breast density factors
 *
 * Replaces the old separate HRT and pregnancy/breastfeeding generators. The
 * question is now a simple yes/no for HRT plus a checkbox group for pregnancy
 * and breastfeeding, so the generated data is just as simple.
 *
 * Pregnancy and breastfeeding are rare in the screening cohort (routine
 * screening starts at 50), so they stay well below the HRT rate.
 *
 * @param {object} [options] - Generation options
 * @param {number} [options.probabilityOfHrt] - Chance of currently taking HRT (0-1)
 * @param {number} [options.probabilityOfPregnancyBreastfeeding] - Chance of being pregnant or breastfeeding (0-1)
 * @param {number} [options.probabilityOfBeingAsked=0.8] - Chance the question was asked at all
 * @returns {object} Object with hrt and pregnancyAndBreastfeeding, either may be absent
 */
const generateBreastDensityFactors = (options = {}) => {
  const {
    probabilityOfHrt = 0.3,
    probabilityOfPregnancyBreastfeeding = 0.05,
    probabilityOfBeingAsked = 0.8
  } = options

  const result = {}

  // Not every appointment has got as far as asking. Leaving the answer unset
  // keeps "no medical information" a possible outcome, and lets the summaries
  // distinguish "not answered" from a recorded "no"
  if (Math.random() < probabilityOfBeingAsked) {
    const isTakingHrt = Math.random() < probabilityOfHrt
    const currentYear = new Date().getFullYear()

    result.hrt = {
      status: isTakingHrt ? 'yes' : 'no'
    }

    // Years are strings because that's what the form fields post back
    if (isTakingHrt) {
      result.hrt.yearStarted = String(currentYear - Math.floor(Math.random() * 10))
    }
  }

  const factors = []

  if (Math.random() < probabilityOfPregnancyBreastfeeding) {
    // Breastfeeding is the more likely of the two at screening age
    if (Math.random() < 0.7) {
      factors.push('currently-breastfeeding')
    } else {
      factors.push('currently-pregnant')
    }
  }

  if (factors.length > 0) {
    result.pregnancyAndBreastfeeding = factors
  }

  return result
}

module.exports = {
  generateBreastDensityFactors
}
