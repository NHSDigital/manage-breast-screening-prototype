// app/lib/utils/reading-case-list.js
//
// Listing reading cases across every episode - the backlog behind
// /reading/cases.
//
// Separate from reading.js because it works on a different axis: reading.js is
// the appointment/session layer (one reader working through a list of
// appointments), this is every case in the service regardless of who is reading
// it. Separate from reading-cases.js because that file is deliberately pure and
// this needs session data to reach episodes, appointments and participants.

const dataStore = require('../data-store')
const { getAppointment } = require('./appointment-data')
const { getParticipant, getFullName } = require('./participants')
const { getClinic, getClinicLocationName } = require('./clinics')
const {
  getReadingCases,
  getReadsAsArray,
  getReadingCaseStatus,
  getReadingCaseOutcome,
  isCaseDeferred
} = require('./reading-cases')
const { describeReadingCaseStatus } = require('./status')
const { awaitingPriors } = require('./prior-mammograms')

// How the list is scoped. Historic episodes are seeded summaries of past rounds
// and outnumber live ones roughly five to one, so they stay out of the way
// unless asked for.
//
// Every non-historic closed episode was closed within the last month, so
// 'recently-closed' needs no date cutoff - not historic is the same set.
const CASE_SCOPES = ['open', 'recently-closed', 'all']

// Rows beyond this aren't rendered. The unfiltered open list is ~550 cases;
// most filtered views are far smaller. The route reports what was dropped.
const MAX_ROWS = 200

/**
 * Every episode the list could draw on, session changes included.
 *
 * @param {object} data - Session data
 * @returns {Array} Episodes
 */
const getAllEpisodes = (data) => {
  const changed = data._changes?.episodes || {}
  const changedIds = new Set(Object.keys(changed))

  return [
    ...dataStore.state.episodes.filter((episode) => !changedIds.has(episode.id)),
    ...Object.values(changed)
  ]
}

/**
 * Whether an episode is in scope for the list
 *
 * @param {object} episode - Episode object
 * @param {string} scope - One of CASE_SCOPES
 * @returns {boolean}
 */
const episodeInScope = (episode, scope) => {
  if (scope === 'all') return true

  if (scope === 'recently-closed') {
    return episode.stage === 'closed' && !episode.isHistoric
  }

  return episode.stage !== 'closed'
}

/**
 * Build one row for a case - everything the list and its filters need.
 *
 * @param {object} data - Session data
 * @param {object} episode - The episode holding the case
 * @param {object} readingCase - The case
 * @returns {object} Row
 */
const buildRow = (data, episode, readingCase) => {
  const appointment = getAppointment(data, readingCase.appointmentId)
  const participant = getParticipant(data, episode.participantId)
  const clinic = appointment ? getClinic(data, appointment.clinicId) : null

  const status = getReadingCaseStatus(readingCase, data.settings)

  return {
    readingCase,
    episode,
    appointment,
    participant,
    clinic,
    clinicLocationName: getClinicLocationName(data, clinic),
    state: status.state,
    status,
    statusDisplay: describeReadingCaseStatus(status),
    outcome: getReadingCaseOutcome(readingCase, data.settings),
    readCount: getReadsAsArray(readingCase).length,
    isDeferred: isCaseDeferred(readingCase),
    awaitingPriors: appointment ? awaitingPriors(appointment) : false,
    imagesTakenDate: readingCase.openedDate
  }
}

/**
 * Whether a row matches a free-text search of the participant's name or NHS
 * number
 *
 * @param {object} row - A row from buildRow
 * @param {string} query - Search text
 * @returns {boolean}
 */
const rowMatchesQuery = (row, query) => {
  const needle = query.trim().toLowerCase()
  if (!needle) return true

  const name = row.participant ? getFullName(row.participant) : ''
  const nhsNumber =
    row.participant?.medicalInformation?.nhsNumber?.replace(/\s/g, '') || ''

  return (
    name.toLowerCase().includes(needle) ||
    nhsNumber.includes(needle.replace(/\s/g, ''))
  )
}

/**
 * Every matching row, uncapped and sorted oldest images first.
 *
 * @param {object} data - Session data
 * @param {object} filters - Filters, as getReadingCaseList documents
 * @returns {Array} Rows
 */
const collectRows = (data, filters) => {
  const { scope = 'open', state = null, deferred = false, query = '' } = filters

  const rows = []

  for (const episode of getAllEpisodes(data)) {
    if (!episodeInScope(episode, scope)) continue

    for (const readingCase of getReadingCases(episode)) {
      const row = buildRow(data, episode, readingCase)

      if (state && row.state !== state) continue
      if (deferred && !row.isDeferred) continue
      if (query && !rowMatchesQuery(row, query)) continue

      rows.push(row)
    }
  }

  return rows.sort(
    (a, b) => new Date(a.imagesTakenDate) - new Date(b.imagesTakenDate)
  )
}

/**
 * The reading case backlog, filtered and sorted oldest images first.
 *
 * @param {object} data - Session data
 * @param {object} [filters] - Filters
 * @param {string} [filters.scope] - One of CASE_SCOPES, default 'open'
 * @param {string} [filters.state] - A single reading case state
 * @param {boolean} [filters.deferred] - Only deferred cases
 * @param {string} [filters.query] - Participant name or NHS number
 * @returns {object} `{ rows, totalCount, truncated }` - rows capped at MAX_ROWS
 */
const getReadingCaseList = (data, filters = {}) => {
  const rows = collectRows(data, filters)

  return {
    rows: rows.slice(0, MAX_ROWS),
    totalCount: rows.length,
    truncated: rows.length > MAX_ROWS
  }
}

/**
 * How many cases sit in each state, for the filter links.
 *
 * Counted within the current scope but ignoring the state and deferred filters,
 * so the counts don't collapse to whichever filter is active. Uncapped - a
 * count that stopped at MAX_ROWS would be a lie.
 *
 * @param {object} data - Session data
 * @param {object} [filters] - Same filters as getReadingCaseList
 * @returns {object} State value -> count, plus `all` and `deferred`
 */
const getReadingCaseStateCounts = (data, filters = {}) => {
  const rows = collectRows(data, {
    ...filters,
    state: null,
    deferred: false
  })

  const counts = { all: rows.length, deferred: 0 }

  for (const row of rows) {
    counts[row.state] = (counts[row.state] || 0) + 1
    if (row.isDeferred) counts.deferred += 1
  }

  return counts
}

module.exports = {
  CASE_SCOPES,
  MAX_ROWS,
  getReadingCaseList,
  getReadingCaseStateCounts
}
