// app/lib/generators/medical-information/breast-features-generator.js

const { faker } = require('@faker-js/faker')
const weighted = require('weighted')

// Feature type configuration
// Maps to the types defined in the form
const FEATURE_TYPES = [
  { value: 'mole', text: 'Mole', weight: 0.40 },
  { value: 'wart', text: 'Wart', weight: 0.25 },
  { value: 'non-surgical-scar', text: 'Non-surgical scar', weight: 0.20 },
  { value: 'bruising-or-trauma', text: 'Bruising or trauma', weight: 0.10 },
  { value: 'other-feature', text: 'Other feature', weight: 0.05 }
]

// Other feature custom descriptions
const OTHER_FEATURE_DESCRIPTIONS = [
  'Birthmark',
  'Port wine stain',
  'Unusual pigmentation',
  'Freckle cluster',
  'Age spot',
  'Skin tag',
  'Seborrheic keratosis',
  'Cherry angioma',
  'Stretch marks',
  'Previous injury mark'
]

// Anatomical regions and their center coordinates (from breast-diagram.njk)
// Regions that are most likely to have visible features
const REGIONS = {
  right: [
    { name: 'axilla', centerX: 61.5, centerY: 89.5, weight: 0.05 },
    { name: 'upper outer', centerX: 171.5, centerY: 139.5, weight: 0.15 },
    { name: 'upper central', centerX: 247.2, centerY: 134.5, weight: 0.12 },
    { name: 'upper inner', centerX: 332.8, centerY: 139.5, weight: 0.10 },
    { name: 'lateral to nipple', centerX: 181.6, centerY: 199.3, weight: 0.10 },
    { name: 'central', centerX: 253.6, centerY: 199.3, weight: 0.08 },
    { name: 'medial to nipple', centerX: 332.8, centerY: 199.3, weight: 0.08 },
    { name: 'lower lateral', centerX: 166.4, centerY: 258.4, weight: 0.08 },
    { name: 'lower outer', centerX: 221.8, centerY: 263.4, weight: 0.12 },
    { name: 'lower central', centerX: 287.4, centerY: 263.4, weight: 0.08 },
    { name: 'lower inner', centerX: 358.0, centerY: 258.4, weight: 0.07 },
    { name: 'inframammary fold', centerX: 252.1, centerY: 321.2, weight: 0.05 },
    { name: 'upper chest', centerX: 252.1, centerY: 63.8, weight: 0.03 },
    { name: 'lateral chest wall', centerX: 30.3, centerY: 238.6, weight: 0.02 }
  ],
  left: [
    { name: 'axilla', centerX: 738.5, centerY: 89.5, weight: 0.05 },
    { name: 'upper outer', centerX: 628.5, centerY: 139.5, weight: 0.15 },
    { name: 'upper central', centerX: 552.8, centerY: 134.5, weight: 0.12 },
    { name: 'upper inner', centerX: 467.2, centerY: 139.5, weight: 0.10 },
    { name: 'lateral to nipple', centerX: 618.4, centerY: 199.3, weight: 0.10 },
    { name: 'central', centerX: 546.4, centerY: 199.3, weight: 0.08 },
    { name: 'medial to nipple', centerX: 467.2, centerY: 199.3, weight: 0.08 },
    { name: 'lower lateral', centerX: 633.6, centerY: 258.4, weight: 0.08 },
    { name: 'lower outer', centerX: 578.2, centerY: 263.4, weight: 0.12 },
    { name: 'lower central', centerX: 512.6, centerY: 263.4, weight: 0.08 },
    { name: 'lower inner', centerX: 442.0, centerY: 258.4, weight: 0.07 },
    { name: 'inframammary fold', centerX: 547.9, centerY: 321.2, weight: 0.05 },
    { name: 'upper chest', centerX: 547.9, centerY: 63.8, weight: 0.03 },
    { name: 'lateral chest wall', centerX: 769.7, centerY: 238.6, weight: 0.02 }
  ],
  center: [
    { name: 'midline', centerX: 399.5, centerY: 199.8, weight: 0.02 },
    { name: 'lower sternum', centerX: 399.5, centerY: 321.2, weight: 0.01 }
  ]
}

/**
 * Select a random region with weighted distribution
 * @returns {object} Region data with side, name, and base coordinates
 */
