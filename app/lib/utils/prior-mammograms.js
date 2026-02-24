// app/lib/utils/prior-mammograms.js
//
// Utility functions for working with prior mammograms (previously reported
// mammograms from other facilities). These derive event-level state from
// per-mammogram request tracking on event.previousMammograms[].

const { formatDate, formatRelativeDate } = require('./dates')

// Check if an event has any reported mammograms
const hasReportedMammograms = (event) => {
  if (!event) return false
  return (
    Array.isArray(event.previousMammograms) &&
    event.previousMammograms.length > 0
  )
}

// Check if an event is awaiting priors (any mammogram has status 'requested')
// Only 'requested' status holds a case from reading
const awaitingPriors = (event) => {
  if (!hasReportedMammograms(event)) return false
  return event.previousMammograms.some((m) => m.requestStatus === 'requested')
}

// Check if an event has unrequested priors that a reader might want to request
const hasUnrequestedPriors = (event) => {
  if (!hasReportedMammograms(event)) return false
  return event.previousMammograms.some(
    (m) => m.requestStatus === 'not_requested'
  )
}

// Get a summary of prior mammogram statuses for display
// Returns an object with counts by status and overall state
const getPriorsSummary = (event) => {
  if (!hasReportedMammograms(event)) {
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
  const hasAwaiting = counts.requested > 0
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

// Get unrequested mammograms from an event (for the request priors UI)
const getUnrequestedPriors = (event) => {
  if (!hasReportedMammograms(event)) return []
  return event.previousMammograms.filter(
    (m) => m.requestStatus === 'not_requested'
  )
}

// Get requested (awaiting) mammograms from an event
const getAwaitingPriors = (event) => {
  if (!hasReportedMammograms(event)) return []
  return event.previousMammograms.filter((m) => m.requestStatus === 'requested')
}

// Check if a specific user requested priors on this event
const userRequestedPriors = (event, userId) => {
  if (!hasReportedMammograms(event)) return false
  return event.previousMammograms.some(
    (m) => m.requestStatus === 'requested' && m.requestedBy === userId
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
 * @returns {string} One-line summary, e.g. "St James's Hospital (March 2018, 8 years ago)"
 */
const summarisePriorMammogram = (mammogram, options = {}) => {
  if (!mammogram) return ''

  const { unitName = null, includeAdditionalInfo = false } = options

  // Location part (primary label)
  let location = ''
  switch (mammogram.location) {
    case 'bsu':
      location = mammogram.bsu || 'NHS breast screening unit'
      break
    case 'otherUk':
      location = mammogram.otherUk || 'Other UK location'
      break
    case 'otherNonUk':
      location = mammogram.otherNonUk
        ? `Outside UK: ${mammogram.otherNonUk}`
        : 'Outside UK'
      break
    case 'currentBsu':
      location = unitName || 'Current BSU'
      break
    case 'preferNotToSay':
      location = 'Location not given'
      break
    default:
      location = ''
  }

  // Date detail — combine formatted date and relative time into parenthesised suffix
  const dateParts = []
  if (mammogram.dateType === 'dateKnown' && mammogram.dateTaken) {
    dateParts.push(formatDate(mammogram.dateTaken, 'MMMM YYYY'))
    if (mammogram._rawDate) {
      dateParts.push(formatRelativeDate(mammogram._rawDate))
    }
  } else if (mammogram.dateType === 'moreThanSixMonths') {
    dateParts.push(mammogram.approximateDate || 'over 6 months ago')
  } else if (mammogram.dateType === 'lessThanSixMonths') {
    dateParts.push(mammogram.approximateDate || 'less than 6 months ago')
  }

  const dateDetail = dateParts.length > 0 ? `(${dateParts.join(', ')})` : ''

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
  if (!hasReportedMammograms(event)) return []
  return event.previousMammograms
    .map((m) => summarisePriorMammogram(m, options))
    .filter(Boolean)
}

module.exports = {
  hasReportedMammograms,
  awaitingPriors,
  hasUnrequestedPriors,
  getPriorsSummary,
  getUnrequestedPriors,
  getAwaitingPriors,
  userRequestedPriors,
  summarisePriorMammogram,
  summarisePriorMammograms
}
