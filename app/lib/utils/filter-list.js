// app/lib/utils/filter-list.js
//
// Generic checkbox filtering for index pages.
//
// A page declares its filters as data - an array of filter groups - and passes
// them through these helpers and the appFilterPanel component. Nothing here
// knows what a row is: only a group's `matches` function touches the row, so
// the same helpers serve reading cases, participants, episodes and anything
// else with a list to narrow down.
//
// A filter group is:
//
//   {
//     name: 'status',                          // query param name
//     legend: 'Status',                        // fieldset legend
//     options: [{ value, label }],             // the checkboxes
//     matches: (row, values) => boolean,       // OR within the group
//     style: 'radios',                         // optional, single value
//     emptyLabel: 'Anyone'                     // select only: the "no choice" option
//   }
//
// Multi-select within a group is OR; groups combine with AND. A group with
// `style: 'radios'` or `style: 'select'` holds one value at a time instead.
//
// An option may carry a `tagLabel` for the selected-filters summary, where its
// group's legend isn't there to give it context.
//
// An option may also `reveal` another group by name - the revealed group is
// rendered inside the option's conditional reveal rather than as a group of
// its own, and only applies while that option is chosen. The revealing option
// is a mode rather than a filter, so it narrows nothing itself and takes no
// tag; `hideCount: true` keeps a meaningless count off it.

/**
 * Coerce a query param to an array. Express gives a string for one value and
 * an array for repeated ones.
 *
 * @param {*} value - Query param value
 * @returns {Array} Values, empty when nothing was given
 */
const toValueArray = (value) => {
  if (value === undefined || value === null || value === '') return []
  return Array.isArray(value) ? value : [value]
}

/**
 * The names of every group that another group's option reveals - the groups a
 * filter panel renders inside a conditional rather than on their own.
 *
 * @param {Array} groups - Filter groups
 * @returns {string[]} Group names
 */
const getRevealedGroupNames = (groups = []) => {
  return groups.flatMap((group) =>
    group.options.map((option) => option.reveals).filter(Boolean)
  )
}

/**
 * Whether a group is revealed by an option that isn't currently chosen - so
 * its own selection shouldn't count.
 *
 * @param {object} group - The group to test
 * @param {Array} groups - Every filter group
 * @param {object} selected - Group name -> selected values
 * @returns {boolean} True when the group is revealed but its option isn't chosen
 */
const isRevealed = (group, groups, selected) => {
  for (const candidate of groups) {
    for (const option of candidate.options) {
      if (option.reveals !== group.name) continue

      if (!(selected[candidate.name] || []).includes(String(option.value))) {
        return true
      }
    }
  }

  return false
}

/**
 * Read the selected filter values out of a query string, discarding anything
 * that isn't one of the group's own options.
 *
 * Accepts repeated params (`?status=a&status=b`, what a checkbox form sends)
 * and the comma form (`?status=a,b`) for hand-written links.
 *
 * @param {object} query - req.query
 * @param {Array} groups - Filter groups
 * @returns {object} Group name -> array of valid selected values
 */
const parseFilterQuery = (query = {}, groups = []) => {
  const selected = {}

  for (const group of groups) {
    const allowed = new Set(group.options.map((option) => String(option.value)))

    const values = toValueArray(query[group.name])
      .flatMap((value) => String(value).split(','))
      .map((value) => value.trim())
      .filter((value) => allowed.has(value))

    const unique = [...new Set(values)]

    // A radios or select group holds one value at a time, so a URL offering
    // several keeps the first
    const singleValue = group.style === 'radios' || group.style === 'select'

    selected[group.name] = singleValue ? unique.slice(0, 1) : unique
  }

  // A revealed group only applies while the option revealing it is chosen -
  // without JavaScript the hidden select still submits its value, and a stale
  // one would silently narrow the list
  for (const group of groups) {
    if (!isRevealed(group, groups, selected)) continue

    selected[group.name] = []
  }

  return selected
}

/**
 * Whether a row satisfies every group's selection, optionally ignoring one
 * group - the basis of faceted counts.
 *
 * @param {object} row - A row
 * @param {Array} groups - Filter groups
 * @param {object} selected - Group name -> selected values
 * @param {string[]} [ignoreGroupNames] - Groups to leave out of the test
 * @returns {boolean}
 */
