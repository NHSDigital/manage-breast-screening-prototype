// app/lib/utils/summary-list.js

const _ = require('lodash')

/**
 * Check if a value should be considered empty/missing
 * @param {any} value - Value to check
 * @returns {boolean} True if value should be considered empty
 */
const isEmpty = (value) => {
  if (_.isString(value)) {
    return value.trim() === '' || value.toLowerCase() === 'incomplete'
  }
  return value === null || value === undefined
}

/**
 * Convert value object to "Enter X" link if empty, or show "Not provided"
 * @param {Object} input - Summary list object or individual row object
 * @param {boolean} showNotProvidedText - If true, show "Not provided" and keep actions. If false (default), show "Enter X" link
 * @returns {Object} Modified summary list or row with enter link or "Not provided" if empty
 */
const handleSummaryListMissingInformation = (input, showNotProvidedText = false) => {
  if (!input) return input

  // Helper function to process a single row
  const processRow = (row) => {
    const value = row.value?.text || row.value?.html
    const hasAction = row.actions && row.actions.items && row.actions.items.length > 0

    // If value is not empty or there are no existing actions, return row as is
    if (!isEmpty(value) || !hasAction) return row

    if (showNotProvidedText) {
      // Show "Not provided" in grey and keep actions
      return {
        ...row,
        value: {
          html: `<span class="app-text-grey">Not provided</span>`
        }
        // Keep existing actions
      }
    } else {
      // Default behavior - show "Enter X" link and remove actions
      const keyText = row.actions?.items?.[0]?.visuallyHiddenText || row.key.text.toLowerCase()
      const href = row.actions?.items?.[0]?.href || '#'

      return {
        ...row,
        value: {
          html: `<a href="${href}" class="nhsuk-link">Enter ${keyText} details</a>`
        },
        actions: {
          items: []
        }
      }
    }
  }

  // Check if input is a summary list (has rows property)
  if (input.rows && Array.isArray(input.rows)) {
    const updatedRows = input.rows.map(processRow)

    return {
      ...input,
      rows: updatedRows
    }
  }

  // Otherwise treat as single row object
  return processRow(input)
}


module.exports = {
  handleSummaryListMissingInformation
}