// app/filters/nunjucks.js

const { safe: nunjucksSafe } = require('nunjucks/src/filters')

const log = (a, description = null) => {
  if (description) {
    description = `console.log("${description}:");`
  }

  return nunjucksSafe(
    `<script>${description || ''}console.log(${JSON.stringify(a, null, '\t')});</script>`
  )
}

/**
 * Safely join array elements with proper undefined/null handling
 *
 * @param {any} input - Array-like input to join
 * @param {string} [delimiter] - String to use as delimiter between elements
 * @param {string | null} [attribute] - Optional object property to extract before joining
 * @param {object} [options] - Additional options for join behavior
 * @param {boolean} [options.filterEmpty] - Whether to filter out empty/null/undefined values
 * @param {boolean} [options.toString] - Whether to convert values to strings before joining
 * @returns {string} Joined string or empty string if invalid input
 * @example
 * join(['a', 'b', 'c'], ', ') // 'a, b, c'
 * join([{name: 'John'}, {name: 'Jane'}], ', ', 'name') // 'John, Jane'
 * join(['a', null, 'b'], ', ') // 'a, b' (filters nulls by default)
 * join(null) // ''
 * join(undefined) // ''
 */
const join = (input, delimiter = '', attribute = null, options = {}) => {
  const { filterEmpty = true, toString = true } = options

  // Handle null, undefined, or non-array inputs
  if (!input) {
    return ''
  }

  // Convert to array if it's array-like but not an array
  let array
  if (Array.isArray(input)) {
    array = input
  } else if (input.length !== undefined) {
    // Array-like object (NodeList, etc.)
    array = Array.from(input)
  } else {
    // Single value, wrap in array
    array = [input]
  }

  // Extract attribute values if specified
  if (attribute) {
    array = array.map((item) => {
      if (!item || typeof item !== 'object') {
        return undefined
      }
      return item[attribute]
    })
  }

  // Filter out empty values if requested
  if (filterEmpty) {
    array = array.filter((item) => {
      return (
        item !== null &&
        item !== undefined &&
        item !== '' &&
        (!toString || String(item).trim() !== '')
      )
    })
  }

  // Convert to strings if requested
  if (toString) {
    array = array.map((item) => {
      if (item === null || item === undefined) {
        return ''
      }
      return String(item)
    })
  }

  return array.join(delimiter)
}

/**
 * Get user name by user ID with format options
 *
 * @param {string} userId - ID of the user
 * @param {object} [options] - Display options
 * @param {boolean} [options.identifyCurrentUser] - Whether to add "(you)" for current user
 * @param {string} [options.format] - Name format: 'full', 'short', or 'initial'
 * @returns {string} User's name in requested format
 */
const getUsername = function (userId, options = {}) {
  if (!userId) return ''

  const users = this.ctx.data.users
  if (!users) return userId

  const user = users.find((u) => u.id === userId)
  if (!user) return userId

  // Format options: full (default), short (initial + surname), initial (just initials)
  const format = options.format || 'full'

  let formattedName
  switch (format) {
    case 'short':
      formattedName = `${user.firstName.charAt(0)}. ${user.lastName}`
      break
    case 'initial':
      formattedName = `${user.firstName.charAt(0)}${user.lastName.charAt(0)}`
      break
    case 'full':
    default:
      formattedName = `${user.firstName} ${user.lastName}`
  }

  const currentUser = this.ctx.data.currentUser
  if (options.identifyCurrentUser && user.id === currentUser.id) {
    return `${formattedName} (you)`
  }

  return formattedName
}

/**
 *
 * @returns {object} The context data
 */
const getContext = function () {
  return this.ctx
}

/**
 * Safely parse a JSON string and return the resulting object, or return structured data as-is
 * @param {*} value - The value to parse (string) or return (object/array)
 * @returns {*} The parsed object, original structured data, or null if parsing failed
 */
function parseJsonString(value)
{
  // Handle null, undefined, or empty string
  if (value === null || value === undefined || value === '')
  {
    return null
  }

  // If it's already structured data (object or array), return it as-is
  if (typeof value === 'object')
  {
    return value
  }

  // If it's not a string, convert to string first (for numbers, booleans, etc.)
  if (typeof value !== 'string')
  {
    value = String(value)
  }

  // Only attempt JSON.parse on strings
  try
  {
    return JSON.parse(value)
  }
  catch (error)
  {
    console.warn('Failed to parse JSON string:', value, error)
    return null
  }
}

module.exports = {
  log,
  join,
  getUsername,
  parseJsonString,
  getContext
}
