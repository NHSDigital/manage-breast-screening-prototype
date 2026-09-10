// app/lib/utils/participant-list.js
//
// Listing participants - the population behind /participants.
//
// Separate from participants.js because that file is the record layer (fetch
// one, name one, save one) and this is the list layer: it builds a row per
// participant carrying everything the index and its filters need, then hands
// it to the generic filter helpers in filter-list.js.
//
// Mirrors reading-case-list.js, which does the same job for reading cases.

const { getAge, getCurrentRiskLevel } = require('./participants')
const {
  getEpisodesForParticipant,
  getEpisodeAppointments,
  getCurrentEpisode,
  getLastMammogram,
  getNextAppointment
} = require('./episodes')
const { isSpecialAppointment } = require('./status')
const { participantMatchesQuery } = require('./search')
const { applyFilterGroups } = require('./filter-list')

// Rows beyond this aren't rendered. The unfiltered list is ~1000 participants;
// most filtered views are far smaller. Doubles as the page size behind the
// list's pagination.
const MAX_ROWS = 100

// Where a participant's screening stands right now - the axis the views slice
// on. Historic episodes are seeded summaries of past rounds, so a participant
// whose latest round is historic counts the same as one with no round at all:
// nothing is happening for them today.
const EPISODE_STATUSES = ['open', 'recently_closed', 'no_current_episode']

// Which population the list draws on, narrowest first. Nested rather than
// exclusive: each view contains the one before it.
//
// The default is 'all' because this index is first a way to find a person -
// narrowing by default would let a search miss someone who is on the system
// but has no round in progress.
const PARTICIPANT_VIEWS = ['open', 'current', 'all']

const PARTICIPANT_VIEW_LABELS = {
  open: 'Open episodes',
  current: 'Open and recently closed',
  all: 'All participants'
}

const DEFAULT_PARTICIPANT_VIEW = 'all'

// Which episode statuses each view admits
const EPISODE_STATUSES_BY_VIEW = {
  open: ['open'],
  current: ['open', 'recently_closed'],
  all: EPISODE_STATUSES
}

// Screening runs on a three-year cycle, so "when were they last screened" is
// really "are they due". The bands are the cycle, then overdue, then long
// overdue - and never screened, which is neither.
const LAST_SCREENED_BANDS = [
  { value: 'within_3_years', label: 'Within the last 3 years', maxYears: 3 },
  { value: '3_to_5_years', label: '3 to 5 years ago', maxYears: 5 },
  { value: 'over_5_years', label: 'More than 5 years ago', maxYears: Infinity }
]

// Routine screening runs from 50 to 70, so the bands split at the invitation
// age and again mid-cycle. Over 70 is self-referral territory - seed data
// doesn't reach it today, so the option sits at zero rather than being missing
const AGE_BANDS = [
  { value: 'under_50', label: 'Under 50', max: 49 },
  { value: '50_to_59', label: '50 to 59', max: 59 },
  { value: '60_to_70', label: '60 to 70', max: 70 },
  { value: 'over_70', label: 'Over 70', max: Infinity }
]

// getCurrentRiskLevel answers in the words used in the data ('family history'),
// which make for awkward URLs - the filter uses slugs and maps back
const RISK_LEVELS = [
  { value: 'routine', label: 'Routine', riskLevel: 'routine' },
  {
    value: 'family_history',
    label: 'Family history',
    riskLevel: 'family history'
  },
  { value: 'high', label: 'High risk', riskLevel: 'high' }
]

const MILLISECONDS_PER_YEAR = 365.25 * 24 * 60 * 60 * 1000

/**
 * How long ago a date was, in years.
 *
 * @param {string} date - An ISO date string
 * @param {Date} [referenceDate] - What counts as now
 * @returns {number} Years, fractional
 */
const getYearsSince = (date, referenceDate = new Date()) => {
  return (referenceDate - new Date(date)) / MILLISECONDS_PER_YEAR
}

/**
 * Which last-screened band a date falls in.
 *
 * @param {string | null} date - When they were last screened, or null
 * @param {Date} [referenceDate] - What counts as now
 * @returns {string} A LAST_SCREENED_BANDS value, or 'never'
 */
const getLastScreenedBand = (date, referenceDate = new Date()) => {
  if (!date) return 'never'

  const years = getYearsSince(date, referenceDate)

  return (
    LAST_SCREENED_BANDS.find((band) => years < band.maxYears)?.value ||
    'over_5_years'
  )
}

