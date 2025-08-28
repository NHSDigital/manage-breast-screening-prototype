// app/lib/utils/utility.js

/**
 * Coerces a value to boolean, handling common web cases. Useful for converting json / html attributes from strings to their appropriate boolean values.
 *
 * @param {any} value - Value to convert to boolean
 * @returns {boolean} Coerced boolean value
 */
const falsify = (value) => {
  // Handle strings case-insensitively
  if (typeof value === 'string') {
    const normalised = value.trim().toLowerCase()

    // Explicit false values
    if (
      ['false', 'no', 'off', '0', '', 'null', 'undefined'].includes(normalised)
    ) {
      return false
    }

    // Explicit true values
    if (['true', 'yes', 'on', '1'].includes(normalised)) {
      return true
    }
  }

  // Handle numbers
  if (typeof value === 'number') {
    return value !== 0
  }

  // Use JavaScript's standard boolean coercion for other cases
  return Boolean(value)
}

/**
 * Normalise string
 *
 * 'If it looks like a duck, and it quacks like a duck…' 🦆
 *
 * If the passed value looks like a boolean or a number, convert it to a boolean
 * or number.
 *
 * Designed to be used to convert config passed via data attributes (which are
 * always strings) into something sensible.
 *
 * Copied from:
 * https://github.com/alphagov/govuk-frontend/blob/main/packages/govuk-frontend/src/govuk/common/configuration.mjs#L93-L142
 *
 * @internal
 * @param {DOMStringMap[string]} value - The value to normalise
 * @param {SchemaProperty} [property] - Component schema property
 * @returns {string | boolean | number | undefined} Normalised data
 */
const normaliseString = (value, property) => {
  const trimmedValue = value ? value.trim() : ''

  let output
  let outputType = property?.type

  // No schema type set? Determine automatically
  if (!outputType) {
    if (['true', 'false'].includes(trimmedValue)) {
      outputType = 'boolean'
    }

    // Empty / whitespace-only strings are considered finite so we need to check
    // the length of the trimmed string as well
    if (trimmedValue.length > 0 && isFinite(Number(trimmedValue))) {
      outputType = 'number'
    }
  }

  switch (outputType) {
    case 'boolean':
      output = trimmedValue === 'true'
      break

    case 'number':
      output = Number(trimmedValue)
      break

    default:
      output = value
  }

  return output
}

/**
 * Limit array or string to first x items/characters with support for negative indices
 *
 * @param {Array|string} input - Array or string to limit
 * @param {number|string} limit - Number of items/chars to return. Negative numbers slice from end
 * @returns {Array|string} Limited subset of input
 */
const limitTo = (input, limit) => {
  if (typeof limit !== 'number') {
    limit = parseInt(limit)
  }

  if (typeof input === 'string') {
    return limit >= 0 ? input.substring(0, limit) : input.substr(limit)
  }

  if (Array.isArray(input)) {
    limit = Math.min(limit, input.length)
    return limit >= 0
      ? input.slice(0, limit)
      : input.slice(input.length + limit, input.length)
  }

  return input
}

module.exports = {
  falsify,
  normaliseString,
  limitTo
}
