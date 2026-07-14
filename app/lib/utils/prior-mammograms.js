// app/lib/utils/prior-mammograms.js
//
// Utility functions for working with prior mammograms (previously recorded
// mammograms from other facilities). These derive event-level state from
// per-mammogram request tracking on event.previousMammograms[].

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

/** Returns true if the event has any previously recorded mammograms */
const hasRecordedMammograms = (event) => {
  if (!event) return false
  return (
    Array.isArray(event.previousMammograms) &&
    event.previousMammograms.length > 0
  )
}

/** Returns true if any prior mammogram has requestStatus 'pending' or 'requested' (holds case from reading) */
const awaitingPriors = (event) => {
  if (!hasRecordedMammograms(event)) return false
  return event.previousMammograms.some(
    (m) => m.requestStatus === 'pending' || m.requestStatus === 'requested'
  )
}

/** Returns true if any prior mammogram has requestStatus 'not_requested' */
const hasUnrequestedPriors = (event) => {
  if (!hasRecordedMammograms(event)) return false
  return event.previousMammograms.some(
    (m) => m.requestStatus === 'not_requested'
  )
}

/**
 * Get a summary of prior mammogram statuses for display
 *
 * @param {object} event - Event object
 * @returns {{total: number, counts: object, hasAwaiting: boolean, hasUnrequested: boolean, allResolved: boolean}}
 */
const getPriorsSummary = (event) => {
  if (!hasRecordedMammograms(event)) {
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

  event.previousMammograms.forEach((m) => {
    const status = m.requestStatus || 'not_requested'
    if (counts[status] !== undefined) {
      counts[status]++
    }
  })

  const total = event.previousMammograms.length
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
const getUnrequestedPriors = (event) => {
  if (!hasRecordedMammograms(event)) return []
  return event.previousMammograms.filter(
    (m) => m.requestStatus === 'not_requested'
  )
}

/** Get priors with requestStatus 'pending' or 'requested' (awaiting arrival) */
const getAwaitingPriors = (event) => {
  if (!hasRecordedMammograms(event)) return []
  return event.previousMammograms.filter(
    (m) => m.requestStatus === 'pending' || m.requestStatus === 'requested'
  )
}

/**
 * Returns true if the given user has a pending prior request on this event.
 * Only 'pending' is checked — once admin moves to 'requested', the reader can no longer undo.
 */
const userRequestedPriors = (event, userId) => {
  if (!hasRecordedMammograms(event)) return false
  return event.previousMammograms.some(
    (m) => m.requestStatus === 'pending' && m.requestedBy === userId
  )
}

/**
 * Summarise a single prior mammogram into a one-line string for display
 * Suitable for image readers who need a quick overview of each prior.
 *
 * Format follows other summary functions: primary label with detail in parentheses.
 * e.g. "St James's Hospital (March 2018, 8 years ago)"
 *
 * @param {Object} mammogram - A prior mammogram object from event.previousMammograms
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

  // Location: a generic category phrase, plus the specific place the
  // participant named where we have one, e.g. "at another BSU: St James's".
  // Phrases are lower case so they read after a prefix ("Taken at another
  // BSU…"); when there's no prefix the first letter is capitalised so the
  // phrase reads at the start of a line or list item.
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

  // Date detail — parenthesised suffix. Uses the participant's approximate
  // wording when they didn't give an exact date.
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

  const dateDetail =
    includeDate && dateParts.length > 0 ? `(${dateParts.join(', ')})` : ''

  // Optional additional information appended as a separate sentence
  const additionalInfo =
    includeAdditionalInfo && mammogram.otherDetails
      ? mammogram.otherDetails.trim()
      : ''

  return [location, dateDetail, additionalInfo].filter(Boolean).join(' ')
}

/**
 * Summarise all prior mammograms for an event into an array of one-line strings
 *
 * @param {Object} event - The event object (must have previousMammograms array)
 * @param {Object} [options] - Optional config passed through to summarisePriorMammogram
 * @returns {Array<string>} Array of summary strings
 */
const summarisePriorMammograms = (event, options = {}) => {
  if (!hasRecordedMammograms(event)) return []
  return event.previousMammograms
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
  userRequestedPriors,
  summarisePriorMammogram,
  summarisePriorMammograms
}
