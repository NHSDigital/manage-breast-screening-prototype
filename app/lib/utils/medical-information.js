// app/lib/utils/medical-information.js

const medicalHistoryTypes = require('../../data/medical-history-types')
const { startLowerCase } = require('./strings')

/**
 * Check whether a string names a medical history type, by type or slug
 *
 * @param {string} type - camelCase type or kebab-case slug
 * @returns {boolean} Whether it matches a known medical history type
 */
const isValidMedicalHistoryType = (type) => {
  return medicalHistoryTypes.some(
    (item) => item.type === type || item.slug === type
  )
}

/**
 * Get a medical history type object, by type or slug
 *
 * @param {string} type - camelCase type or kebab-case slug
 * @returns {Object | undefined} The medical history type object
 */
const getMedicalHistoryType = (type) => {
  return (
    medicalHistoryTypes.find((item) => item.type === type) ||
    medicalHistoryTypes.find((item) => item.slug === type)
  )
}

/**
 * Get the camelCase data key for a medical history type from its slug
 *
 * @param {string} slug - kebab-case slug
 * @returns {string | null} The camelCase type, or null if not found
 */
const getMedicalHistoryKeyFromSlug = (slug) => {
  const item = medicalHistoryTypes.find((item) => item.slug === slug)
  return item ? item.type : null
}

/**
 * Summarise a single medical history item into a concise string
 *
 * @param {Object} item - The medical history item (must have medicalHistoryType property)
 * @returns {string} A summary string like "Breast cancer (2016)" or "Implanted cardiac device (2018)"
 */