/**
 * Which age band an age falls in.
 *
 * @param {number | null} age - Age in years, or null when there's no date of birth
 * @returns {string | null} An AGE_BANDS value, or null
 */
const getAgeBand = (age) => {
  if (age === null || age === undefined) return null

  return AGE_BANDS.find((band) => age <= band.max)?.value || null
}

/**
 * Where a participant's screening stands: a round in progress, one that closed
 * recently, or neither.
 *
 * @param {object | null} currentEpisode - Their open episode, if any
 * @param {object | null} latestEpisode - Their most recent episode, if any
 * @returns {string} An EPISODE_STATUSES value
 */
const getEpisodeStatus = (currentEpisode, latestEpisode) => {
  if (currentEpisode) return 'open'

  // Every non-historic closed episode was closed within the last month, so
  // 'recently closed' needs no date cutoff of its own
  if (latestEpisode && !latestEpisode.isHistoric) return 'recently_closed'

  return 'no_current_episode'
}

/**
 * Build one row for a participant - everything the list, its views, its
 * filters and its sorts need.
 *
 * @param {object} data - Session data
 * @param {object} participant - Participant record
 * @returns {object} Row
 */
const buildRow = (data, participant) => {
  const episodes = getEpisodesForParticipant(data, participant.id)
  const currentEpisode = getCurrentEpisode(data, participant.id)

  // Support needs are recorded per appointment, but they describe the person -
  // a wheelchair or a BSL interpreter is not a fact about one booking. So any
  // appointment recording them makes this true. Historic rounds are summaries
  // with no appointments behind them, so silence here means nothing was
  // recorded, not that no support is needed
  const hasSpecialAppointment = episodes
    .flatMap((episode) => getEpisodeAppointments(data, episode))
    .some(isSpecialAppointment)
  const lastMammogram = getLastMammogram(data, participant.id)
  const nextAppointment = getNextAppointment(data, participant.id)
  const age = getAge(participant)

  // The words in the data, slugged back to the value the filter offers
  const riskLevel = getCurrentRiskLevel(participant)
  const riskLevelValue =
    RISK_LEVELS.find((level) => level.riskLevel === riskLevel)?.value ||
    'routine'

  return {
    participant,
    currentEpisode,
    latestEpisode: episodes[episodes.length - 1] || null,
    episodeStatus: getEpisodeStatus(
      currentEpisode,
      episodes[episodes.length - 1] || null
    ),
    lastMammogram,
    lastScreenedDate: lastMammogram?.date || null,
    lastScreenedBand: getLastScreenedBand(lastMammogram?.date),
    nextAppointment,
    nextAppointmentDate: nextAppointment?.timing?.startTime || null,
    hasSpecialAppointment,
    age,
    ageBand: getAgeBand(age),
    riskLevel: riskLevelValue
  }
}

/**
 * Whether a row belongs to a view.
 *
 * @param {object} row - A row from buildRow
 * @param {string} view - One of PARTICIPANT_VIEWS
 * @returns {boolean}
 */
const rowInView = (row, view) => {
  const statuses = EPISODE_STATUSES_BY_VIEW[view] || EPISODE_STATUSES

  return statuses.includes(row.episodeStatus)
}

/**
 * Whether a row matches a free-text search.
 *
 * Name and NHS number matching is shared with the other searches in the
 * service; postcode and SX number are this index's own.
 *
 * @param {object} row - A row from buildRow
 * @param {string} query - Search text
 * @returns {boolean}
 */
const rowMatchesQuery = (row, query) => {
  if (!query) return true
  if (participantMatchesQuery(row.participant, query)) return true

  const needle = query.toLowerCase().replace(/\s+/g, '')
  if (!needle) return true

  const postcode = (row.participant.demographicInformation?.address?.postcode ||
    '')
    .toLowerCase()
    .replace(/\s+/g, '')
  const sxNumber = (row.participant.sxNumber || '')
    .toLowerCase()
    .replace(/\s+/g, '')

  return postcode.includes(needle) || sxNumber.includes(needle)
}

/**
 * The filters offered on the participant index, in the order they appear in
 * the filter column. See filter-list.js for the shape.
 *
 * Where a participant's round has got to (scheduled, mammograms, reading) is
 * deliberately absent: the views already slice on whether a round is in
 * progress, and the stage within it isn't what this list is looked at for.
 */
