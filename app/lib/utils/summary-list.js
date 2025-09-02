// app/lib/utils/summary-list.js

const _ = require('lodash')

/**
 * Check if a value should be considered empty/missing
 *
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
 *
 * @param {object} input - Summary list object or individual row object
 * @param {boolean} showNotProvidedText - If true, show "Not provided" and keep actions. If false (default), show "Enter X" link
 * @returns {object} Modified summary list or row with enter link or "Not provided" if empty
 */
const handleSummaryListMissingInformation = (
  input,
  showNotProvidedText = false
) => {
  if (!input) return input

  // Helper function to process a single row
  const processRow = (row) => {
    const value = row.value?.text || row.value?.html

    // Check for valid actions - action items should be objects with href or other meaningful properties
    const hasAction =
      row.actions &&
      row.actions.items &&
      row.actions.items.filter(
        (item) => item && typeof item === 'object' && (item.href || item.text)
      ).length > 0

    // If value is not empty, return row as-is
    if (!isEmpty(value)) return row

    // Value is empty - always show something
    if (hasAction && !showNotProvidedText) {
      // Default behavior - show "Enter X" link and remove actions
      const keyText =
        row.actions?.items?.[0]?.visuallyHiddenText ||
        row.key.text.toLowerCase()
      const href = row.actions?.items?.[0]?.href || '#'

      const endText = keyText.endsWith('notes') ? '' : ' details'

      return {
        ...row,
        value: {
          html: `<a href="${href}" class="nhsuk-link">Enter ${keyText}${endText}</a>`
        },
        actions: {
          items: []
        }
      }
    } else {
      // Show "Not provided" - either because showNotProvidedText is true OR there are no actions
      return {
        ...row,
        value: {
          html: `<span class="app-text-grey">Not provided</span>`
        }
        // Keep existing actions if they exist (for showNotProvidedText case)
      }
    }
  }

  // Check if input is a summary list (has rows property)
  if (input.rows && Array.isArray(input.rows)) {

    // Filter out empty rows before processing
    const validRows = input.rows.filter(row =>
      row && typeof row === 'object' && row.key
    )

    const updatedRows = validRows.map(processRow)

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
