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
const { getParticipant } = require('./participants')
const { getClinic, getClinicLocationName } = require('./clinics')
const {
  READING_CASE_STATES,
  READING_CASE_OUTCOMES,
  getReadingCases,
  getReadsAsArray,
  getReadingCaseStatus,
  getReadingCaseOutcome,
  getReadingUrgency,
  isCaseDeferred
} = require('./reading-cases')
const { getStatusText } = require('./status')
const { awaitingPriors } = require('./prior-mammograms')
const { participantMatchesQuery } = require('./search')
const { applyFilterGroups } = require('./filter-list')

// Which population the list draws on. Historic episodes are seeded summaries of
// past rounds and outnumber live ones roughly five to one, so they stay out of
// the way unless asked for.
//
// Every non-historic closed episode was closed within the last month, so
// 'current' is open plus recently closed without needing a date cutoff.
const CASE_VIEWS = ['current', 'all']

const CASE_VIEW_LABELS = {
  current: 'Open and recently closed',
  all: 'All, including history'
}

// Rows beyond this aren't rendered. The unfiltered current list is ~550 cases;
// most filtered views are far smaller. Doubles as the page size behind the
// list's pagination.
const MAX_ROWS = 100

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
 * Whether an episode belongs to a view
 *
 * @param {object} episode - Episode object
 * @param {string} view - One of CASE_VIEWS
 * @returns {boolean}
 */
const episodeInView = (episode, view) => {
  if (view === 'all') return true

  return !episode.isHistoric
}

/**
 * Which of the three finalisation stages a case is at.
 *
 * getReadingCaseOutcome stays null until a case concludes, so an outcome being
 * present is the same as it being final. The status's provisional outcome
 * fills the gap between: the answer is known - agreeing reads, or an
 * arbitration read - but hasn't finalised yet. A case bound for arbitration
 * has neither, so it counts as awaiting an outcome.
 *
 * @param {string | null} outcome - The case's outcome, or null
 * @param {object} status - getReadingCaseStatus for the case
 * @returns {string} One of 'awaiting_outcome', 'awaiting_finalisation', 'finalised'
 */
