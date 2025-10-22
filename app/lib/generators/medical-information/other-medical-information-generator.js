// app/lib/generators/medical-information/other-medical-information-generator.js

const { faker } = require('@faker-js/faker')

// Example medical information snippets
const MEDICAL_INFORMATION_EXAMPLES = [
  'Takes warfarin for atrial fibrillation. Last INR check was two weeks ago.',
  'Type 2 diabetes managed with metformin. Recent HbA1c 52 mmol/mol.',
  'Undergoing treatment for hypothyroidism. Levothyroxine 100mcg daily.',
  'History of asthma. Uses salbutamol inhaler as needed.',
  'Takes amlodipine 5mg for hypertension. Blood pressure stable.',
  'Rheumatoid arthritis managed with methotrexate. Joints currently stable.',
  'Coeliac disease - strictly gluten-free diet.',
  'Takes sertraline 50mg for anxiety. Condition well controlled.',
  'Previous DVT in 2019. Currently on apixaban.',
  'Migraine with aura. Takes sumatriptan when needed.',
  'Pacemaker fitted in 2020 for complete heart block.',
  'Recent shoulder surgery 3 months ago. Full range of movement restored.',
  'Osteoporosis diagnosed last year. Started on alendronic acid.',
  'Epilepsy controlled on lamotrigine 200mg twice daily. Last seizure was 3 years ago.',
  'Chronic kidney disease stage 3a. eGFR stable at 52.',
  'Takes atorvastatin for high cholesterol. Last lipid profile normal.',
  'History of depression. Currently on citalopram 20mg.',
  'COPD managed with inhalers. No recent exacerbations.',
  'Irritable bowel syndrome. Symptoms managed with diet modification.',
  'Previous knee replacement left side in 2018. Fully mobile.',
  'Takes bisoprolol for heart failure. Last echo showed improved ejection fraction.',
  'Vitiligo on hands and arms. No active treatment required.',
  'Diverticular disease. Occasional flare-ups managed conservatively.'
]

/**
 * Generate other medical information (freetext)
 *
 * @param {object} [options] - Generation options
 * @param {number} [options.probability] - Chance of having other medical information (0-1)
 * @returns {string|null} Medical information string or null
 */
const generateOtherMedicalInformation = (options = {}) => {
  const { probability } = options

  // Check if they have other medical information
  if (Math.random() > probability) {
    return null
  }

  // Return a random medical information snippet
  return faker.helpers.arrayElement(MEDICAL_INFORMATION_EXAMPLES)
}

module.exports = {
  generateOtherMedicalInformation
}