const summariseMedicalHistoryItem = (item) => {
  if (!item || !item.medicalHistoryType) {
    return ''
  }

  // Get the type name from the medical history types data
  const typeData = medicalHistoryTypes.find(
    (t) => t.type === item.medicalHistoryType
  )
  const typeName = typeData ? typeData.name : item.medicalHistoryType

  // Build the summary based on type
  let summary = typeName

  // Add specific details for certain types
  switch (item.medicalHistoryType) {
    case 'implantedMedicalDevice':
      // Format as "Implanted [device type]" instead of "Implanted medical device ([device type])"
      if (item.type) {
        const deviceType = Array.isArray(item.type) ? item.type[0] : item.type
        // Keep proper nouns capitalised (Hickman line)
        const formattedDeviceType = deviceType
          .toLowerCase()
          .replace('hickman', 'Hickman')
        summary = `Implanted ${formattedDeviceType}`
        if (item.year) {
          summary += ` (${item.year}`
          if (item.deviceRemoved === 'Yes' || item.yearRemoved) {
            summary += `, removed`
            if (item.yearRemoved) {
              summary += ` ${item.yearRemoved}`
            }
          }
          summary += ')'
        } else if (item.deviceRemoved === 'Yes' || item.yearRemoved) {
          summary += ' (removed'
          if (item.yearRemoved) {
            summary += ` ${item.yearRemoved}`
          }
          summary += ')'
        }
        return summary
      }
      break

    case 'breastImplantsAugmentation':
      // Be specific about what procedures were done, and which breast(s)
      const rightProcedures = item.proceduresRightBreast || []
      const leftProcedures = item.proceduresLeftBreast || []
      const hasRightImplants =
        rightProcedures.includes && rightProcedures.includes('Breast implants')
      const hasLeftImplants =
        leftProcedures.includes && leftProcedures.includes('Breast implants')
      const hasRightAugmentation =
        rightProcedures.includes &&
        rightProcedures.includes('Other augmentation')
      const hasLeftAugmentation =
        leftProcedures.includes && leftProcedures.includes('Other augmentation')

      // Build a description that names each procedure with its side(s)
      const implantParts = []
      const augParts = []

      if (hasRightImplants && hasLeftImplants) {
        implantParts.push('Breast implants, both breasts')
      } else if (hasRightImplants) {
        implantParts.push('Breast implants, right breast')
      } else if (hasLeftImplants) {
        implantParts.push('Breast implants, left breast')
      }

      if (hasRightAugmentation && hasLeftAugmentation) {
        augParts.push('other augmentation, both breasts')
      } else if (hasRightAugmentation) {
        augParts.push('other augmentation, right breast')
      } else if (hasLeftAugmentation) {
        augParts.push('other augmentation, left breast')
      }

      // When both procedures are on the same side(s), combine into one phrase
      let procedureType = ''
      if (implantParts.length && augParts.length) {
        // Different procedures — list separately with "and"
        procedureType = implantParts[0] + ' and ' + augParts[0]
      } else if (implantParts.length) {
        procedureType = implantParts[0]
      } else if (augParts.length) {
        // Capitalise when augmentation is the only procedure
        procedureType = augParts[0].charAt(0).toUpperCase() + augParts[0].slice(1)
      } else {
        procedureType = typeName
      }

      summary = procedureType

      // implantsRemoved is stored as an array from checkboxes
      const isImplantsRemoved = Array.isArray(item.implantsRemoved)
        ? item.implantsRemoved.length > 0
        : Boolean(item.implantsRemoved)

      // Build parenthetical details
      const implantDetails = []
      if (item.year) implantDetails.push(item.year)
      if (isImplantsRemoved || item.yearRemoved) {
        if (item.yearRemoved) {
          implantDetails.push(`removed ${item.yearRemoved}`)
        } else {
          implantDetails.push('removed')
        }
      }
      if (implantDetails.length) {
        summary += ` (${implantDetails.join(', ')})`
      }
      return summary

    case 'mastectomyLumpectomy':
      // Be specific about what procedures were done
      const rightProc = item.proceduresRightBreast
      const leftProc = item.proceduresLeftBreast
      const hasRightMastectomy =
        rightProc &&
        (rightProc.includes('Mastectomy (tissue remaining)') ||
          rightProc.includes('Mastectomy (no tissue remaining)'))
      const hasLeftMastectomy =
        leftProc &&
        (leftProc.includes('Mastectomy (tissue remaining)') ||
          leftProc.includes('Mastectomy (no tissue remaining)'))
      const hasRightLumpectomy = rightProc && rightProc.includes('Lumpectomy')
      const hasLeftLumpectomy = leftProc && leftProc.includes('Lumpectomy')

      let procType = ''
      if (
        (hasRightMastectomy || hasLeftMastectomy) &&
        (hasRightLumpectomy || hasLeftLumpectomy)
      ) {
        procType = 'Mastectomy and lumpectomy'
      } else if (hasRightMastectomy || hasLeftMastectomy) {
        procType = 'Mastectomy'
      } else if (hasRightLumpectomy || hasLeftLumpectomy) {
        procType = 'Lumpectomy'
      } else {
        procType = typeName
      }

      summary = procType
      if (item.year) {
        summary += ` (${item.year})`
      }
      return summary

    case 'cysts':
      // Display as "History of cysts"
      summary = 'History of cysts'
      return summary

    case 'otherProcedures':
      // Add procedure type if available
      if (item.type) {
        const procedureType = Array.isArray(item.type)
          ? item.type[0]
          : item.type
        if (procedureType.startsWith('Other')) {
          // Use the custom details if "Other" was selected
          const details = item.typeOtherDetails || 'other procedure'
          summary = `${typeName} (${details.toLowerCase()}`
        } else {
          summary = `${typeName} (${procedureType.toLowerCase()}`
        }
        if (item.year) {
          summary += `, ${item.year}`
        }
        summary += ')'
        return summary
      }
      break
  }

  // Default format: "Type (year)" or "Type (year unknown)" if no year
  if (item.year) {
    summary = `${typeName} (${item.year})`
  } else {
    summary = `${typeName} (year unknown)`
  }

  return summary
}

/**
 * Summarise all medical history items into an array of summary strings
 *
 * @param {Object} medicalHistory - Object with medical history items grouped by type
 * @returns {Array<string>} Array of summary strings
 */
const summariseMedicalHistory = (medicalHistory) => {
  if (!medicalHistory) {
    return []
  }

  const summaries = []

  // Iterate through each medical history type
  for (const items of Object.values(medicalHistory)) {
    if (Array.isArray(items) && items.length > 0) {
      // Summarise each item
      items.forEach((item) => {
        const summary = summariseMedicalHistoryItem(item)
        if (summary) {
          summaries.push(summary)
        }
      })
    }
  }

  return summaries
}

