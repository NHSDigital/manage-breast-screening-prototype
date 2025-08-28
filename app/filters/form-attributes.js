// app/filters/form-attributes.js

const _ = require('lodash')

/**
 * Decorate attributes
 * Add name, value, id, idPrefix and checked attributes to NHSUK form components
 * Generate the attributes based on the application ID and the section they're in
 *
 * @param {Object} originalObject - The original component configuration
 * @param {Object} data - The data object to extract values from
 * @param {string} path - Path to the data property (e.g. "data.nationality")
 * @returns {Object} The decorated component configuration
 *
 * @example
 * {{ nhsukCheckboxes({
 *   fieldset: {
 *     legend: {
 *       text: "Nationality",
 *       classes: "nhsuk-fieldset__legend--s"
 *     }
 *   },
 *   items: [
 *     {
 *       text: "British"
 *     },
 *     {
 *       text: "Irish"
 *     },
 *     {
 *       text: "Other"
 *     }
 *   ]
 * } | decorateAttributes(data, "data.nationality"))}}
 */
const decorateAttributes = (originalObject, data, path) => {
  // Deep clone to avoid modifying the original object
  const obj = _.cloneDeep(originalObject)

  // Map dot or bracket notation to path parts
  const pathParts = _.toPath(path)

  // Remove the first part of the path which we don't need for reading data
  // e.g. "event.medicalData.hrt" > "medicalData.hrt"
  let dataPath = [...pathParts].slice(1)

  // The path we use for saving should have the first part, unless it starts with 'data'
  // e.g. "event.medicalData.hrt" > "event.medicalData.hrt"
  // e.g. "data.nationality" > "nationality"
  let pathForSaving = pathParts
  if (pathForSaving[0] === 'data') {
    pathForSaving = pathParts.slice(1)
  }

  // Get the stored value from data
  const storedValue = _.get(data, dataPath)

  if (obj.items !== undefined) {
    obj.items = obj.items.map((item) => {
      // Skip dividers
      if (item.divider) return item

      // Set default value to text if not provided
      if (typeof item.value === 'undefined') {
        item.value = item.text
      }

      // Default checked/selected states when no data exists
      let checked = item.checked
      let selected = item.selected

      // Only process if we have a stored value to compare against
      if (storedValue !== undefined) {
        // For array values (like checkboxes)
        if (Array.isArray(storedValue)) {
          if (storedValue.includes(item.value)) {
            checked = 'checked'
            selected = 'selected'
          } else {
            // Clear any default checked state when we have data
            checked = ''
            selected = ''
          }
        } else {
          // For single values (like radios)
          if (storedValue === item.value) {
            checked = 'checked'
            selected = 'selected'
          } else {
            // Clear any default checked state when we have data
            checked = ''
            selected = ''
          }
        }
      }

      // Assign the computed values
      item.checked = checked
      item.selected = selected

      return item
    })

    // Set idPrefix if not already defined
    obj.idPrefix = obj.idPrefix || pathParts.join('-')
  } else {
    // For non-array components (like text inputs),
    // set the value if not already defined
    if (typeof obj.value === 'undefined') {
      obj.value = storedValue
    }
  }

  // Set id and name attributes if not already defined
  obj.id = obj.id || pathParts.join('-')
  obj.name = obj.name || pathParts.map((s) => `[${s}]`).join('')
  return obj
}

module.exports = {
  decorateAttributes
}
