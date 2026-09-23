// app/lib/utils/issue-list.js
//
// Listing issues - the population behind /review/issues and the open count on
// the Review landing page and nav item.
//
// The list layer over issues.js, as participant-list.js is over participants.js:
// it builds a row per issue carrying what the index and its filters need, then
// hands it to the generic filter helpers in filter-list.js.

const {
  ISSUE_TYPES,
  ISSUE_LINK_TYPES,
  getIssueStatus,
  isIssueOpen
} = require('./issues')
const { getParticipant } = require('./participants')

// Which issues the index shows. Open is the work to do, so it is the default;
// closed issues are one tab away rather than a filter to remember to untick
const ISSUE_VIEWS = ['open', 'resolved', 'all']

const ISSUE_VIEW_LABELS = {
  open: 'Open',
  resolved: 'Resolved',
  all: 'All'
}

const DEFAULT_ISSUE_VIEW = 'open'

// Where an issue sits: the most specific record it links to. createIssue links
// the record an issue was raised on plus every record containing it, so an
// issue raised during reading links to a reading case and one raised on an
// appointment's images links to the appointment but no case.
const ISSUE_PLACES = [
  {
    value: 'reading',
    label: 'Image reading',
    tagLabel: 'Raised in image reading',
    linkType: 'readingCase'
  },
  {
    value: 'appointment',
    label: 'Appointment',
    tagLabel: 'Raised in an appointment',
    linkType: 'appointment'
  },
  {
    value: 'episode',
    label: 'Episode',
    tagLabel: 'Raised on an episode',
    linkType: 'episode'
  }
]

/**
 * Where an issue sits - the most specific record it links to.
 *
 * @param {object} issue - Issue
 * @returns {object | null} An ISSUE_PLACES entry, or null if it links to none of them
 * @example
 * getIssuePlace(issue).label // 'Image reading'
 */
const getIssuePlace = (issue) => {
  const linkTypes = (issue?.links || []).map((link) => link.type)
  const mostSpecificType = ISSUE_LINK_TYPES.find((linkType) =>
    linkTypes.includes(linkType)
  )

  return ISSUE_PLACES.find((place) => place.linkType === mostSpecificType) || null
}

/**
 * Build one row for an issue - everything the index, its views and its
 * filters need.
 *
 * @param {object} data - Session data
 * @param {object} issue - Issue
 * @returns {object} Row
 */
const buildRow = (data, issue) => {
  const participantLink = (issue.links || []).find(
    (link) => link.type === 'participant'
  )

  return {
    issue,
    status: getIssueStatus(issue),
    place: getIssuePlace(issue),
    participant: getParticipant(data, participantLink?.id)
  }
}

/**
 * The filters offered on the issue index, in the order they appear in the
 * filter column. See filter-list.js for the shape.
 */
const ISSUE_FILTER_GROUPS = [
  {
    name: 'type',
    legend: 'Type',
    options: ISSUE_TYPES.map((issueType) => ({
      value: issueType.value,
      label: issueType.label
    })),
    matches: (row, values) => values.includes(row.issue.type)
  },
  {
    name: 'place',
    legend: 'Raised in',
    options: ISSUE_PLACES.map(({ value, label, tagLabel }) => ({
      value,
      label,
      tagLabel
    })),
    matches: (row, values) => values.includes(row.place?.value)
  }
]

/**
 * Whether an issue belongs to a BSU. With no BSU given, every issue does.
 *
 * @param {object} issue - Issue
 * @param {string} [breastScreeningUnitId] - BSU ID
 * @returns {boolean}
 */
const isIssueInUnit = (issue, breastScreeningUnitId) =>
  !breastScreeningUnitId ||
  issue.breastScreeningUnitId === breastScreeningUnitId

/**
 * Whether a row belongs to a view.
 *
 * @param {object} row - A row from buildRow
 * @param {string} view - One of ISSUE_VIEWS
 * @returns {boolean}
 */
const rowInView = (row, view) => {
  if (view === 'open') return isIssueOpen(row.issue)
  if (view === 'resolved') return !isIssueOpen(row.issue)

  return true
}

/**
 * A row per issue in a BSU and view, newest raised first.
 *
 * This is the population the faceted counts are drawn from - it stops short of
 * the filter groups so that ticking one option doesn't shrink the counts on
 * the others.
 *
 * @param {object} data - Session data
 * @param {object} [filters] - Filters
 * @param {string} [filters.breastScreeningUnitId] - Only this BSU's issues; all when left out
 * @param {string} [filters.view] - One of ISSUE_VIEWS, default 'open'
 * @returns {Array} Rows
 */
const getIssueRows = (data, filters = {}) => {
  const { breastScreeningUnitId, view = DEFAULT_ISSUE_VIEW } = filters

  return (data.issues || [])
    .filter((issue) => isIssueInUnit(issue, breastScreeningUnitId))
    .map((issue) => buildRow(data, issue))
    .filter((row) => rowInView(row, view))
    .sort((a, b) => new Date(b.issue.raisedAt) - new Date(a.issue.raisedAt))
}

/**
 * How many open issues a BSU has - the count on the Review nav item and the
 * issues card.
 *
 * @param {object} data - Session data
 * @param {string} [breastScreeningUnitId] - BSU ID; every BSU when left out
 * @returns {number} Open issues
 * @example
 * {{ data | getOpenIssueCount(currentUser.breastScreeningUnit) }}
 */
const getOpenIssueCount = (data, breastScreeningUnitId) =>
  (data?.issues || []).filter(
    (issue) => isIssueOpen(issue) && isIssueInUnit(issue, breastScreeningUnitId)
  ).length

module.exports = {
  ISSUE_VIEWS,
  ISSUE_VIEW_LABELS,
  DEFAULT_ISSUE_VIEW,
  ISSUE_PLACES,
  ISSUE_FILTER_GROUPS,
  getIssuePlace,
  getIssueRows,
  getOpenIssueCount
}
