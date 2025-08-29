// app/filters/tags.js

const { safe: nunjucksSafe } = require('nunjucks/src/filters')
const { formatWords, sentenceCase, snakeCase } = require('../lib/utils/strings')
const { getStatusTagColour, getStatusText } = require('../lib/utils/status')

/**
 * Convert a status string into an NHS tag
 * @param {string} status - Status to convert
 * @param {Object} [options] - Optional configuration
 * @returns {string} HTML for tag component
 */
const toTag = (status, options = {}) => {
  if (!status) return ''

  // Format the status text for display
  const text = options.text || getStatusText(status) || sentenceCase(formatWords(status))

  // Format the status for use in class names
  const statusForClass = snakeCase(status)

  // Get the colour class
  const colourClass = options.colour || getStatusTagColour(status) ||  getStatusTagColour(statusForClass)

  // Build classes string
  const classes = [
    'nhsuk-tag',
    'app-nowrap',
    colourClass ? `nhsuk-tag--${colourClass}` : '',
    options.classes || '',
  ].filter(Boolean).join(' ')

  // Generate tag HTML
  const idAttr = options.id ? ` id=\"${options.id}\"` : ''
  return nunjucksSafe(`<strong${idAttr} class="${classes}">${text}</strong>`)
}

module.exports = {
  toTag,
}