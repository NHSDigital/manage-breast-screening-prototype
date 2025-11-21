// app/lib/utils/medical-information.js

const medicalHistoryTypes = require('../../data/medical-history-types')

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
      // Be specific about what procedures were done
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

      let procedureType = ''
      if (
        (hasRightImplants || hasLeftImplants) &&
        (hasRightAugmentation || hasLeftAugmentation)
      ) {
        procedureType = 'Breast implants and augmentation'
      } else if (hasRightImplants || hasLeftImplants) {
        procedureType = 'Breast implants'
      } else if (hasRightAugmentation || hasLeftAugmentation) {
        procedureType = 'Breast augmentation'
      } else {
        procedureType = typeName
      }

      summary = procedureType

      // Check if implants were removed
      if (item.implantsRemoved === 'Yes' || item.yearRemoved) {
        if (item.year) {
          summary += ` (${item.year}, removed`
          if (item.yearRemoved) {
            summary += ` ${item.yearRemoved}`
          }
          summary += ')'
        } else {
          summary += ' (removed'
          if (item.yearRemoved) {
            summary += ` ${item.yearRemoved}`
          }
          summary += ')'
        }
      } else if (item.year) {
        summary += ` (${item.year})`
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
 * @param {Object} symptom - The symptom object
 * @returns {string} A summary string like "Lump (right breast)" or "Nipple change: bloody discharge (both nipples)"
 */
const summariseSymptom = (symptom) => {
  if (!symptom || !symptom.type) {
    return ''
  }

  let summary = symptom.type

  // Add sub-type details for specific symptom types
  if (symptom.type === 'Nipple change' && symptom.nippleChangeType) {
    const changeType =
      symptom.nippleChangeType === 'other' && symptom.nippleChangeDescription
        ? symptom.nippleChangeDescription
        : symptom.nippleChangeType
    summary += `: ${changeType}`
  } else if (symptom.type === 'Skin change' && symptom.skinChangeType) {
    const changeType =
      symptom.skinChangeType === 'other' && symptom.skinChangeDescription
        ? symptom.skinChangeDescription
        : symptom.skinChangeType
    summary += `: ${changeType}`
  } else if (symptom.type === 'Other' && symptom.otherDescription) {
    summary = symptom.otherDescription
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
    location = symptom.location
  }

  if (location) {
    summary += ` (${location})`
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

  // Build location string
  let location = ''
  if (feature.side && feature.region) {
    // Format: "side region" (e.g., "left lower central", "right upper outer")
    if (feature.side === 'center') {
      location = feature.region
    } else {
      location = `${feature.side} ${feature.region}`
    }
  }

  // Combine feature type and location
  if (location) {
    return `${featureType} (${location})`
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
 * Summarise other relevant medical information (HRT, pregnancy/breastfeeding, other info)
 *
 * @param {Object} medicalInformation - The medicalInformation object from event
 * @returns {Array<string>} Array of summary strings
 */
const summariseOtherRelevantInformation = (medicalInformation) => {
  if (!medicalInformation) {
    return []
  }

  const summaries = []

  // HRT summary
  const hrt = medicalInformation.hrt
  if (hrt) {
    if (hrt.hrtQuestion === 'yes') {
      summaries.push(
        `Taking HRT (${hrt.hrtDuration || 'duration not specified'})`
      )
    } else if (hrt.hrtQuestion === 'no-recently-stopped') {
      if (hrt.hrtDurationSinceStopped) {
        summaries.push(`Recently stopped HRT (${hrt.hrtDurationSinceStopped})`)
      } else {
        summaries.push('Recently stopped HRT')
      }
    }
    // Don't add anything for 'no' - that's the default/negative state
  }

  // Pregnancy and breastfeeding summary
  const pregBf = medicalInformation.pregnancyAndBreastfeeding
  if (pregBf) {
    // Pregnancy
    if (pregBf.pregnancyStatus === 'yes') {
      if (pregBf.currentlyPregnantDetails) {
        summaries.push(`Pregnant (${pregBf.currentlyPregnantDetails})`)
      } else {
        summaries.push('Pregnant')
      }
    } else if (pregBf.pregnancyStatus === 'noButRecently') {
      if (pregBf.recentlyPregnantDetails) {
        summaries.push(`Recently pregnant (${pregBf.recentlyPregnantDetails})`)
      } else {
        summaries.push('Recently pregnant')
      }
    }

    // Breastfeeding
    if (pregBf.breastfeedingStatus === 'yes') {
      if (pregBf.currentlyBreastfeedingDuration) {
        summaries.push(
          `Breastfeeding (${pregBf.currentlyBreastfeedingDuration})`
        )
      } else {
        summaries.push('Breastfeeding')
      }
    } else if (pregBf.breastfeedingStatus === 'recentlyStopped') {
      if (pregBf.recentlyBreastfeedingDuration) {
        summaries.push(
          `Recently breastfeeding (stopped ${pregBf.recentlyBreastfeedingDuration})`
        )
      } else {
        summaries.push('Recently breastfeeding')
      }
    }
  }

  // Other medical information (free text)
  if (medicalInformation.otherMedicalInformation) {
    // Truncate if very long, otherwise show as-is
    const otherInfo = medicalInformation.otherMedicalInformation.trim()
    if (otherInfo.length > 100) {
      summaries.push(otherInfo.substring(0, 100) + '...')
    } else {
      summaries.push(otherInfo)
    }
  }

  return summaries
}

module.exports = {
  summariseMedicalHistoryItem,
  summariseMedicalHistory,
  getMedicalHistoryItems,
  countMedicalHistoryItems,
  summariseSymptom,
  summariseSymptoms,
  summariseBreastFeature,
  summariseBreastFeatures,
  summariseOtherRelevantInformation
}
