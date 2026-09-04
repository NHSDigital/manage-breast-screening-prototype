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
      const hasRightNotKnown =
        rightProcedures.includes && rightProcedures.includes('Not known')
      const hasLeftNotKnown =
        leftProcedures.includes && leftProcedures.includes('Not known')

      // Build a description that names each procedure with its side(s)
      const implantParts = []
      const augParts = []
      const notKnownParts = []

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

      if (hasRightNotKnown && hasLeftNotKnown) {
        notKnownParts.push('procedure not known, both breasts')
      } else if (hasRightNotKnown) {
        notKnownParts.push('procedure not known, right breast')
      } else if (hasLeftNotKnown) {
        notKnownParts.push('procedure not known, left breast')
      }

      // Sort: both breasts first, then right, then left
      const allProcParts = [...implantParts, ...augParts, ...notKnownParts]
      allProcParts.sort((a, b) => {
        const sideOrder = (s) =>
          s.includes('both breasts') ? 0 : s.includes('right breast') ? 1 : 2
        return sideOrder(a) - sideOrder(b)
      })
      let procedureType = ''
      if (allProcParts.length > 0) {
        // Capitalise the first part
        allProcParts[0] = allProcParts[0].charAt(0).toUpperCase() + allProcParts[0].slice(1)
        procedureType = allProcParts.join(' and ')
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

// Pregnancy and breastfeeding options, in display order. The stored value and
// the label shown back to the user come from here, so the form and every
// summary can never drift apart.
const pregnancyAndBreastfeedingOptions = [
  {
    value: 'currently-pregnant',
    text: 'Currently pregnant'
  },
  {
    value: 'currently-breastfeeding',
    text: 'Currently breastfeeding'
  },
  {
    divider: 'or'
  },
  {
    value: 'stopped-less-than-3-months',
    text: 'Pregnancy or breastfeeding stopped less than 3 months ago',
    behaviour: 'exclusive'
  }
]

/**
 * Normalise a checkbox group's stored value to an array
 *
 * A checkbox group posts a bare string when one box is ticked and an array
 * when several are, so the stored value needs coercing before anything can
 * read it.
 *
 * @param {*} value - The stored value
 * @returns {Array<string>} The value as an array, empty if nothing is stored
 */
const toCheckboxArray = (value) => {
  if (Array.isArray(value)) {
    return value.filter(Boolean)
  }

  return value ? [value] : []
}

/**
 * Read the breast density factors off an appointment's medical information
 *
 * Breast density factors are a display grouping rather than a stored object -
 * they pull together the separately stored HRT answer and pregnancy and
 * breastfeeding answers. Reading them here means templates get a single shape
 * to work with rather than repeating the coercion at every call site.
 *
 * @param {Object} medicalInformation - The medicalInformation object from appointment
 * @returns {{factors: Array<string>, hrt: Object, count: number, answeredCount: number, summaries: Array<string>, factorSummaries: Array<string>, options: Array<Object>}}
 */
const getBreastDensityFactors = (medicalInformation) => {
  const factors = toCheckboxArray(medicalInformation?.pregnancyAndBreastfeeding)
  const hrt = medicalInformation?.hrt || {}

  const summaries = summariseBreastDensityFactors(medicalInformation)

  return {
    factors,
    hrt,
    // "Not taking HRT" is an answer, but it isn't a density factor - only
    // count the things that actually affect density
    count: (hrt.status === 'yes' ? 1 : 0) + factors.length,
    // Everything worth showing, including a recorded "no" to the HRT question -
    // use this to decide whether to show the row at all
    answeredCount: summaries.length,
    summaries,
    factorSummaries: summarisePregnancyAndBreastfeeding(medicalInformation),
    hrtSummary: summariseHrt(medicalInformation),
    options: pregnancyAndBreastfeedingOptions
  }
}

/**
 * Summarise the pregnancy and breastfeeding answers into an array of labels
 *
 * @param {Object} medicalInformation - The medicalInformation object from appointment
 * @returns {Array<string>} Array of summary strings
 */
const summarisePregnancyAndBreastfeeding = (medicalInformation) => {
  const factors = toCheckboxArray(medicalInformation?.pregnancyAndBreastfeeding)

  // Both at once reads better as one line than as two
  if (
    factors.includes('currently-pregnant') &&
    factors.includes('currently-breastfeeding')
  ) {
    return ['Currently pregnant and breastfeeding']
  }

  return pregnancyAndBreastfeedingOptions
    .filter((option) => option.value && factors.includes(option.value))
    .map((option) => option.text)
}

/**
 * Summarise breast density factors into an array of summary strings
 *
 * @param {Object} medicalInformation - The medicalInformation object from appointment
 * @returns {Array<string>} Array of summary strings
 */
const summariseBreastDensityFactors = (medicalInformation) => {
  const hrtSummary = summariseHrt(medicalInformation)

  return (hrtSummary ? [hrtSummary] : []).concat(
    summarisePregnancyAndBreastfeeding(medicalInformation)
  )
}

/**
 * Summarise the HRT answer, including the year if one was recorded
 *
 * @param {Object} medicalInformation - The medicalInformation object from appointment
 * @returns {string|null} Summary string, or null if the question wasn't answered
 */
const summariseHrt = (medicalInformation) => {
  const hrt = medicalInformation?.hrt || {}

  // The year fields only ever ask for an approximate year, so the summaries
  // say so rather than reading as an exact date
  if (hrt.status === 'yes') {
    return hrt.yearStarted
      ? `Currently taking HRT (approximate start: ${hrt.yearStarted})`
      : 'Currently taking HRT'
  }

  if (hrt.status === 'no') {
    return hrt.yearStopped
      ? `Not currently taking HRT (approximate stop: ${hrt.yearStopped})`
      : 'Not currently taking HRT'
  }

  return null
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
  summarisePregnancyAndBreastfeeding,
  summariseHrt,
  summariseOtherMedicalInformation
}