const rowMatchesGroups = (row, groups, selected, ignoreGroupNames = []) => {
  for (const group of groups) {
    if (ignoreGroupNames.includes(group.name)) continue

    const values = selected[group.name] || []
    if (!values.length) continue

    if (!group.matches(row, values)) return false
  }

  return true
}

/**
 * The rows matching every group's selection. An unselected group filters
 * nothing.
 *
 * @param {Array} rows - Rows to filter
 * @param {Array} groups - Filter groups
 * @param {object} selected - Group name -> selected values
 * @returns {Array} Matching rows
 */
const applyFilterGroups = (rows = [], groups = [], selected = {}) => {
  return rows.filter((row) => rowMatchesGroups(row, groups, selected))
}

/**
 * How many rows each option would show.
 *
 * Faceted: a group's own selection - and that of any group it reveals - is
 * left out of its own counts, so ticking one option doesn't zero out the rest
 * of that group. Every other group's selection still applies.
 *
 * @param {Array} rows - Rows before any group filtering
 * @param {Array} groups - Filter groups
 * @param {object} selected - Group name -> selected values
 * @returns {object} Group name -> option value -> count
 */
const getFilterCounts = (rows = [], groups = [], selected = {}) => {
  const counts = {}

  for (const group of groups) {
    // A group and the groups it reveals are one question in the panel, so a
    // revealed group's selection doesn't shape its revealer's counts
    const ignored = [
      group.name,
      ...group.options.map((option) => option.reveals).filter(Boolean)
    ]

    const candidates = rows.filter((row) =>
      rowMatchesGroups(row, groups, selected, ignored)
    )

    counts[group.name] = {}

    for (const option of group.options) {
      if (option.hideCount) continue

      counts[group.name][option.value] = candidates.filter((row) =>
        group.matches(row, [option.value])
      ).length
    }
  }

  return counts
}

/**
 * Build a URL carrying a filter selection plus any params the page keeps
 * alongside it (search text, view).
 *
 * @param {string} baseUrl - Path, without a query string
 * @param {object} [selected] - Group name -> selected values
 * @param {object} [extraParams] - Other params to carry; empty values dropped
 * @returns {string} URL
 */
const buildFilterUrl = (baseUrl, selected = {}, extraParams = {}) => {
  const params = new URLSearchParams()

  for (const [name, value] of Object.entries(extraParams)) {
    if (value === undefined || value === null || value === '') continue
    params.append(name, value)
  }

  for (const [name, values] of Object.entries(selected)) {
    for (const value of values || []) {
      params.append(name, value)
    }
  }

  const queryString = params.toString()

  return queryString ? `${baseUrl}?${queryString}` : baseUrl
}

/**
 * The active filters as a flat list, each with the URL that removes it - the
 * selected-filters summary above a set of results.
 *
 * @param {Array} groups - Filter groups
 * @param {object} selected - Group name -> selected values
 * @param {string} baseUrl - Page path, without a query string
 * @param {object} [extraParams] - Other params to carry on the removal URLs
 * @returns {Array} `{ groupName, legend, value, label, href }` per active filter
 */
const describeSelectedFilters = (
  groups = [],
  selected = {},
  baseUrl = '',
  extraParams = {}
) => {
  const items = []

  for (const group of groups) {
    for (const value of selected[group.name] || []) {
      const option = group.options.find(
        (candidate) => String(candidate.value) === String(value)
      )
      if (!option) continue

      // A revealing option is a mode, not a filter - the group it reveals
      // carries the meaning, and its own tag
      if (option.reveals) continue

      const remaining = {
        ...selected,
        [group.name]: (selected[group.name] || []).filter(
          (candidate) => candidate !== value
        )
      }

      items.push({
        groupName: group.name,
        legend: group.legend,
        value: option.value,
        label: option.tagLabel || option.label,
        href: buildFilterUrl(baseUrl, remaining, extraParams)
      })
    }
  }

  return items
}

/**
 * Whether anything is selected at all - for showing or hiding the summary.
 *
 * @param {object} selected - Group name -> selected values
 * @returns {boolean}
 */
const hasSelectedFilters = (selected = {}) => {
  return Object.values(selected).some((values) => (values || []).length > 0)
}

module.exports = {
  parseFilterQuery,
  getRevealedGroupNames,
  applyFilterGroups,
  getFilterCounts,
  describeSelectedFilters,
  buildFilterUrl,
  hasSelectedFilters
}
