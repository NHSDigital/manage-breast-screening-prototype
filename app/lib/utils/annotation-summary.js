// app/lib/utils/annotation-summary.js

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

  const concernText = getLevelOfConcernText(annotation.levelOfConcern)
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

const getLevelOfConcernText = (levelOfConcern) => {
  if (!levelOfConcern) {
    return ''
  }

  const numericValue = parseInt(levelOfConcern, 10)
  if (!Number.isNaN(numericValue)) {
    const labelMap = {
      1: 'normal',
      2: 'benign',
      3: 'probably benign',
      4: 'probably cancerous',
      5: 'likely cancerous'
    }

    const label = labelMap[numericValue]
    if (label) {
      return `Level ${numericValue} (${label})`
    }

    return `Level ${numericValue}`
  }

  const normalised = String(levelOfConcern).trim().toLowerCase()

  const wordMap = {
    'normal': 'Level 1 (normal)',
    'benign': 'Level 2 (benign)',
    'indeterminate': 'Level 3 (probably benign)',
    'indeterminatef': 'Level 3 (probably benign)',
    'suspicious': 'Level 4 (probably cancerous)',
    'highly suspicious': 'Level 5 (likely cancerous)'
  }

  return wordMap[normalised] || `Level of concern: ${normalised}`
}

module.exports = {
  summariseAnnotation,
  summariseAnnotations
}