const PARTICIPANT_FILTER_GROUPS = [
  {
    name: 'appointment',
    legend: 'Next appointment',
    options: [
      { value: 'booked', label: 'Booked', tagLabel: 'Appointment booked' },
      {
        value: 'not_booked',
        label: 'Not booked',
        tagLabel: 'No appointment booked'
      }
    ],
    matches: (row, values) =>
      values.some((value) =>
        value === 'booked' ? Boolean(row.nextAppointment) : !row.nextAppointment
      )
  },
  {
    name: 'specialAppointment',
    legend: 'Special appointment',
    options: [
      {
        value: 'yes',
        label: 'Needs a special appointment',
        tagLabel: 'Needs a special appointment'
      },
      {
        // Not "no special appointment": most of these are people we simply
        // hold no appointment for, so the honest claim is that nothing has
        // been recorded either way
        value: 'none',
        label: 'None recorded',
        tagLabel: 'No special appointment recorded'
      }
    ],
    matches: (row, values) =>
      values.some((value) =>
        value === 'yes'
          ? row.hasSpecialAppointment
          : !row.hasSpecialAppointment
      )
  },
  {
    name: 'lastScreened',
    legend: 'Last screened',
    options: [
      ...LAST_SCREENED_BANDS.map((band) => ({
        value: band.value,
        label: band.label,
        tagLabel: `Screened ${band.label.toLowerCase()}`
      })),
      { value: 'never', label: 'Never screened' }
    ],
    matches: (row, values) => values.includes(row.lastScreenedBand)
  },
  {
    name: 'age',
    legend: 'Age',
    options: AGE_BANDS.map((band) => ({
      value: band.value,
      label: band.label,
      tagLabel: `Aged ${band.label.toLowerCase()}`
    })),
    matches: (row, values) => values.includes(row.ageBand)
  },
  {
    name: 'risk',
    legend: 'Risk level',
    options: RISK_LEVELS.map((level) => ({
      value: level.value,
      label: level.label,
      tagLabel: `${level.label} risk level`
    })),
    matches: (row, values) => values.includes(row.riskLevel)
  }
]

/**
 * A row's name key for alphabetical ordering - surname, then first name.
 *
 * @param {object} row - A row from buildRow
 * @returns {string} Sort key
 */
const getNameKey = (row) => {
  const { firstName, lastName } = row.participant?.demographicInformation || {}

  return `${lastName || ''} ${firstName || ''}`.trim().toLowerCase()
}

/**
 * Compare two dates oldest-first, with a missing date sorting last.
 *
 * Every date sort here reads as "how long ago" or "how soon", and a
 * participant with no such date answers neither - so they sit at the end
 * rather than at whichever end the epoch would put them.
 *
 * @param {string | null} a - An ISO date string, or null
 * @param {string | null} b - An ISO date string, or null
 * @returns {number}
 */
const compareDates = (a, b) => new Date(a) - new Date(b)

/**
 * Every order the list can be shown in, each with its reverse.
 *
 * `compare` orders the rows the way the first label describes; the reverse
 * negates it. `isMissing` marks a row the sort can't place - never screened,
 * no appointment booked, no date of birth - and those stay at the end in both
 * directions, because reading the question backwards doesn't make a blank
 * answer it.
 */
const SORT_DEFINITIONS = [
  {
    name: 'name',
    labels: ['Name (A to Z)', 'Name (Z to A)'],
    compare: (a, b) => getNameKey(a).localeCompare(getNameKey(b))
  },
  {
    name: 'lastScreened',
    labels: ['Last screened (oldest)', 'Last screened (newest)'],
    isMissing: (row) => !row.lastScreenedDate,
    compare: (a, b) => compareDates(a.lastScreenedDate, b.lastScreenedDate)
  },
  {
    name: 'nextAppointment',
    labels: ['Next appointment (soonest)', 'Next appointment (latest)'],
    isMissing: (row) => !row.nextAppointmentDate,
    compare: (a, b) => compareDates(a.nextAppointmentDate, b.nextAppointmentDate)
  },
  {
    name: 'age',
    labels: ['Age (oldest)', 'Age (youngest)'],
    isMissing: (row) => row.age === null || row.age === undefined,
    // Oldest first is the more useful direction here, so it leads the pair -
    // which makes this comparator descend numerically
    compare: (a, b) => b.age - a.age
  }
]

/**
 * Turn a sort definition into a comparator, in one direction or the other.
 *
 * @param {object} definition - A SORT_DEFINITIONS entry
 * @param {boolean} reversed - Whether to reverse the order
 * @returns {Function} A comparator
 */