const selectRegion = () => {
  // First, select which side (weight towards left/right over center)
  const side = weighted.select({
    right: 0.45,
    left: 0.45,
    center: 0.10
  })

  const regionsForSide = REGIONS[side]

  // Build weights object for regions on this side
  const regionWeights = {}
  regionsForSide.forEach(region => {
    regionWeights[region.name] = region.weight
  })

  // Select region
  const regionName = weighted.select(regionWeights)
  const regionData = regionsForSide.find(r => r.name === regionName)

  return {
    side,
    name: regionName,
    baseCenterX: regionData.centerX,
    baseCenterY: regionData.centerY
  }
}

/**
 * Add slight randomness to coordinates so features aren't all perfectly centered
 * @param {number} baseX - Base X coordinate
 * @param {number} baseY - Base Y coordinate
 * @returns {object} Adjusted coordinates
 */
const randomizePosition = (baseX, baseY) => {
  // Add random offset within ±20 SVG units
  const offsetX = faker.number.float({ min: -20, max: 20 })
  const offsetY = faker.number.float({ min: -20, max: 20 })

  return {
    centerX: Math.round(baseX + offsetX),
    centerY: Math.round(baseY + offsetY)
  }
}

/**
 * Generate a single breast feature
 * @param {object} [options] - Generation options
 * @param {number} [options.id] - Feature ID
 * @param {number} [options.number] - Display number for the feature
 * @param {string} [options.type] - Force specific feature type
 * @returns {object} Generated breast feature
 */
const generateBreastFeature = (options = {}) => {
  // Select feature type
  const featureTypeWeights = {}
  FEATURE_TYPES.forEach(type => {
    featureTypeWeights[type.value] = type.weight
  })

  const selectedType = options.type || weighted.select(featureTypeWeights)
  const featureType = FEATURE_TYPES.find(t => t.value === selectedType)

  // Generate feature text
  let featureText = featureType.text
  if (selectedType === 'other-feature') {
    const customDescription = faker.helpers.arrayElement(OTHER_FEATURE_DESCRIPTIONS)
    featureText = `Other: ${customDescription}`
  }

  // Select region and position
  const region = selectRegion()
  const position = randomizePosition(region.baseCenterX, region.baseCenterY)

  return {
    id: options.id || 1,
    number: options.number || 1,
    text: featureText,
    region: region.name,
    side: region.side,
    centerX: position.centerX,
    centerY: position.centerY
  }
}

/**
 * Generate breast features for an event
 *
 * @param {object} [options] - Generation options
 * @param {number} [options.probabilityOfAnyFeatures=0.20] - Chance of having any features
 * @param {number} [options.probabilityOfMultipleFeatures=0.30] - If they have features, chance of having multiple
 * @param {number} [options.maxFeatures=4] - Maximum number of features to generate
 * @param {object} [options.config] - Participant config for overrides
 * @returns {Array|null} Array of breast features, or null if none generated
 */
const generateBreastFeatures = (options = {}) => {
  const {
    probabilityOfAnyFeatures = 0.20,
    probabilityOfMultipleFeatures = 0.30,
    maxFeatures = 4,
    config
  } = options

  // Support complete override from test scenarios
  if (config?.breastFeatures) {
    return config.breastFeatures
  }

  // Check if they have any features
  if (Math.random() > probabilityOfAnyFeatures) {
    return null
  }

  // Determine how many features
  let numberOfFeatures = 1

  if (Math.random() < probabilityOfMultipleFeatures) {
    // If they're getting multiple, weighted towards fewer
    numberOfFeatures = weighted.select({
      2: 0.60,
      3: 0.30,
      4: 0.10
    })
  }

  // Cap at maxFeatures
  numberOfFeatures = Math.min(numberOfFeatures, maxFeatures)

  // Generate features
  const features = []
  const usedRegions = new Set() // Track to avoid exact duplicates

  for (let index = 0; index < numberOfFeatures; index++) {
    let feature
    let attempts = 0
    const maxAttempts = 20

    // Try to generate a feature in a unique region
    do {
      feature = generateBreastFeature({
        id: index + 1,
        number: index + 1
      })
      attempts++
    } while (
      usedRegions.has(`${feature.side}-${feature.region}`) &&
      attempts < maxAttempts
    )

    // Add the region to used set
    usedRegions.add(`${feature.side}-${feature.region}`)

    features.push(feature)
  }

  return features
}

module.exports = {
  generateBreastFeature,
  generateBreastFeatures,
  // Export for testing/reference
  FEATURE_TYPES,
  REGIONS
}
