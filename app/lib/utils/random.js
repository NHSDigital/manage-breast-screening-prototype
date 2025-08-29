// app/lib/utils/random.js

const { faker } = require('@faker-js/faker')
const weighted = require('weighted')

// Keep track of function calls by name for each page render
let callSequence = {}

/**
 * Simple seedable pseudo-random number generator
 */
const seededRandom = (seed) => {
  // Convert string seeds to numeric values
  let numericSeed
  if (typeof seed === 'string') {
    numericSeed = seed.split('').reduce((acc, char, i) => {
      return acc + char.charCodeAt(0) * (i + 1)
    }, 0)
  } else {
    numericSeed = seed
  }

  // Simple LCG parameters
  const m = 2147483647 // 2^31 - 1
  const a = 1103515245
  const c = 12345

  let state = numericSeed || 1

  // Get next random number between 0 and 1
  const next = () => {
    state = (a * state + c) % m
    return state / m
  }

  return {
    next,
    nextInt: (min, max) => {
      return Math.floor(next() * (max - min + 1)) + min
    },
    nextItem: (array) => {
      if (!array || !array.length) return null
      const index = Math.floor(next() * array.length)
      return array[index]
    },
    nextBool: (probability = 0.5) => {
      return next() < probability
    }
  }
}

/**
 * Get seed from context with a named reference for consistency
 */
const getSeed = function (baseSeed, name) {
  // Get base seed (URL or explicit seed)
  const useSeed =
    baseSeed !== undefined ? baseSeed : this?.ctx?.currentUrl || 'default-url'

  // Create a unique seed by combining the base seed and name
  return `${useSeed}-${name}`
}

/**
 * Generate a random boolean with consistent results
 *
 * @param {number} probability - Chance of returning true (0-1)
 * @param {string} [name] - Unique name for this random call
 * @param {string|number} [seed] - Optional explicit seed
 */
const randomBool = function (probability = 0.5, name, seed) {
  // Track unique names for each call in the sequence
  if (!name) {
    callSequence.bool = (callSequence.bool || 0) + 1
    name = `bool-${callSequence.bool}`
  }

  const useSeed = getSeed.call(this, seed, name)
  return seededRandom(useSeed).nextBool(probability)
}

/**
 * Select a random item from an array with consistent results
 *
 * @param {Array} array - Array of items
 * @param {string} [name] - Unique name for this random call
 * @param {string|number} [seed] - Optional explicit seed
 */
const randomItem = function (array, name, seed) {
  // Track unique names for each call in the sequence
  if (!name) {
    callSequence.item = (callSequence.item || 0) + 1
    name = `item-${callSequence.item}`
  }

  const useSeed = getSeed.call(this, seed, name)
  return seededRandom(useSeed).nextItem(array)
}

/**
 * Select multiple random items from an array with consistent results
 *
 * @param {Array} array - Array of items
 * @param {number} count - Number of items to select
 * @param {string} [name] - Unique name for this random call
 * @param {string|number} [seed] - Optional explicit seed
 */
const randomItems = function (array, count, name, seed) {
  // Track unique names for each call in the sequence
  if (!name) {
    callSequence.items = (callSequence.items || 0) + 1
    name = `items-${callSequence.items}`
  }

  const useSeed = getSeed.call(this, seed, name)

  if (!array || !array.length || count <= 0) return []

  const rng = seededRandom(useSeed)
  const copy = [...array]
  const result = []

  const actualCount = Math.min(count, copy.length)

  for (let i = 0; i < actualCount; i++) {
    const index = rng.nextInt(0, copy.length - 1)
    result.push(copy[index])
    copy.splice(index, 1)
  }

  return result
}

/**
 * Choose between two values based on probability
 *
 * @param {*} valueIfTrue - Value if random check passes
 * @param {*} valueIfFalse - Value if random check fails
 * @param {number} probability - Chance of returning first value (0-1)
 * @param {string} [name] - Unique name for this random call
 * @param {string|number} [seed] - Optional explicit seed
 */
const randomOneOf = function (
  valueIfTrue,
  valueIfFalse,
  probability = 0.5,
  name,
  seed
) {
  // Track unique names for each call in the sequence
  if (!name) {
    callSequence.oneOf = (callSequence.oneOf || 0) + 1
    name = `oneOf-${callSequence.oneOf}`
  }

  const useSeed = getSeed.call(this, seed, name)
  return seededRandom(useSeed).nextBool(probability)
    ? valueIfTrue
    : valueIfFalse
}

/**
 * Generate a random integer in a range
 *
 * @param {number} min - Minimum value (inclusive)
 * @param {number} max - Maximum value (inclusive)
 * @param {string} [name] - Unique name for this random call
 * @param {string|number} [seed] - Optional explicit seed
 */
