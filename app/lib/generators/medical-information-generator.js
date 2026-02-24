// app/lib/generators/medical-information-generator.js

const { generateSymptoms } = require('./medical-information/symptoms-generator')
const { generateHRT } = require('./medical-information/hrt-generator')
const {
  generatePregnancyAndBreastfeeding
} = require('./medical-information/pregnancy-and-breastfeeding-generator')
const {
  generateOtherMedicalInformation
} = require('./medical-information/other-medical-information-generator')
const {
  generateBreastFeatures
} = require('./medical-information/breast-features-generator')
const {
  generateMedicalHistory
} = require('./medical-information/medical-history-generator')

/**
 * Generate complete medical information for an event
 *
 * All medical information is attributed to the user who ran the appointment
 *
 * @param {object} options - Generation options
 * @param {string} [options.addedByUserId] - User ID who collected this information (typically from sessionDetails.startedBy)
 * @param {number} [options.probabilityOfSymptoms=0.15] - Chance of having symptoms
 * @param {number} [options.probabilityOfHRT=0.30] - Chance of having HRT data
 * @param {number} [options.probabilityOfPregnancyBreastfeeding=0.05] - Chance of having pregnancy/breastfeeding data
 * @param {number} [options.probabilityOfOtherMedicalInfo=0.20] - Chance of having other medical information
 * @param {number} [options.probabilityOfBreastFeatures=0.15] - Chance of having breast features
 * @param {number} [options.probabilityOfMultipleBreastFeatures=0.30] - If breast features exist, chance of multiple markers
 * @param {number} [options.probabilityOfMedicalHistory=0.50] - Chance of having medical history
 * @param {Array} [options.forceMedicalHistoryTypes] - Array of medical history types to force generation (e.g. ['breastCancer', 'cysts'])
 * @param {object} [options.config] - Participant config for overrides and forced generation
 * @returns {object} Complete medicalInformation object
 */
const generateMedicalInformation = (options = {}) => {
  const {
    addedByUserId,
    probabilityOfSymptoms = 0.15,
    probabilityOfHRT = 0.3,
    probabilityOfPregnancyBreastfeeding = 0.05,
    probabilityOfOtherMedicalInfo = 0.2,
    probabilityOfBreastFeatures = 0.15,
    probabilityOfMultipleBreastFeatures = 0.3,
    probabilityOfMedicalHistory = 0.5,
    forceMedicalHistoryTypes,
    config
  } = options

  const medicalInfo = {}

  // Generate symptoms
  const symptoms = generateSymptoms({
    probabilityOfSymptoms,
    addedByUserId
  })

  if (symptoms.length > 0) {
    medicalInfo.symptoms = symptoms
  }

  // Generate HRT information
  const hrt = generateHRT({
    probability: probabilityOfHRT
  })

  if (hrt) {
    medicalInfo.hrt = hrt
  }

  // Generate pregnancy and breastfeeding information
  const pregnancyAndBreastfeeding = generatePregnancyAndBreastfeeding({
    probability: probabilityOfPregnancyBreastfeeding
  })

  if (pregnancyAndBreastfeeding) {
    medicalInfo.pregnancyAndBreastfeeding = pregnancyAndBreastfeeding
  }

  // Generate other medical information
  const otherMedicalInformation = generateOtherMedicalInformation({
    probability: probabilityOfOtherMedicalInfo
  })

  if (otherMedicalInformation) {
    medicalInfo.otherMedicalInformation = otherMedicalInformation
  }

  // Generate medical history
  const medicalHistory = generateMedicalHistory({
    addedByUserId,
    probability: probabilityOfMedicalHistory,
    forceMedicalHistoryTypes,
    config
  })

  if (Object.keys(medicalHistory).length > 0) {
    medicalInfo.medicalHistory = medicalHistory
  }

  // Generate breast features
  const breastFeatures = generateBreastFeatures({
    probabilityOfAnyFeatures: probabilityOfBreastFeatures,
    probabilityOfMultipleFeatures: probabilityOfMultipleBreastFeatures,
    config
  })

  if (breastFeatures && breastFeatures.length > 0) {
    medicalInfo.breastFeatures = breastFeatures
  }

  return medicalInfo
}

module.exports = {
  generateMedicalInformation
}
