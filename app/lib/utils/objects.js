// app/lib/utils/objects.js

/**
 * Extract all values from an object into a flat array
 *
 * @param {object} obj - The object to extract values from
 * @param {object} [options] - Options for value extraction
 * @param {boolean} [options.recursive] - Whether to recursively extract values from nested objects
 * @param {boolean} [options.includeArrays] - Whether to include array values
 * @param {boolean} [options.removeEmpty] - Whether to remove null/undefined values
 * @returns {Array} Array of all values from the object
 * @example
 * getObjectValues({ name: 'Jane', age: 30 }) // Returns ['Jane', 30]
 * getObjectValues({ user: { name: 'Jane' }}, { recursive: true }) // Returns ['Jane']
 */
const getObjectValues = (obj, options = {}) => {
  const {
    recursive = false,
    includeArrays = true,
    removeEmpty = false
  } = options

  if (!obj || typeof obj !== 'object') {
    return []
  }

  // Get initial values
  let values = Object.values(obj)

  if (recursive) {
    values = values.reduce((acc, val) => {
      // If value is an object, recursively get its values
      if (val && typeof val === 'object' && !Array.isArray(val)) {
        return [...acc, ...getObjectValues(val, options)]
      }
      return [...acc, val]
    }, [])
  }

  // Handle arrays based on options
  if (!includeArrays) {
    values = values.filter((val) => !Array.isArray(val))
  }

  // Remove empty values if specified
  if (removeEmpty) {
    values = values.filter((val) => Boolean(val))
  }

  return values
}

module.exports = {
  getObjectValues
}
