// app/filers/formatting.js

/**
 * Format a yes/no/not answered response with optional additional details
 *
 * @param {string|boolean} value - The response value to format
 * @param {object} [options] - Formatting options
 * @param {string} [options.yesValue] - Additional details to show after "Yes -" for positive responses
 * @param {string} [options.noText] - Text to show for negative responses
 * @param {string} [options.notAnsweredText] - Text to show when no response given
 * @param {string} [options.yesPrefix] - Text to show for positive responses (before any yesValue)
 * @returns {string} Formatted response text
 * @example
 * formatAnswer("yes", { yesValue: "Details here" }) // Returns "Yes - Details here"
 * formatAnswer("no") // Returns "No"
 * formatAnswer(null) // Returns "Not answered"
 * formatAnswer("yes", { yesPrefix: "Currently" }) // Returns "Currently"
 */
const formatAnswer = (value, options = {}) => {
  const {
    yesValue = null,
    noText = 'No',
    notAnsweredText = 'Not answered',
    yesPrefix = 'Yes'
  } = options

  // Handle not answered cases
  if (value === null || value === undefined || value === '') {
    return notAnsweredText
  }

  // Handle explicit no values
  if (value === 'no' || value === 'false' || value === false) {
    return noText
  }

  // For any truthy value (includes "yes", true, etc)
  return yesValue ? `${yesPrefix} - ${yesValue}` : yesPrefix
}

// Convert an integer to its ordinal name (first, second, third, etc)
const getOrdinalName = (integer) => {
  const ordinals = [
    'zeroth', // shouldn't be possible
    'first',
    'second',
    'third',
    'fourth',
    'fifth',
    'sixth',
    'seventh',
    'eighth',
    'ninth',
    'tenth'
  ]

  const parsedInteger = Number(integer)

  if (
    !Number.isInteger(parsedInteger) ||
    parsedInteger < 1 ||
    parsedInteger > 10
  ) {
    console.warn('Error in getOrdinalName: input out of bounds')
    return ''
  }

  return ordinals[parsedInteger]
}

// Convert a zero-based index to its ordinal name (0 => first, 1 => second, etc)
const getOrdinalNameIndex0 = (integer) => getOrdinalName(Number(integer) + 1)

module.exports = {
  formatAnswer,
  getOrdinalName,
  getOrdinalNameIndex0
}
