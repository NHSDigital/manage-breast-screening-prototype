// app/lib/utils/arrays.js

const _ = require('lodash')

/**
 * Find an object by ID in an array
 *
 * @param {Array} array - Array to search
 * @param {string} id - ID to find
 * @returns {object} Found object or undefined
 */
const findById = (array, id) => {
  if (!array || !Array.isArray(array)) return undefined
  return array.find((item) => item.id === id)
}

const push = (array, item) => {
  const newArray = [...array]
  newArray.push(_.cloneDeep(item)) // clone needed to stop this mutating original
  return newArray
}

/**
 * Check if an array includes a value
 *
 * @param {Array} array - Array to check
 * @param {*} value - Value to look for
 * @returns {boolean} True if array includes value, false otherwise
 */
const includes = (array, value) => {
  if (!array || !Array.isArray(array)) return false
  return array.includes(value)
}

/**
 * Find first array item where the specified key matches the value
 *
 * @param {Array} array - Array to search
 * @param {string} key - Object key to match against
 * @param {any} value - Value to find
 * @returns {any} First matching item or undefined
 * @example
 * const users = [{id: 1, name: 'Alice'}, {id: 2, name: 'Bob'}]
 * find(users, 'name', 'Bob') // Returns {id: 2, name: 'Bob'}
 */
const find = (array, key, value) => {
  if (!array || !Array.isArray(array)) return undefined
  return array.find((item) => item[key] === value)
}

/**
 * Remove empty items from arrays or strings
 *
 * @param {Array|string} items - Items to filter
 * @returns {Array|string|undefined} Filtered items or undefined if empty
 */
const removeEmpty = (items) => {
  if (!items) return

  if (_.isString(items)) {
    return items.trim() || undefined
  }

  if (_.isArray(items)) {
    const filtered = items.filter((item) => {
      // Filter out falsy values and empty strings
      if (!item || item === '') return false

      // Filter out empty objects
      if (
        _.isObject(item) &&
        !_.isArray(item) &&
        Object.keys(item).length === 0
      )
        return false

      // Filter out empty arrays
      if (_.isArray(item) && item.length === 0) return false

      return true
    })
    return filtered.length ? filtered : undefined
  }
}

/**
 * Filter array to items where the specified property matches one of the comparison values
 *
 * @param {Array} array - Array to filter
 * @param {string} key - Object property path to match against (supports dot notation)
 * @param {*|Array} compare - Value or array of values to match
 * @returns {Array} Filtered array containing only matching items
 * @example
 * where([{type: 'dog'}, {type: 'cat'}], 'type', 'dog') // Returns [{type: 'dog'}]
 * where(users, 'address.postcode', ['OX1', 'OX2']) // Returns users with matching postcodes
 */
const where = (array, key, compare) => {
  if (!array || !Array.isArray(array)) return []

  // Force comparison value to array
  const compareValues = Array.isArray(compare) ? compare : [compare]

  return array.filter((item) => {
    const value = _.get(item, key)
    return compareValues.includes(value)
  })
}

/**
 * Filter array to remove items where the specified property matches one of the comparison values
 *
 * @param {Array} array - Array to filter
 * @param {string} key - Object property path to match against (supports dot notation)
 * @param {*|Array} compare - Value or array of values to exclude
 * @returns {Array} Filtered array with matching items removed
 * @example
 * removeWhere([{type: 'dog'}, {type: 'cat'}], 'type', 'dog') // Returns [{type: 'cat'}]
 * removeWhere(users, 'status', ['inactive', 'suspended']) // Returns only active users
 */
const removeWhere = (array, key, compare) => {
  if (!array || !Array.isArray(array)) return []

  // Force comparison value to array
  const compareValues = Array.isArray(compare) ? compare : [compare]

  return array.filter((item) => {
    const value = _.get(item, key)
    return !compareValues.includes(value)
  })
}

/**
 * Apply a filter to each element in an array
 *
 * @param {Array} array - Array to map over
 * @param {string} filterName - Name of the filter to apply to each element
 * @returns {Array} New array with filter applied to each element
 */
const map = function (array, filterName) {
  if (!array || !Array.isArray(array)) return []

  // In Nunjucks filter context, 'this' gives us access to the environment
  // and we can access other filters through the environment
  const env = this.env

  if (!env || !env.filters || !env.filters[filterName]) {
    console.warn(`Filter '${filterName}' not found`)
    return array
  }

  const filterFunction = env.filters[filterName]

  return array.map((item) => filterFunction.call(this, item))
}

module.exports = {
  push,
  includes,
  find,
  removeEmpty,
  findById,
  where,
  removeWhere,
  map
}
