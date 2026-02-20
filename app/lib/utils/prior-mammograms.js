// app/lib/utils/prior-mammograms.js
//
// Utility functions for working with prior mammograms (previously reported
// mammograms from other facilities). These derive event-level state from
// per-mammogram request tracking on event.previousMammograms[].

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

module.exports = {
  hasReportedMammograms,
  awaitingPriors,
  hasUnrequestedPriors,
  getPriorsSummary,
  getUnrequestedPriors,
  getAwaitingPriors,
  userRequestedPriors
}
