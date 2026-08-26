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
//     style: 'radios'                          // optional, single value
//   }
//
// Multi-select within a group is OR; groups combine with AND. A group with
// `style: 'radios'` holds one value at a time instead.

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

    // A radios group holds one value at a time, so a URL offering several
    // keeps the first
    selected[group.name] = group.style === 'radios' ? unique.slice(0, 1) : unique
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
 * @param {string} [ignoreGroupName] - Group to leave out of the test
 * @returns {boolean}
 */
const rowMatchesGroups = (row, groups, selected, ignoreGroupName = null) => {
  for (const group of groups) {
    if (group.name === ignoreGroupName) continue

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
 * Faceted: a group's own selection is left out of its own counts, so ticking
 * one option doesn't zero out the rest of that group. Every other group's
 * selection still applies.
 *
 * @param {Array} rows - Rows before any group filtering
 * @param {Array} groups - Filter groups
 * @param {object} selected - Group name -> selected values
 * @returns {object} Group name -> option value -> count
 */
const getFilterCounts = (rows = [], groups = [], selected = {}) => {
  const counts = {}

  for (const group of groups) {
    const candidates = rows.filter((row) =>
      rowMatchesGroups(row, groups, selected, group.name)
    )

    counts[group.name] = {}

    for (const option of group.options) {
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
        label: option.label,
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
  applyFilterGroups,
  getFilterCounts,
  describeSelectedFilters,
  buildFilterUrl,
  hasSelectedFilters
}
