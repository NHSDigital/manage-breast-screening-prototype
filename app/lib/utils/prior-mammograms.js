// app/lib/utils/prior-mammograms.js
//
// Utility functions for working with prior mammograms (previously recorded
// mammograms from other facilities). These derive appointment-level state from
// per-mammogram request tracking on appointment.previousMammograms[].

const { formatDate, formatRelativeDate } = require('./dates')

/** The known requestStatus values for a prior mammogram */
const PRIOR_REQUEST_STATUSES = [
  'not_requested',
  'pending',
  'requested',
  'received',
  'not_available',
  'not_needed'
]

/** Returns true if the appointment has any previously recorded mammograms */
const hasRecordedMammograms = (appointment) => {
  if (!appointment) return false
  return (
    Array.isArray(appointment.previousMammograms) &&
    appointment.previousMammograms.length > 0
  )
}

/** Returns true if any prior mammogram has requestStatus 'pending' or 'requested' (holds case from reading) */
const awaitingPriors = (appointment) => {
  if (!hasRecordedMammograms(appointment)) return false
  return appointment.previousMammograms.some(
    (m) => m.requestStatus === 'pending' || m.requestStatus === 'requested'
  )
}

/** Returns true if any prior mammogram has requestStatus 'not_requested' */
const hasUnrequestedPriors = (appointment) => {
  if (!hasRecordedMammograms(appointment)) return false
  return appointment.previousMammograms.some(
    (m) => m.requestStatus === 'not_requested'
  )
}

/**
 * Get a summary of prior mammogram statuses for display
 *
 * @param {object} appointment - Appointment object
 * @returns {{total: number, counts: object, hasAwaiting: boolean, hasUnrequested: boolean, allResolved: boolean}}
 */
const getPriorsSummary = (appointment) => {
  if (!hasRecordedMammograms(appointment)) {
    return {
      total: 0,
      counts: {},
      hasAwaiting: false,
      hasUnrequested: false,
      allResolved: true
    }
  }

  const counts = {
    not_requested: 0,
    pending: 0,
    requested: 0,
    received: 0,
    not_available: 0,
    not_needed: 0
  }

  appointment.previousMammograms.forEach((m) => {
    const status = m.requestStatus || 'not_requested'
    if (counts[status] !== undefined) {
      counts[status]++
    }
  })

  const total = appointment.previousMammograms.length
  const hasAwaiting = counts.pending > 0 || counts.requested > 0
  const hasUnrequested = counts.not_requested > 0
  const resolvedCount =
    counts.received + counts.not_available + counts.not_needed
  const allResolved = resolvedCount === total

  return {
    total,
    counts,
    hasAwaiting,
    hasUnrequested,
    allResolved
  }
}

/** Get priors with requestStatus 'not_requested' (for the request priors UI) */
const getUnrequestedPriors = (appointment) => {
  if (!hasRecordedMammograms(appointment)) return []
  return appointment.previousMammograms.filter(
    (m) => m.requestStatus === 'not_requested'
  )
}

/** Get priors with requestStatus 'pending' or 'requested' (awaiting arrival) */
const getAwaitingPriors = (appointment) => {
  if (!hasRecordedMammograms(appointment)) return []
  return appointment.previousMammograms.filter(
    (m) => m.requestStatus === 'pending' || m.requestStatus === 'requested'
  )
}

/**
 * Resolve a single awaiting-priors status for a whole case.
 *
 * The dashboard shows one tag per prior; a case list has room for only one, so
 * we surface the least-progressed outstanding status - 'pending' ('Priors
 * required') outranks 'requested' because the request still needs sending.
 * Returns null when nothing is outstanding.
 *
 * @param {object} appointment - Appointment object
 * @returns {'pending'|'requested'|null}
 */
const getAwaitingPriorsStatus = (appointment) => {
  const awaiting = getAwaitingPriors(appointment)
  if (awaiting.some((m) => m.requestStatus === 'pending')) return 'pending'
  if (awaiting.length > 0) return 'requested'
  return null
}

/**
 * Returns true if the given user has a pending prior request on this appointment.
 * Only 'pending' is checked — once admin moves to 'requested', the reader can no longer undo.
 */
const userRequestedPriors = (appointment, userId) => {
  if (!hasRecordedMammograms(appointment)) return false
  return appointment.previousMammograms.some(
    (m) => m.requestStatus === 'pending' && m.requestedBy === userId
  )
}

/**
 * Describe where a prior mammogram was taken
 *
 * Phrases are lower case so they read after a prefix ("Taken at another
 * BSU…"); with no prefix the first letter is capitalised so the phrase reads
 * at the start of a line, list item or card title.
 *
 * @param {Object} mammogram - A prior mammogram object from appointment.previousMammograms
 * @param {Object} [options] - Optional config
 * @param {string} [options.unitName] - Display name for the current BSU (used when location === 'currentBsu')
 * @param {string} [options.prefix] - Optional leading verb, e.g. "Taken"
 * @returns {string} Location phrase, e.g. "At another BSU: St James's Hospital"
 */
