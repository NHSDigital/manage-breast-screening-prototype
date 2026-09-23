// app/lib/utils/issue-list.js
//
// Listing issues - the population behind /review/issues and the open count on
// the Review landing page and nav item.
//
// The list layer over issues.js, as participant-list.js is over participants.js:
// it builds a row per issue carrying what the index, its filters and its sorts
// need, and the filter groups the index route applies to those rows with the
// generic helpers in filter-list.js.

const {
  ISSUE_TYPES,
  ISSUE_LINK_TYPES,
  getIssueStatus,
  isIssueOpen
} = require('./issues')
const { getParticipant } = require('./participants')
const {
  EPISODE_STAGES,
  getEpisode,
  getEpisodeStageText
} = require('./episodes')
const { participantMatchesQuery } = require('./search')

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
    linkType: 'readingCase',
    description: 'In image reading'
  },
  {
    linkType: 'appointment',
    description: 'At an appointment'
  },
  {
    linkType: 'episode',
    description: 'On an episode'
  }
]

/**
 * Where an issue sits - the most specific record it links to.
 *
 * @param {object} issue - Issue
 * @returns {object | null} An ISSUE_PLACES entry, or null if it links to none of them
 * @example
 * getIssuePlace(issue).description // 'In image reading'
 */
const getIssuePlace = (issue) => {
  const linkTypes = (issue?.links || []).map((link) => link.type)
  const mostSpecificType = ISSUE_LINK_TYPES.find((linkType) =>
    linkTypes.includes(linkType)
  )

  return ISSUE_PLACES.find((place) => place.linkType === mostSpecificType) || null
}

/**
 * The id of the first record of a type an issue links to.
 *
 * @param {object} issue - Issue
 * @param {string} linkType - One of ISSUE_LINK_TYPES
 * @returns {string | undefined} Record ID
 */
const getLinkedId = (issue, linkType) =>
  (issue.links || []).find((link) => link.type === linkType)?.id

/**
 * Build one row for an issue - everything the index, its filters and its
 * sorts need.
 *
 * The episode stage is where the round is now, not where it was when the
 * issue was raised: what someone triaging needs to know is whether the issue
 * is holding anything up today.
 *
 * @param {object} data - Session data
 * @param {object} issue - Issue
 * @returns {object} Row
 */
const buildRow = (data, issue) => {
  const episode = getEpisode(data, getLinkedId(issue, 'episode'))

  return {
    issue,
    status: getIssueStatus(issue),
    participant: getParticipant(data, getLinkedId(issue, 'participant')),
    episodeStage: episode?.stage || null
  }
}

/**
 * Whether an issue belongs to a BSU. With no BSU given, every issue does.
 *
 * @param {object} issue - Issue
 * @param {string} [breastScreeningUnitId] - BSU ID
 * @returns {boolean}
 * @example
 * isIssueInUnit(issue, data.currentUser.breastScreeningUnit)
 */
const isIssueInUnit = (issue, breastScreeningUnitId) =>
  Boolean(issue) &&
  (!breastScreeningUnitId ||
    issue.breastScreeningUnitId === breastScreeningUnitId)

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
 * The filters offered on the issue index, in the order they appear in the
 * filter column. See filter-list.js for the shape.
 *
 * Chosen for triage: what kind of problem it is (who can fix it), where the
 * participant's round is now (whether the issue is holding anything up
 * today), and the issues the user raised themselves (to follow up their own).
 *
 * @param {string} [currentUserId] - The signed-in user, for the "Raised by" filter
 * @returns {Array} Filter groups
 */
const getIssueFilterGroups = (currentUserId) => {
  const groups = [
    {
      name: 'type',
      legend: 'Issue type',
      options: ISSUE_TYPES.map((issueType) => ({
        value: issueType.value,
        label: issueType.label
      })),
      matches: (row, values) => values.includes(row.issue.type)
    },
    {
      name: 'stage',
      legend: 'Episode stage',
      options: EPISODE_STAGES.map((stage) => ({
        value: stage,
        label: getEpisodeStageText(stage),
        tagLabel: `Episode stage: ${getEpisodeStageText(stage).toLowerCase()}`
      })),
      matches: (row, values) => values.includes(row.episodeStage)
    }
  ]

  if (currentUserId) {
    groups.push({
      name: 'raisedBy',
      legend: 'Raised by',
      options: [
        {
          value: 'me',
          label: 'Me',
          tagLabel: 'Raised by me'
        }
      ],
      matches: (row) => row.issue.raisedBy === currentUserId
    })
  }

  return groups
}

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

const compareRaised = (a, b) =>
  new Date(a.issue.raisedAt) - new Date(b.issue.raisedAt)

/**
 * The orders the list can be shown in, in the order they appear in the menu.
 * Newest first leads because new issues are the ones nobody has looked at yet.
 */
const ISSUE_SORTS = [
  {
    value: 'raised_desc',
    label: 'Raised – newest first',
    compare: (a, b) => compareRaised(b, a)
  },
  {
    value: 'raised_asc',
    label: 'Raised – oldest first',
    compare: compareRaised
  },
  {
    value: 'surname',
    label: 'Surname A to Z',
    compare: (a, b) => getNameKey(a).localeCompare(getNameKey(b))
  }
]

const DEFAULT_ISSUE_SORT = 'raised_desc'

// Issues sharing a sort value need a stable order - one participant can have
// several issues - so every sort falls back to newest raised, then issue id
const compareTieBreak = (a, b) =>
  compareRaised(b, a) || a.issue.id.localeCompare(b.issue.id)

/**
 * The sort to apply, falling back to the default when the value is unknown.
 *
 * @param {string} [value] - A sort value
 * @returns {object} An entry from ISSUE_SORTS
 */
const getIssueSort = (value) =>
  ISSUE_SORTS.find((sort) => sort.value === value) ||
  ISSUE_SORTS.find((sort) => sort.value === DEFAULT_ISSUE_SORT)

/**
 * A row per issue in a BSU and view, matching the search, sorted.
 *
 * This is the population the faceted counts are drawn from - it stops short
 * of the filter groups so that ticking one option doesn't shrink the counts
 * on the others.
 *
 * @param {object} data - Session data
 * @param {object} [filters] - Filters
 * @param {string} [filters.breastScreeningUnitId] - Only this BSU's issues; all when left out
 * @param {string} [filters.view] - One of ISSUE_VIEWS, default 'open'
 * @param {string} [filters.query] - Participant name or NHS number
 * @param {string} [filters.sort] - One of ISSUE_SORTS, default 'raised_desc'
 * @returns {Array} Rows
 */
const getIssueRows = (data, filters = {}) => {
  const {
    breastScreeningUnitId,
    view = DEFAULT_ISSUE_VIEW,
    query = '',
    sort
  } = filters

  const { compare } = getIssueSort(sort)

  return (data.issues || [])
    .filter((issue) => isIssueInUnit(issue, breastScreeningUnitId))
    .map((issue) => buildRow(data, issue))
    .filter(
      (row) =>
        rowInView(row, view) && participantMatchesQuery(row.participant, query)
    )
    .sort((a, b) => compare(a, b) || compareTieBreak(a, b))
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
  ISSUE_SORTS,
  DEFAULT_ISSUE_SORT,
  getIssuePlace,
  isIssueInUnit,
  getIssueFilterGroups,
  getIssueRows,
  getOpenIssueCount
}
