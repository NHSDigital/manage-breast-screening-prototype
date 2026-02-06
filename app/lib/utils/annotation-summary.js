// app/lib/utils/annotation-summary.js

/**
 * Map level of concern number to its label
 * @param {string|number} level - The level (1-5)
 * @returns {string} The label (e.g., "indeterminate") or empty string if invalid
 */
const levelOfConcernLabel = (level) => {
  const labels = {
    1: 'normal',
    2: 'benign',
    3: 'indeterminate',
    4: 'suspicious',
    5: 'highly suspicious'
  }
  const num = parseInt(level, 10)
  return labels[num] || ''
}

/**
 * Format level of concern as "Level X (label)"
 * @param {string|number} level - The level (1-5)
 * @returns {string} Formatted string (e.g., "Level 3 (indeterminate)") or empty string if invalid
 */
const formatLevelOfConcern = (level) => {
  const num = parseInt(level, 10)
  if (Number.isNaN(num) || num < 1 || num > 5) {
    return ''
  }
  const label = levelOfConcernLabel(num)
  return `Level ${num} (${label})`
}

/**
 * Build a concise one-line summary for a single annotation
 *
 * @param {Object} annotation - The annotation object
 * @returns {string} Summary string
 */
const summariseAnnotation = (annotation) => {
  if (!annotation) {
    return ''
  }

  const abnormalityTypes = Array.isArray(annotation.abnormalityType)
    ? annotation.abnormalityType
    : annotation.abnormalityType
      ? [annotation.abnormalityType]
      : []

  const typeText = getAbnormalityTypeText(abnormalityTypes, annotation)
  const detailParts = []

  const concernText = formatLevelOfConcern(annotation.levelOfConcern)
  if (concernText) {
    detailParts.push(concernText)
  }

  if (annotation.location) {
    detailParts.push(annotation.location)
  }

  if (annotation.comment) {
    detailParts.push(`Comment: ${annotation.comment}`)
  }

  if (detailParts.length > 0) {
    return `${typeText} – ${detailParts.join(' – ')}`
  }

  return typeText
}

/**
 * Summarise a list of annotations into one-line strings
 *
 * @param {Array<Object>} annotations - Array of annotations
 * @returns {Array<string>} Array of summary strings
 */
const summariseAnnotations = (annotations) => {
  if (!annotations || !Array.isArray(annotations) || annotations.length === 0) {
    return []
  }

  return annotations
    .map((annotation) => summariseAnnotation(annotation))
    .filter(Boolean)
}

const getAbnormalityTypeText = (abnormalityTypes, annotation) => {
  if (!abnormalityTypes || abnormalityTypes.length === 0) {
    return 'Abnormality'
  }

  const mappedTypes = abnormalityTypes.map((type) => {
    if (type === 'Other' && annotation.otherDetails) {
      return annotation.otherDetails
    }

    return type
  })

  return mappedTypes.join(', ')
}

module.exports = {
  levelOfConcernLabel,
  formatLevelOfConcern,
  summariseAnnotation,
  summariseAnnotations
}
