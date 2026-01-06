// app/lib/generators/medical-information/breast-features-generator.js

const { faker } = require('@faker-js/faker')
const weighted = require('weighted')

// Feature type configuration
// Maps to the types defined in the form
const FEATURE_TYPES = [
  { value: 'mole', text: 'Mole', weight: 0.4 },
  { value: 'wart', text: 'Wart', weight: 0.25 },
  { value: 'non-surgical-scar', text: 'Non-surgical scar', weight: 0.2 },
  { value: 'bruising-or-trauma', text: 'Bruising or trauma', weight: 0.1 },
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

// Anatomical regions and their approximate center coordinates (from new breast diagram)
// Regions that are most likely to have visible features
const REGIONS = {
  right: [
    { name: 'axilla', centerX: 67, centerY: 65, weight: 0.05 },
    {
      name: 'lateral infraclavicular',
      centerX: 155,
      centerY: 40,
      weight: 0.03
    },
    { name: 'medial infraclavicular', centerX: 318, centerY: 45, weight: 0.03 },
    { name: 'upper outer', centerX: 168, centerY: 130, weight: 0.1 },
    { name: 'upper central', centerX: 236, centerY: 130, weight: 0.08 },
    { name: 'upper inner', centerX: 320, centerY: 130, weight: 0.08 },
    { name: 'lateral to nipple', centerX: 168, centerY: 200, weight: 0.1 },
    { name: 'central', centerX: 240, centerY: 200, weight: 0.08 },
    { name: 'medial to nipple', centerX: 330, centerY: 200, weight: 0.08 },
    { name: 'lateral to breast', centerX: 52, centerY: 180, weight: 0.04 },
    { name: 'lower outer', centerX: 168, centerY: 280, weight: 0.08 },
    { name: 'lower central', centerX: 240, centerY: 280, weight: 0.06 },
    { name: 'lower inner', centerX: 310, centerY: 280, weight: 0.06 },
    {
      name: 'lateral inframammary fold',
      centerX: 150,
      centerY: 340,
      weight: 0.03
    },
    {
      name: 'central inframammary fold',
      centerX: 260,
      centerY: 355,
      weight: 0.03
    },
    {
      name: 'medial inframammary fold',
      centerX: 370,
      centerY: 290,
      weight: 0.02
    },
    {
      name: 'lateral upper abdominal wall',
      centerX: 120,
      centerY: 385,
      weight: 0.01
    },
    {
      name: 'medial upper abdominal wall',
      centerX: 360,
      centerY: 370,
      weight: 0.01
    },
    { name: 'pre-sternal', centerX: 390, centerY: 120, weight: 0.02 }
  ],
  left: [
    { name: 'axilla', centerX: 733, centerY: 65, weight: 0.05 },
    {
      name: 'lateral infraclavicular',
      centerX: 645,
      centerY: 40,
      weight: 0.03
    },
    { name: 'medial infraclavicular', centerX: 482, centerY: 45, weight: 0.03 },
    { name: 'upper outer', centerX: 632, centerY: 130, weight: 0.1 },
    { name: 'upper central', centerX: 564, centerY: 130, weight: 0.08 },
    { name: 'upper inner', centerX: 480, centerY: 130, weight: 0.08 },
    { name: 'lateral to nipple', centerX: 632, centerY: 200, weight: 0.1 },
    { name: 'central', centerX: 560, centerY: 200, weight: 0.08 },
    { name: 'medial to nipple', centerX: 470, centerY: 200, weight: 0.08 },
    { name: 'lateral to breast', centerX: 748, centerY: 180, weight: 0.04 },
    { name: 'lower outer', centerX: 632, centerY: 280, weight: 0.08 },
    { name: 'lower central', centerX: 560, centerY: 280, weight: 0.06 },
    { name: 'lower inner', centerX: 490, centerY: 280, weight: 0.06 },
    {
      name: 'lateral inframammary fold',
      centerX: 650,
      centerY: 340,
      weight: 0.03
    },
    {
      name: 'central inframammary fold',
      centerX: 540,
      centerY: 355,
      weight: 0.03
    },
    {
      name: 'medial inframammary fold',
      centerX: 430,
      centerY: 290,
      weight: 0.02
    },
    {
      name: 'lateral upper abdominal wall',
      centerX: 680,
      centerY: 385,
      weight: 0.01
    },
    {
      name: 'medial upper abdominal wall',
      centerX: 440,
      centerY: 370,
      weight: 0.01
    },
    { name: 'pre-sternal', centerX: 410, centerY: 120, weight: 0.02 }
  ]
}

/**
 * Select a random region with weighted distribution
 * @returns {object} Region data with side, name, and base coordinates
 */
const selectRegion = () => {
  // Select which side (equal weight)
  const side = weighted.select({
    right: 0.5,
    left: 0.5
  })

  const regionsForSide = REGIONS[side]

  // Build weights object for regions on this side
  const regionWeights = {}
  regionsForSide.forEach((region) => {
    regionWeights[region.name] = region.weight
  })

  // Select region
  const regionName = weighted.select(regionWeights)
  const regionData = regionsForSide.find((r) => r.name === regionName)

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
  FEATURE_TYPES.forEach((type) => {
    featureTypeWeights[type.value] = type.weight
  })

  const selectedType = options.type || weighted.select(featureTypeWeights)
  const featureType = FEATURE_TYPES.find((t) => t.value === selectedType)

  // Generate feature text
  let featureText = featureType.text
  if (selectedType === 'other-feature') {
    const customDescription = faker.helpers.arrayElement(
      OTHER_FEATURE_DESCRIPTIONS
    )
    featureText = `Other: ${customDescription}`
  }

  // Select region and position
  const region = selectRegion()
  const position = randomizePosition(region.baseCenterX, region.baseCenterY)

  // Center regions span the midline - don't prefix with side
  // In the SVG, these have aria-label without side prefix (e.g., "pre-sternal" not "left pre-sternal")
  const centerRegions = ['pre-sternal']
  const isCenter = centerRegions.includes(region.name)

  // Build region name with side (e.g., "left upper inner") unless it's a center region
  const regionName = isCenter ? region.name : `${region.side} ${region.name}`

  // For center regions, the side should be "center"
  const sideValue = isCenter ? 'center' : region.side

  return {
    id: options.id || 1,
    number: options.number || 1,
    text: featureText,
    region: regionName,
    side: sideValue,
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
    probabilityOfAnyFeatures = 0.2,
    probabilityOfMultipleFeatures = 0.3,
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
      2: 0.6,
      3: 0.3,
      4: 0.1
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
    } while (usedRegions.has(feature.region) && attempts < maxAttempts)

    // Add the region to used set (region already includes side, e.g., "left upper inner")
    usedRegions.add(feature.region)

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