const describePriorMammogramLocation = (mammogram, options = {}) => {
  if (!mammogram) return ''

  const { unitName = null, prefix = null } = options

  // A generic category phrase, plus the specific place the participant named
  // where we have one
  let place = ''
  let specificPlace = ''
  switch (mammogram.location) {
    case 'bsu':
      place = 'at another BSU'
      specificPlace = mammogram.bsu
      break
    case 'otherUk':
      place = 'elsewhere in the UK'
      specificPlace = mammogram.otherUk
      break
    case 'otherNonUk':
      place = 'outside the UK'
      specificPlace = mammogram.otherNonUk
      break
    case 'currentBsu':
      place = `at ${unitName || 'this BSU'}`
      break
    case 'preferNotToSay':
      place = 'at an undisclosed location'
      break
    default:
      place = ''
  }

  let location = specificPlace ? `${place}: ${specificPlace}` : place

  if (location) {
    if (prefix) {
      location = `${prefix} ${location}`
    } else {
      location = location.charAt(0).toUpperCase() + location.slice(1)
    }
  }

  return location
}

/**
 * Describe when a prior mammogram was taken, using the participant's
 * approximate wording when they didn't give an exact date
 *
 * @param {Object} mammogram - A prior mammogram object from appointment.previousMammograms
 * @returns {string} Date description, e.g. "March 2018, 8 years ago", or '' if unknown
 */
const describePriorMammogramDate = (mammogram) => {
  if (!mammogram) return ''

  const dateParts = []
  if (mammogram.dateType === 'dateKnown' && mammogram.dateTaken) {
    dateParts.push(formatDate(mammogram.dateTaken, 'MMMM YYYY'))
    if (mammogram._rawDate) {
      dateParts.push(formatRelativeDate(mammogram._rawDate))
    }
  } else if (mammogram.dateType === 'moreThanSixMonths') {
    dateParts.push(mammogram.approximateDate || 'over 6 months ago')
  } else if (mammogram.dateType === 'lessThanSixMonths') {
    dateParts.push('less than 6 months ago')
  }

  return dateParts.join(', ')
}

/**
 * Summarise a single prior mammogram into a one-line string for display
 * Suitable for image readers who need a quick overview of each prior.
 *
 * Format follows other summary functions: primary label with detail in parentheses.
 * e.g. "St James's Hospital (March 2018, 8 years ago)"
 *
 * @param {Object} mammogram - A prior mammogram object from appointment.previousMammograms
 * @param {Object} [options] - Optional config
 * @param {string} [options.unitName] - Display name for the current BSU (used when location === 'currentBsu')
 * @param {boolean} [options.includeAdditionalInfo] - Whether to append otherDetails (default: false)
 * @param {boolean} [options.includeDate] - Whether to append the parenthesised date detail (default: true)
 * @param {string} [options.prefix] - Optional leading verb, e.g. "Taken"; the location phrase then reads lower case after it
 * @returns {string} One-line summary, e.g. "At another BSU: St James's Hospital (March 2018)"
 */
const summarisePriorMammogram = (mammogram, options = {}) => {
  if (!mammogram) return ''

  const {
    unitName = null,
    includeAdditionalInfo = false,
    includeDate = true,
    prefix = null
  } = options

  const location = describePriorMammogramLocation(mammogram, {
    unitName,
    prefix
  })

  const dateText = describePriorMammogramDate(mammogram)
  const dateDetail = includeDate && dateText ? `(${dateText})` : ''

  // Optional additional information appended as a separate sentence
  const additionalInfo =
    includeAdditionalInfo && mammogram.otherDetails
      ? mammogram.otherDetails.trim()
      : ''

  return [location, dateDetail, additionalInfo].filter(Boolean).join(' ')
}

/**
 * Summarise all prior mammograms for an appointment into an array of one-line strings
 *
 * @param {Object} appointment - The appointment object (must have previousMammograms array)
 * @param {Object} [options] - Optional config passed through to summarisePriorMammogram
 * @returns {Array<string>} Array of summary strings
 */
const summarisePriorMammograms = (appointment, options = {}) => {
  if (!hasRecordedMammograms(appointment)) return []
  return appointment.previousMammograms
    .map((m) => summarisePriorMammogram(m, options))
    .filter(Boolean)
}

module.exports = {
  PRIOR_REQUEST_STATUSES,
  hasRecordedMammograms,
  awaitingPriors,
  hasUnrequestedPriors,
  getPriorsSummary,
  getUnrequestedPriors,
  getAwaitingPriors,
  getAwaitingPriorsStatus,
  userRequestedPriors,
  describePriorMammogramLocation,
  describePriorMammogramDate,
  summarisePriorMammogram,
  summarisePriorMammograms
}
