// app/lib/utils/strings.js

const { safe: nunjucksSafe } = require('nunjucks/src/filters')
const pluralizeLib = require('pluralize')

/**
 * Convert string to sentence case, removing leading/trailing whitespace
 *
 * @param {string} input - String to convert
 * @returns {string} Trimmed sentence case string
 */
const sentenceCase = (input) => {
  if (!input) return ''
  if (typeof input !== 'string') return input

  const trimmed = input.trim()
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1)
}

/**
 * Convert string to start with lowercase
 *
 * @param {string} input - String to convert
 * @returns {string} String starting with lowercase
 */
const startLowerCase = (input) => {
  if (!input) return ''
  if (typeof input !== 'string') return input
  return input.charAt(0).toLowerCase() + input.slice(1)
}

/**
 * Convert string to camelCase
 * Example: 'hello world' becomes 'helloWorld'
 *
 * @param {string} input - String to convert
 * @returns {string} Camel case string
 */
const camelCase = (input) => {
  if (!input) return ''
  if (typeof input !== 'string') return input

  return input
    .toLowerCase()
    .replace(/[^a-zA-Z0-9]+(.)/g, (match, char) => char.toUpperCase())
}

/**
 * Separate words with hyphens
 *
 * @param {string} input - String to convert
 * @returns {string} Hyphen-separated string
 */
const kebabCase = (input) => {
  if (!input) return ''
  return input
    .replace(/([a-z])([A-Z])/g, '$1-$2')
    .replace(/\s+/g, '-')
    .toLowerCase()
}

/**
 * Convert string to snake_case
 * Handles spaces, camelCase, and other separators
 *
 * @param {string} input - String to convert
 * @returns {string} Snake case (underscore-separated lowercase) string
 * @example
 * snakeCase('Hello World') // returns 'hello_world'
 * snakeCase('myVariable') // returns 'my_variable'
 * snakeCase('some-kebab-text') // returns 'some_kebab_text'
 */
const snakeCase = (input) => {
  if (!input) return ''
  if (typeof input !== 'string') return input

  return (
    input
      // Handle camelCase
      .replace(/([a-z])([A-Z])/g, '$1_$2')
      // Replace spaces and other separators with underscores
      .replace(/[\s-]+/g, '_')
      // Convert to lowercase
      .toLowerCase()
  )
}

/**
 * Create URL-friendly slug from string
 *
 * @param {string} input - String to convert
 * @returns {string} URL-safe slug
 */
const slugify = (input) => {
  if (!input) return ''
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
}

/**
 * Split a string using a separator
 *
 * @param {string} input - String to split
 * @param {string} separator - Separator to split on
 * @returns {Array} Array of split strings
 */
const split = (input, separator) => {
  if (!input || typeof input !== 'string') return []
  return input.split(separator)
}

/**
 * Add appropriate indefinite article (a/an) before a word
 *
 * @param {string} input - Word to prefix
 * @returns {string} Word with appropriate article
 */
const addIndefiniteArticle = (input) => {
  if (!input) return ''
  return /^[aeiou]/i.test(input) ? `an ${input}` : `a ${input}`
}

/**
 * Make a string possessive
 *
 * @param {string} input - String to make possessive
 * @returns {string} Possessive form of string
 */
const possessive = (input) => {
  if (!input) return ''
  const isAllUpperCase = input === input.toUpperCase()
  const endsInS = /s$/i.test(input)

  if (endsInS) {
    return `${input}'`
  }
  if (isAllUpperCase) {
    return `${input}'S`
  }
  return `${input}'s`
}

/**
 * Pad a number with leading zeros
 *
 * @param {number|string} input - Number to pad
 * @param {number} length - Desired length
 * @returns {string} Padded number
 */
const padDigits = (input, length) => {
  if (!input) return ''
  return input.toString().padStart(length, '0')
}

/**
 * Format number as currency with thousands separators
 *
 * @param {number} input - Number to format
 * @returns {string} Formatted currency string
 */
const formatCurrency = (input) => {
  if (!input) return '–'
  const value = parseInt(input, 10)
  const formatted = Math.abs(value).toLocaleString()
  return value < 0 ? `–£${formatted}` : `£${formatted}`
}

/**
 * Format number as currency without separators (for CSV)
 *
 * @param {number} input - Number to format
 * @returns {string} Formatted currency string
 */
const formatCurrencyForCsv = (input) => {
  if (!input) return '0'
  const value = parseInt(input, 10)
  return value < 0 ? `-£${Math.abs(value)}` : `£${value}`
}

/**
 * Check if string starts with target
 *
 * @param {string} input - String to check
 * @param {string} target - String to look for at start
 * @returns {boolean} Whether string starts with target
 */
const startsWith = (input, target) => {
  if (typeof input !== 'string') return false
  return input.startsWith(target)
}

/**
 * Check if string contains substring
 *
 * @param {string} input - String to search in
 * @param {string} target - Substring to look for
 * @returns {boolean} Whether string contains substring
 */
const stringIncludes = (input, target) => {
  if (typeof input !== 'string' || typeof target !== 'string') return false
  return input.includes(target)
}

/**
 * Check if value is a string
 *
 * @param {any} input - Value to check
 * @returns {boolean} Whether value is a string
 */
const isString = (input) => {
  return typeof input === 'string'
}