const getFinalisationStage = (outcome, status) => {
  if (outcome) return 'finalised'
  if (status.provisionalOutcome) return 'awaiting_finalisation'

  return 'awaiting_outcome'
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

  const isDeferred = isCaseDeferred(readingCase)
  const isAwaitingPriors = appointment ? awaitingPriors(appointment) : false

  const imagesTakenDate = readingCase.openedDate
  const outcome = getReadingCaseOutcome(readingCase, data.settings)

  return {
    readingCase,
    episode,
    appointment,
    participant,
    clinic,
    clinicLocationName: getClinicLocationName(data, clinic),
    state: status.state,
    status,
    finalised: status.finalised,
    outcome,
    finalisation: getFinalisationStage(outcome, status),
    readCount: getReadsAsArray(readingCase).length,
    isDeferred,
    awaitingPriors: isAwaitingPriors,
    // Deferral and outstanding priors hold a case up without moving it out of
    // the stage it's in - so a blocked case still counts towards its stage
    isBlocked: isDeferred || isAwaitingPriors,
    // Ageing only matters while there is still reading to do - a case with a
    // final outcome is done, however old its images are
    urgency: outcome
      ? null
      : getReadingUrgency(imagesTakenDate, data.config?.reading),
    imagesTakenDate
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
  return participantMatchesQuery(row.participant, query)
}

// The status vocabulary has no label for a normal outcome - it renders as a
// bare green tag - so the filter names it explicitly.
const CASE_OUTCOME_LABELS = {
  normal: 'Normal',
  technical_recall: 'Technical recall',
  recall_for_assessment: 'Recall for assessment'
}

// The filters offered on the reading case list, in the order they appear in
// the filter column. See filter-list.js for the shape.
const READING_CASE_FILTER_GROUPS = [
  {
    name: 'status',
    legend: 'Status',
    // in_arbitration is reserved for a future claim/lock and nothing sets it,
    // so it would only ever offer a count of zero
    options: READING_CASE_STATES.filter(
      (state) => state !== 'in_arbitration'
    ).map((state) => ({
      value: state,
      label: getStatusText(state, 'readingState')
    })),
    matches: (row, values) => values.includes(row.state)
  },
  {
    name: 'outcome',
    legend: 'Outcome',
    options: READING_CASE_OUTCOMES.map((outcome) => ({
      value: outcome,
      label: CASE_OUTCOME_LABELS[outcome] || getStatusText(outcome, 'opinion')
    })),
    matches: (row, values) => values.includes(row.outcome)
  },
  {
    name: 'finalisation',
    legend: 'Finalisation',
    options: [
      { value: 'awaiting_outcome', label: 'Awaiting outcome' },
      { value: 'awaiting_finalisation', label: 'Awaiting finalisation' },
      { value: 'finalised', label: 'Finalised' }
    ],
    matches: (row, values) => values.includes(row.finalisation)
  },
  {
    name: 'urgency',
    legend: 'Urgency',
    options: [
      { value: 'urgent', label: 'Urgent' },
      { value: 'due_soon', label: 'Due soon' }
    ],
    matches: (row, values) => values.includes(row.urgency)
  },
  {
    name: 'blocked',
    legend: 'Blocked',
    options: [
      { value: 'deferred', label: 'Deferred' },
      { value: 'awaiting_priors', label: 'Awaiting priors' }
    ],
    matches: (row, values) =>
      values.some((value) =>
        value === 'deferred' ? row.isDeferred : row.awaitingPriors
      )
  }
]

/**
 * Every case in a view matching the search, before any filter group applies -
 * the population the filter counts describe.
 *
 * Uncapped and sorted oldest images first.
 *
 * @param {object} data - Session data
 * @param {object} [filters] - Filters
 * @param {string} [filters.view] - One of CASE_VIEWS, default 'current'
 * @param {string} [filters.query] - Participant name or NHS number
 * @returns {Array} Rows
 */
const getReadingCaseRows = (data, filters = {}) => {
  const { view = 'current', query = '' } = filters

  const rows = []

  for (const episode of getAllEpisodes(data)) {
    if (!episodeInView(episode, view)) continue

    for (const readingCase of getReadingCases(episode)) {
      const row = buildRow(data, episode, readingCase)

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
 * @param {string} [filters.view] - One of CASE_VIEWS, default 'current'
 * @param {string} [filters.query] - Participant name or NHS number
 * @param {Array} [filters.groups] - Filter groups (READING_CASE_FILTER_GROUPS)
 * @param {object} [filters.selected] - Group name -> selected values
 * @returns {object} `{ rows, totalCount, truncated }` - rows capped at MAX_ROWS
 */
const getReadingCaseList = (data, filters = {}) => {
  const { groups = [], selected = {} } = filters

  const rows = applyFilterGroups(
    getReadingCaseRows(data, filters),
    groups,
    selected
  )

  return {
    rows: rows.slice(0, MAX_ROWS),
    totalCount: rows.length,
    truncated: rows.length > MAX_ROWS
  }
}

/**
 * The arbitration backlog and what's holding parts of it up.
 *
 * One count for every surface that talks about arbitration - the reading index
 * card, the arbitration setup page and the case list - so they can't drift
 * apart. `available` is what an arbitration session would actually offer.
 *
 * A plain state match covers the whole backlog: a disagreeing case is
 * awaiting_arbitration from the moment the disagreement exists, finalised or
 * not.
 *
 * @param {object} data - Session data
 * @param {object} [filters] - View and query, as getReadingCaseRows documents
 * @returns {object} `{ total, available, unfinalised, blocked, deferred, awaitingPriors }`
 */
const getArbitrationBacklogCounts = (data, filters = {}) => {
  const rows = getReadingCaseRows(data, filters).filter(
    (row) => row.state === 'awaiting_arbitration'
  )

  const blockedRows = rows.filter((row) => row.isBlocked)

  // In the backlog but not yet arbitrable - the reads behind the disagreement
  // haven't finalised
  const unfinalisedRows = rows.filter(
    (row) => !row.isBlocked && !row.status.finalised
  )

  return {
    total: rows.length,
    available: rows.length - blockedRows.length - unfinalisedRows.length,
    unfinalised: unfinalisedRows.length,
    blocked: blockedRows.length,
    deferred: blockedRows.filter((row) => row.isDeferred).length,
    awaitingPriors: blockedRows.filter((row) => row.awaitingPriors).length
  }
}

module.exports = {
  CASE_VIEWS,
  CASE_VIEW_LABELS,
  READING_CASE_FILTER_GROUPS,
  MAX_ROWS,
  getReadingCaseRows,
  getReadingCaseList,
  getArbitrationBacklogCounts
}