/**
 * Get all medical history items as a flat array
 *
 * @param {Object} medicalHistory - Object with medical history items grouped by type
 * @returns {Array<Object>} Flat array of all medical history items
 */
const getMedicalHistoryItems = (medicalHistory) => {
  if (!medicalHistory) {
    return []
  }

  const items = []

  for (const itemArray of Object.values(medicalHistory)) {
    if (Array.isArray(itemArray) && itemArray.length > 0) {
      items.push(...itemArray)
    }
  }

  return items
}

/**
 * Count total number of medical history items
 *
 * @param {Object} medicalHistory - Object with medical history items grouped by type
 * @returns {number} Total count of medical history items
 */
const countMedicalHistoryItems = (medicalHistory) => {
  if (!medicalHistory) {
    return 0
  }

  let count = 0

  for (const items of Object.values(medicalHistory)) {
    if (Array.isArray(items)) {
      count += items.length
    }
  }

  return count
}

/**
 * Summarise a single symptom into a concise string
 *
 * Output is lowercase - run through the sentenceCase filter when displaying
 *
 * @param {Object} symptom - The symptom object
 * @returns {string} A summary string like "lump (right breast)" or "nipple change: bloody discharge (both nipples)"
 */
const summariseSymptom = (symptom) => {
  if (!symptom || !symptom.type) {
    return ''
  }

  let summary = startLowerCase(symptom.type)

  // Add sub-type details for specific symptom types
  if (symptom.type === 'Nipple change' && symptom.nippleChangeType) {
    const changeType =
      symptom.nippleChangeType === 'other' && symptom.nippleChangeDescription
        ? symptom.nippleChangeDescription
        : symptom.nippleChangeType
    summary += `, ${changeType}`
  } else if (symptom.type === 'Skin change' && symptom.skinChangeType) {
    const changeType =
      symptom.skinChangeType === 'other' && symptom.skinChangeDescription
        ? symptom.skinChangeDescription
        : symptom.skinChangeType
    summary += `, ${changeType}`
  } else if (symptom.type === 'Other' && symptom.otherDescription) {
    summary = startLowerCase(symptom.otherDescription)
  }

  // Add location
  let location = ''
  if (symptom.type === 'Nipple change' && symptom.nippleChangeLocation) {
    // nippleChangeLocation is an array like ['right nipple'] or ['right nipple', 'left nipple']
    if (
      symptom.nippleChangeLocation.length === 2 ||
      (symptom.nippleChangeLocation.length === 1 &&
        symptom.nippleChangeLocation[0] === 'both nipples')
    ) {
      location = 'both nipples'
    } else if (symptom.nippleChangeLocation.length === 1) {
      location = symptom.nippleChangeLocation[0]
    }
  } else if (symptom.location) {
    // location is an array; derive a human-readable string
    const locArray = Array.isArray(symptom.location) ? symptom.location : [symptom.location]
    const hasRight = locArray.includes('right breast')
    const hasLeft = locArray.includes('left breast')
    const hasOther = locArray.includes('other')
    const locationParts = []

    if (hasRight && hasLeft) {
      locationParts.push('both breasts')
    } else {
      if (hasRight) locationParts.push('right breast')
      if (hasLeft) locationParts.push('left breast')
    }

    if (hasOther) {
      locationParts.push(symptom.otherLocationDescription || 'other location')
    }

    location = locationParts.join(', ')
  }

  if (location) {
    summary += ` (${location})`
  }

  // Flag signs noted by the mammographer rather than reported by the participant
  if (symptom.isMammographerObserved) {
    summary = `sign: ${summary}`
  }

  return summary
}

/**
 * Summarise all symptoms into an array of summary strings
 *
 * @param {Array} symptoms - Array of symptom objects
 * @returns {Array<string>} Array of summary strings
 */
const summariseSymptoms = (symptoms) => {
  if (!symptoms || !Array.isArray(symptoms) || symptoms.length === 0) {
    return []
  }

  return symptoms.map((symptom) => summariseSymptom(symptom)).filter(Boolean)
}

/**
 * Summarise a single breast feature into a concise string
 *
 * @param {Object} feature - The breast feature object
 * @returns {string} A summary string like "Mole (left lower central)" or "Wart (right upper outer)"
 */