const buildSortComparator = ({ compare, isMissing }, reversed) => {
  return (a, b) => {
    if (isMissing) {
      const aMissing = isMissing(a)
      const bMissing = isMissing(b)

      if (aMissing && bMissing) return 0
      if (aMissing) return 1
      if (bMissing) return -1
    }

    return reversed ? -compare(a, b) : compare(a, b)
  }
}

/**
 * The orders the list can be shown in, in the order they appear in the menu -
 * each definition's two directions, one after the other.
 *
 * Name leads because the index is first a way to find a person; the others
 * turn it into a work list.
 */
const PARTICIPANT_SORTS = SORT_DEFINITIONS.flatMap((definition) => [
  {
    value: definition.name,
    label: definition.labels[0],
    compare: buildSortComparator(definition, false)
  },
  {
    value: `${definition.name}Reversed`,
    label: definition.labels[1],
    compare: buildSortComparator(definition, true)
  }
])

const DEFAULT_PARTICIPANT_SORT = 'name'

// Participants sharing a sort value need a stable order, so every sort falls
// back to name, then participant id
const compareTieBreak = (a, b) =>
  getNameKey(a).localeCompare(getNameKey(b)) ||
  a.participant.id.localeCompare(b.participant.id)

/**
 * Find a sort by name, falling back to the default.
 *
 * @param {string} [sort] - A PARTICIPANT_SORTS value
 * @returns {object} The sort
 */
const getParticipantSort = (sort) => {
  return (
    PARTICIPANT_SORTS.find((candidate) => candidate.value === sort) ||
    PARTICIPANT_SORTS.find(
      (candidate) => candidate.value === DEFAULT_PARTICIPANT_SORT
    )
  )
}

/**
 * A row per participant in the view, matching the search, sorted.
 *
 * This is the population the faceted counts are drawn from - it stops short of
 * the filter groups so that ticking one option doesn't shrink the counts on
 * the others.
 *
 * `data.participants` already carries the session's changed records, overlaid
 * by the attach middleware, so it needs no per-record lookup.
 *
 * @param {object} data - Session data
 * @param {object} [filters] - Filters
 * @param {string} [filters.view] - One of PARTICIPANT_VIEWS, default 'all'
 * @param {string} [filters.query] - Name, NHS number, postcode or SX number
 * @param {string} [filters.sort] - One of PARTICIPANT_SORTS, default 'name'
 * @returns {Array} Rows
 */
const getParticipantRows = (data, filters = {}) => {
  const { view = DEFAULT_PARTICIPANT_VIEW, query = '', sort } = filters

  const rows = (data.participants || [])
    .map((participant) => buildRow(data, participant))
    .filter((row) => rowInView(row, view) && rowMatchesQuery(row, query))

  const { compare } = getParticipantSort(sort)

  return rows.sort((a, b) => compare(a, b) || compareTieBreak(a, b))
}

/**
 * The participant index, searched, filtered and sorted.
 *
 * @param {object} data - Session data
 * @param {object} [filters] - Filters
 * @param {string} [filters.view] - One of PARTICIPANT_VIEWS, default 'all'
 * @param {string} [filters.query] - Name, NHS number, postcode or SX number
 * @param {string} [filters.sort] - One of PARTICIPANT_SORTS, default 'name'
 * @param {Array} [filters.groups] - Filter groups (PARTICIPANT_FILTER_GROUPS)
 * @param {object} [filters.selected] - Group name -> selected values
 * @returns {object} `{ rows, totalCount, truncated }` - rows capped at MAX_ROWS
 */
const getParticipantList = (data, filters = {}) => {
  const { groups = [], selected = {} } = filters

  const rows = applyFilterGroups(
    getParticipantRows(data, filters),
    groups,
    selected
  )

  return {
    rows: rows.slice(0, MAX_ROWS),
    totalCount: rows.length,
    truncated: rows.length > MAX_ROWS
  }
}

module.exports = {
  MAX_ROWS,
  PARTICIPANT_VIEWS,
  PARTICIPANT_VIEW_LABELS,
  DEFAULT_PARTICIPANT_VIEW,
  PARTICIPANT_SORTS,
  DEFAULT_PARTICIPANT_SORT,
  PARTICIPANT_FILTER_GROUPS,
  AGE_BANDS,
  LAST_SCREENED_BANDS,
  EPISODE_STATUSES,
  getEpisodeStatus,
  getLastScreenedBand,
  getAgeBand,
  getParticipantSort,
  getParticipantRows,
  getParticipantList
}