/**
 * Format separated words as a sentence, preserving acronyms
 * Example: 'in_progress' becomes 'In progress'
 * Example: 'not_in_PACS' becomes 'Not in PACS'
 * Example: 'IBMs_server' becomes 'IBMs server'
 * Example: 'IBM's_mainframe' becomes 'IBM's mainframe'
 *
 * @param {string} input - String to format
 * @param {string} [separator] - Character that separates words
 * @returns {string} Formatted string as words
 */
const formatWords = (input, separator = '_') => {
  if (!input) return ''
  if (typeof input !== 'string') return input

  return input
    .split(separator)
    .map((word) => {
      // Check if word is an acronym:
      // - all uppercase, OR
      // - 2+ chars where any character after first is uppercase (handles IBMs, IBM's etc)
      if (
        word === word.toUpperCase() ||
        (word.length >= 2 &&
          word
            .slice(1)
            .split('')
            .some((char) => char === char.toUpperCase() && char.match(/[A-Z]/)))
      ) {
        return word
      }
      return word.toLowerCase()
    })
    .join(' ')
}

/**
 * Support for template literals in Nunjucks
 * Usage: {{ 'The count is ${count}' | stringLiteral }}
 *
 * @param {string} str - Template string
 * @returns {string} Processed string with variables replaced
 */
const stringLiteral = function (str) {
  // eslint-disable-next-line no-new-func
  return new Function('with (this) { return `' + str + '` }').call(this.ctx)
}

/**
 * Wrap string in a no-wrap span
 *
 * @param {string} input - String to wrap
 * @returns {string} HTML string with no-wrap class
 */
const noWrap = (input) => {
  if (!input) return ''
  return nunjucksSafe(`<span class="app-nowrap">${input}</span>`)
}

/**
 * Wrap string in a no-wrap span
 *
 * @param {string} input - String to wrap
 * @returns {string} HTML string with no-wrap class
 */
const asHint = (input) => {
  if (!input) return ''
  return nunjucksSafe(`<span class="app-text-grey">${input}</span>`)
}

/**
 * Wrap string in a hidden text span
 * Used for accessibility to provide additional context without displaying it
 *
 * @param {string} input - String to wrap
 * @returns {string} HTML string with hidden text class
 */
const asVisuallyHiddenText = (input) => {
  if (!input) return ''
  return nunjucksSafe(`<span class="nhsuk-u-visually-hidden">${input}</span>`)
}

/**
 * Wrap string in a span, hiding it from assistive technologies
 * Used where the visual text should not be made available
 *
 * @param {string} input - String to wrap
 * @returns {string} HTML string with hidden text class
 */
const asAriaHiddenText = (input) => {
  if (!input) return ''
  return nunjucksSafe(`<span aria-hidden="true">${input}</span>`)
}

/**
 * Format phone number for display with spaces
 *
 * @param {string} phoneNumber - Raw phone number string
 * @returns {string} Formatted phone number
 */
const formatPhoneNumber = (phoneNumber) => {
  if (!phoneNumber) return ''
  if (typeof phoneNumber !== 'string') return phoneNumber

  if (phoneNumber.startsWith('07')) {
    return `${phoneNumber.slice(0, 5)} ${phoneNumber.slice(5)}`
  }

  return `${phoneNumber.slice(0, 4)} ${phoneNumber.slice(4, 7)} ${phoneNumber.slice(7)}`
}

/**
 * Format NHS number with spaces (3-3-4 format)
 *
 * @param {string|number} input - NHS number to format
 * @returns {string} Formatted NHS number or original input if invalid
 */
const formatNhsNumber = (input) => {
  if (!input) return ''
  const nhsStr = input.toString().replace(/\s/g, '')

  if (!/^\d{10}$/.test(nhsStr)) {
    return input
  }

  return `${nhsStr.slice(0, 3)} ${nhsStr.slice(3, 6)} ${nhsStr.slice(6)}`
}

// Example usage:
// formatNhsNumber('4857773456') // returns '485 777 3456'
// formatNhsNumber(4857773456)   // returns '485 777 3456'
// formatNhsNumber('485 777 3456') // returns '485 777 3456'

/**
 * Make a word plural based on a count
 *
 * @param {string} word - Word to pluralise
 * @param {...*} args - Additional arguments (e.g. count) passed to pluralise
 * @returns {string} Pluralized word
 * @example
 * pluralise('cat') // returns 'cats'
 * pluralise('cat', 1) // returns 'cat'
 * pluralise('cat', '2') // returns 'cats'
 */
const pluralise = (word, ...args) => {
  if (!word) return ''
  if (typeof word !== 'string') return word

  // Convert first arg to number if it looks like one
  if (args.length && !isNaN(args[0])) {
    args[0] = Number(args[0])
  }

  return pluralizeLib(word, ...args)
}

module.exports = {
  addIndefiniteArticle,
  formatCurrency,
  formatCurrencyForCsv,
  formatNhsNumber,
  formatWords,
  isString,
  camelCase,
  kebabCase,
  snakeCase,
  noWrap,
  asHint,
  asVisuallyHiddenText,
  asAriaHiddenText,
  padDigits,
  possessive,
  sentenceCase,
  slugify,
  split,
  startLowerCase,
  startsWith,
  stringIncludes,
  stringLiteral,
  formatPhoneNumber,
  pluralise
}
