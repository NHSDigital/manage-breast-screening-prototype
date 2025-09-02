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

module.exports = {
  formatAnswer
}