const randomInt = function (min, max, name, seed) {
  // Track unique names for each call in the sequence
  if (!name) {
    callSequence.int = (callSequence.int || 0) + 1
    name = `int-${callSequence.int}`
  }

  const useSeed = getSeed.call(this, seed, name)
  return seededRandom(useSeed).nextInt(min, max)
}

/**
 * Use weighted selection with consistent results
 *
 * @param {object | Array} weights - Weights object or array
 * @param {string} [name] - Unique name for this random call
 * @param {string|number} [seed] - Optional explicit seed
 */
const randomWeighted = function (weights, name, seed) {
  // Track unique names for each call in the sequence
  if (!name) {
    callSequence.weighted = (callSequence.weighted || 0) + 1
    name = `weighted-${callSequence.weighted}`
  }

  const useSeed = getSeed.call(this, seed, name)
  const rng = seededRandom(useSeed)
  const customRandom = () => rng.next()

  if (!weights || typeof weights !== 'object') {
    return null
  }

  // Handle different formats
  if (!Array.isArray(weights)) {
    return weighted.select(weights, { rand: customRandom })
  }

  if (Array.isArray(weights) && !Array.isArray(weights[0])) {
    return weighted.select(weights, null, customRandom)
  }

  if (
    Array.isArray(weights) &&
    weights.length === 2 &&
    Array.isArray(weights[0]) &&
    Array.isArray(weights[1])
  ) {
    return weighted.select(weights[0], weights[1], customRandom)
  }

  return weighted.select(weights, null, customRandom)
}

/**
 * Create a seeded faker instance with consistent results
 *
 * @param {string} [name] - Unique name for this random call
 * @param {string|number} [seed] - Optional explicit seed
 */
const seededFaker = function (name, seed) {
  // Track unique names for each call in the sequence
  if (!name) {
    callSequence.faker = (callSequence.faker || 0) + 1
    name = `faker-${callSequence.faker}`
  }

  const useSeed = getSeed.call(this, seed, name)

  // Convert the seed to a number for faker
  const numericSeed =
    typeof useSeed === 'string'
      ? useSeed
          .split('')
          .reduce((acc, char, i) => acc + char.charCodeAt(0) * (i + 1), 0)
      : useSeed

  // Create a new instance of faker with the seed
  // Need to use localFaker to not affect global faker state
  const localFaker = { ...faker }
  localFaker.seed = faker.seed
  localFaker.seed(numericSeed)

  return localFaker
}

// Reset the call sequence for each new page render
// This should be called once per page load - eg by middleware in routes file
const resetCallSequence = () => {
  callSequence = {}
}

module.exports = {
  randomBool,
  randomItem,
  randomItems,
  randomOneOf,
  randomInt,
  randomWeighted,
  seededFaker,
  resetCallSequence
}

// {# Uses current URL as seed automatically #}
// {% set selectedOption = ['one', 'two', 'three'] | randomItem %}

// {# Pick from options with weighted probabilities #}
// {% set priority = { 'low': 0.7, 'medium': 0.2, 'high': 0.1 } | randomWeighted %}

// {# Generate random integer between 1 and 10 #}
// {% set number = [1, 10] | randomInt %}

// {# Generate fake data consistently for this page #}
// {% set faker = randomFaker() %}
// {% set condition = faker.helpers.arrayElement(['Diabetes', 'Hypertension']) %}

// {# Use explicit seed for specific entity #}
// {% set symptoms = ['Pain', 'Swelling', 'Discharge'] | randomItem(event.id) %}

// {# Use different entities as seeds for different parts of the page #}
// {% set clinicStatus = ['Busy', 'Normal', 'Quiet'] | randomItem(clinic.id) %}
// {% set patientStatus = ['Stable', 'Improving', 'Concerning'] | randomItem(participant.id) %}

// {# Complex example with different seeds #}
// {% set hasHistory = randomBool(0.3, participant.id) %}
// {% if hasHistory %}
//   {% set historyType = {
//     'family': 0.6,
//     'personal': 0.4
//   } | randomWeighted(participant.id + '_history_type') %}

//   {# Notice using a different seed by appending a string to the ID #}
//   {# This creates different randomization for different aspects #}
// {% endif %}

// {# Uses current URL as seed automatically #}
// {% set selectedOption = ['one', 'two', 'three'] | randomItem %}

// {# Or use explicit seed when needed #}
// {% set selectedOption = ['one', 'two', 'three'] | randomItem(event.id) %}

// {# Works the same for all functions #}
// {% set priority = { 'low': 0.7, 'medium': 0.2, 'high': 0.1 } | randomWeighted %}
// {% set priority = { 'low': 0.7, 'medium': 0.2, 'high': 0.1 } | randomWeighted(participant.id) %}
