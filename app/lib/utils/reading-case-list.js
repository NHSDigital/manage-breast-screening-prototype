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
const {
  awaitingPriors,
  getAwaitingPriorsStatus
} = require('./prior-mammograms')
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
    ...dataStore.state.episodes.filter(
      (episode) => !changedIds.has(episode.id)
    ),
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
 * When something last happened on a case: the most recent read or
 * finalisation, falling back to when the images were taken.
 *
 * @param {object} readingCase - The case
 * @returns {string} An ISO date string
 */
const getLastActivityDate = (readingCase) => {
  const stamps = getReadsAsArray(readingCase)
    .flatMap((read) => [read.timestamp, read.finalisedAt])
    .filter(Boolean)

  return stamps.length
    ? stamps.reduce((latest, stamp) => (stamp > latest ? stamp : latest))
    : readingCase.openedDate
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
  // The case-level status ('pending'/'requested') behind the awaiting-priors
  // union, so the row tag can match the priors dashboard rather than always
  // reading 'Priors required'
  const awaitingPriorsStatus = appointment
    ? getAwaitingPriorsStatus(appointment)
    : null

  const imagesTakenDate = readingCase.openedDate
  const outcome = getReadingCaseOutcome(readingCase, data.settings)
  const finalisation = getFinalisationStage(outcome, status)

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
    finalisation,
    // Whether the case still has reading work on it - the axis the priority
    // sort bands on. A case with a provisional outcome isn't done yet
    isLive: finalisation !== 'finalised',
    readCount: getReadsAsArray(readingCase).length,
    isDeferred,
    awaitingPriors: isAwaitingPriors,
    awaitingPriorsStatus,
    // Deferral and outstanding priors hold a case up without moving it out of
    // the stage it's in - so a blocked case still counts towards its stage
    isBlocked: isDeferred || isAwaitingPriors,
    // Ageing only matters while there is still reading to do - a case with a
    // final outcome is done, however old its images are
    urgency: outcome
      ? null
      : getReadingUrgency(imagesTakenDate, data.config?.reading),
    imagesTakenDate,
    lastActivityDate: getLastActivityDate(readingCase)
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
 * A case's name key for alphabetical ordering - surname, then first name.
 *
 * @param {object} row - A row from buildRow
 * @returns {string} Sort key
 */
const getNameKey = (row) => {
  const { firstName, lastName } = row.participant?.demographicInformation || {}

  return `${lastName || ''} ${firstName || ''}`.trim().toLowerCase()
}

const compareDates = (a, b) => new Date(a) - new Date(b)

// Cases sharing a sort value need a stable order - a technical recall opens a
// second case on the same day, and one person can hold several rounds - so
// every sort falls back to name, then screening date, then case id
const compareTieBreak = (a, b) =>
  getNameKey(a).localeCompare(getNameKey(b)) ||
  compareDates(a.imagesTakenDate, b.imagesTakenDate) ||
  a.readingCase.id.localeCompare(b.readingCase.id)

/**
 * The orders the list can be shown in, in the order they appear in the menu.
 *
 * Priority leads because the list serves two jobs at once: a work queue in the
 * 'current' view, a record in 'all'. It bands on whether a case still has
 * reading work on it, so an open case from this week sits above a round that
 * closed years ago - then reads oldest-first within the live band (which is
 * urgency order, since urgency comes from image age) and newest-first within
 * the closed one.
 */
const READING_CASE_SORTS = [
  {
    value: 'priority',
    label: 'Priority',
    compare: (a, b) => {
      if (a.isLive !== b.isLive) return a.isLive ? -1 : 1

      return a.isLive
        ? compareDates(a.imagesTakenDate, b.imagesTakenDate)
        : compareDates(b.imagesTakenDate, a.imagesTakenDate)
    }
  },
  {
    value: 'screening_date_asc',
    label: 'Screening date – oldest first',
    compare: (a, b) => compareDates(a.imagesTakenDate, b.imagesTakenDate)
  },
  {
    value: 'screening_date_desc',
    label: 'Screening date – newest first',
    compare: (a, b) => compareDates(b.imagesTakenDate, a.imagesTakenDate)
  },
  {
    value: 'activity_desc',
    label: 'Last activity – newest first',
    compare: (a, b) => compareDates(b.lastActivityDate, a.lastActivityDate)
  },
  {
    value: 'activity_asc',
    label: 'Last activity – oldest first',
    compare: (a, b) => compareDates(a.lastActivityDate, b.lastActivityDate)
  },
  {
    value: 'surname',
    label: 'Surname A to Z',
    compare: (a, b) => getNameKey(a).localeCompare(getNameKey(b))
  }
]

const DEFAULT_CASE_SORT = 'priority'

/**
 * The sort to apply, falling back to the default when the value is unknown.
 *
 * @param {string} [value] - A sort value
 * @returns {object} An entry from READING_CASE_SORTS
 */
const getCaseSort = (value) =>
  READING_CASE_SORTS.find((sort) => sort.value === value) ||
  READING_CASE_SORTS.find((sort) => sort.value === DEFAULT_CASE_SORT)

/**
 * Every case in a view matching the search, before any filter group applies -
 * the population the filter counts describe.
 *
 * Uncapped, in the order the sort asks for.
 *
 * @param {object} data - Session data
 * @param {object} [filters] - Filters
 * @param {string} [filters.view] - One of CASE_VIEWS, default 'current'
 * @param {string} [filters.query] - Participant name or NHS number
 * @param {string} [filters.sort] - One of READING_CASE_SORTS, default 'priority'
 * @returns {Array} Rows
 */
const getReadingCaseRows = (data, filters = {}) => {
  const { view = 'current', query = '', sort } = filters

  const rows = []

  for (const episode of getAllEpisodes(data)) {
    if (!episodeInView(episode, view)) continue

    for (const readingCase of getReadingCases(episode)) {
      const row = buildRow(data, episode, readingCase)

      if (query && !rowMatchesQuery(row, query)) continue

      rows.push(row)
    }
  }

  const { compare } = getCaseSort(sort)

  return rows.sort((a, b) => compare(a, b) || compareTieBreak(a, b))
}

/**
 * The reading case backlog, filtered and sorted.
 *
 * @param {object} data - Session data
 * @param {object} [filters] - Filters
 * @param {string} [filters.view] - One of CASE_VIEWS, default 'current'
 * @param {string} [filters.query] - Participant name or NHS number
 * @param {string} [filters.sort] - One of READING_CASE_SORTS, default 'priority'
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
  READING_CASE_SORTS,
  DEFAULT_CASE_SORT,
  MAX_ROWS,
  getReadingCaseRows,
  getReadingCaseList,
  getArbitrationBacklogCounts
}