const summariseBreastFeature = (feature) => {
  if (!feature || !feature.text) {
    return ''
  }

  // Extract feature type from text (handles "Other: Description" format)
  const featureType = feature.text

  // Region already includes side (e.g., "left upper inner", "pre-sternal")
  if (feature.region) {
    return `${featureType} (${feature.region})`
  }

  return featureType
}

/**
 * Summarise all breast features into an array of summary strings
 *
 * @param {Array} features - Array of breast feature objects
 * @returns {Array<string>} Array of summary strings
 */
const summariseBreastFeatures = (features) => {
  if (!features || !Array.isArray(features) || features.length === 0) {
    return []
  }

  return features
    .map((feature) => summariseBreastFeature(feature))
    .filter(Boolean)
}

/**
 * Read the breast density factors off an appointment's medical information
 *
 * A checkbox group posts a bare string when one box is ticked and an array
 * when several are, so the stored value needs normalising before anything can
 * read it. Doing that here means templates get a single shape to work with
 * rather than repeating the coercion at every call site.
 *
 * @param {Object} medicalInformation - The medicalInformation object from appointment
 * @returns {{factors: Array<string>, hrt: string|undefined, count: number, answeredCount: number, summaries: Array<string>}}
 */
const getBreastDensityFactors = (medicalInformation) => {
  const rawFactors = medicalInformation?.breastDensityFactors
  const factors = Array.isArray(rawFactors)
    ? rawFactors.filter(Boolean)
    : rawFactors
      ? [rawFactors]
      : []

  const hrt = medicalInformation?.breastDensityFactorsHrt

  // "Not started HRT" is an answer, but it isn't a density factor - only
  // count the things that actually affect density
  const count =
    (hrt === 'yes' ? 1 : 0) +
    (factors.includes('pregnant') ? 1 : 0) +
    (factors.includes('breastfeeding') ? 1 : 0)

  const summaries = summariseBreastDensityFactors(medicalInformation)

  return {
    factors,
    hrt,
    count,
    // Everything worth showing, including a recorded "no" to HRT question - use this
    // to decide whether to show the row at all, and count for "n added"
    answeredCount: summaries.length,
    summaries
  }
}

/**
 * Summarise breast density factors into an array of summary strings
 *
 * @param {Object} medicalInformation - The medicalInformation object from appointment
 * @returns {Array<string>} Array of summary strings
 */
const summariseBreastDensityFactors = (medicalInformation) => {
  const rawFactors = medicalInformation?.breastDensityFactors
  const factors = Array.isArray(rawFactors)
    ? rawFactors.filter(Boolean)
    : rawFactors
      ? [rawFactors]
      : []

  const hrt = medicalInformation?.breastDensityFactorsHrt

  const summaries = []

  if (hrt === 'yes') {
    summaries.push('Started a course of HRT since last screening appointment')
  } else if (hrt === 'no') {
    summaries.push('Not started a course of HRT since last screening appointment')
  }

  if (factors.includes('pregnant')) {
    summaries.push('Pregnant')
  }

  if (factors.includes('breastfeeding')) {
    summaries.push('Breastfeeding')
  }

  return summaries
}

/**
 * Summarise the free-text other medical information, truncating if long
 *
 * @param {Object} medicalInformation - The medicalInformation object from appointment
 * @returns {string|null} Summary string, or null if there's nothing recorded
 */
const summariseOtherMedicalInformation = (medicalInformation) => {
  const otherInfo = medicalInformation?.otherMedicalInformation?.trim()

  if (!otherInfo) {
    return null
  }

  return otherInfo.length > 100 ? otherInfo.substring(0, 100) + '...' : otherInfo
}

module.exports = {
  isValidMedicalHistoryType,
  getMedicalHistoryType,
  getMedicalHistoryKeyFromSlug,
  summariseMedicalHistoryItem,
  summariseMedicalHistory,
  getMedicalHistoryItems,
  countMedicalHistoryItems,
  summariseSymptom,
  summariseSymptoms,
  summariseBreastFeature,
  summariseBreastFeatures,
  getBreastDensityFactors,
  summariseBreastDensityFactors,
  summariseOtherMedicalInformation
}
