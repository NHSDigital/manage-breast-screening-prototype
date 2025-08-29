// app/lib/generators/address-generator.js

const { faker } = require('@faker-js/faker')

// Common UK street suffixes
const STREET_SUFFIXES = [
  'Street',
  'Road',
  'Lane',
  'Avenue',
  'Close',
  'Drive',
  'Way',
  'Gardens',
  'Crescent',
  'Grove',
  'Place',
  'Green',
  'Park',
  'Walk',
  'Mews'
]

// Common UK street name prefixes
const STREET_PREFIXES = [
  'High',
  'Church',
  'Station',
  'Victoria',
  'Manor',
  "Queen's",
  "King's",
  'New',
  'School',
  'Mill',
  'Park',
  'London',
  'York',
  'Albert',
  'Windsor',
  'Castle',
  'George',
  'The',
  'Old',
  'North',
  'South',
  'East',
  'West'
]

// Common house/building names
const HOUSE_NAMES = [
  'Rose Cottage',
  'The Old School House',
  'The Coach House',
  'The Old Vicarage',
  'The Gables',
  'The Willows',
  'Orchard House',
  'Oak House',
  'Ivy Cottage',
  'The Old Post Office',
  'The Old Rectory',
  'Holly Cottage',
  'The Laurels',
  'The Old Farm',
  'Sunnyside'
]

/**
 * Extract postcode area (first 1-2 letters) from a full postcode
 *
 * @param {string} postcode - Full UK postcode
 * @returns {string} Postcode area (e.g., 'OX' from 'OX3 7LE')
 */
const getPostcodeArea = (postcode) => {
  return postcode.match(/^[A-Z]{1,2}/)[0]
}

/**
 * Get the postcode district (number after area) from a full postcode
 *
 * @param {string} postcode - Full UK postcode
 * @returns {string} Postcode district number
 */
const getPostcodeDistrict = (postcode) => {
  return postcode.match(/^[A-Z]{1,2}(\d+)/)[1]
}

/**
 * Generate a random postcode in the same area as the reference postcode
 *
 * @param {string} referencePostcode - Postcode to base the new one on
 * @returns {string} New postcode in same area
 */
const generateNearbyPostcode = (referencePostcode) => {
  const area = getPostcodeArea(referencePostcode)
  const district = getPostcodeDistrict(referencePostcode)

  // Generate nearby district number (±1 of reference, staying in valid range)
  const districtNum = parseInt(district)
  const nearbyDistrict = faker.helpers.arrayElement([
    districtNum,
    Math.max(1, districtNum - 1),
    districtNum + 1
  ])

  // Generate random sector (0-9) and unit (two letters)
  const sector = faker.number.int({ min: 0, max: 9 })
  const unit =
    faker.helpers.arrayElement('ABCDEFGHJKLMNPQRSTUWXYZ') +
    faker.helpers.arrayElement('ABCDEFGHJKLMNPQRSTUWXYZ')

  return `${area}${nearbyDistrict} ${sector}${unit}`
}

/**
 * Generate a random street name
 *
 * @returns {string} Generated street name
 */
const generateStreetName = () => {
  const prefix = faker.helpers.arrayElement(STREET_PREFIXES)
  const suffix = faker.helpers.arrayElement(STREET_SUFFIXES)
  return `${prefix} ${suffix}`
}

/**
 * Generate line 1 of an address
 *
 * @returns {object} Address line 1 details
 */
const generateAddressLine1 = () => {
  // 20% chance of using a house name instead of number
  if (Math.random() < 0.2) {
    return {
      line1: faker.helpers.arrayElement(HOUSE_NAMES)
    }
  }

  const houseNumber = faker.number.int({ min: 1, max: 300 })
  const streetName = generateStreetName()

  // 15% chance of being a flat/apartment
  if (Math.random() < 0.15) {
    const flatNumber = faker.number.int({ min: 1, max: 20 })
    return {
      line1: `Flat ${flatNumber}, ${houseNumber} ${streetName}`
    }
  }

  return {
    line1: `${houseNumber} ${streetName}`
  }
}

/**
 * Generate list of nearby towns/areas based on BSU location
 *
 * @param {object} bsu - Breast screening unit object
 * @returns {Array} List of nearby towns/areas
 */
const generateNearbyAreas = (bsu) => {
  // Start with the BSU's own city and any address parts that look like areas
  const areas = new Set(
    [
      bsu.address.city,
      bsu.address.line4,
      ...bsu.locations
        .filter((l) => l.type === 'hospital')
        .map((l) => l.address.city)
        .filter(Boolean)
    ].filter(Boolean)
  )

  // Add some generated nearby areas
  for (let i = 0; i < 2; i++) {
    // Use UK-style town names
    const suffix = faker.helpers.arrayElement([
      'on-Sea',
      'upon-Thames',
      'St Mary',
      'St John',
      'under-Edge',
      'on-the-Hill',
      '',
      '',
      '',
      '' // More weight to no suffix
    ])

    const name = `${faker.location.city()}${suffix ? ` ${suffix}` : ''}`
    areas.add(name)
  }

  return Array.from(areas)
}

/**
 * Generate an address appropriate for the BSU area
 *
 * @param {object} bsu - Breast screening unit object
 * @returns {object} Generated address object
 */
const generateBSUAppropriateAddress = (bsu) => {
  const nearbyAreas = generateNearbyAreas(bsu)
  const addressLine1 = generateAddressLine1()

  // 30% chance of having a line2
  const line2 =
    Math.random() < 0.3
      ? `${faker.word.adjective().charAt(0).toUpperCase() + faker.word.adjective().slice(1)} House`
      : null

  return {
    ...addressLine1,
    line2,
    town: faker.helpers.arrayElement(nearbyAreas),
    postcode: generateNearbyPostcode(bsu.address.postcode)
  }
}

module.exports = {
  generateBSUAppropriateAddress
}
