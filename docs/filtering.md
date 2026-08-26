# Filtering an index page

Index pages filter with checkboxes in a left-hand column. The setup is generic: a page declares its filters as **data** and passes them through one set of helpers and one component. Reading cases (`app/routes/reading-cases.js`, `app/views/reading/cases.html`) is the worked example.

## 1. Declare the filter groups

A filter group is plain data plus one function that knows the page's row shape:

```js
{
  name: 'status',                     // query param name
  legend: 'Status',                   // fieldset legend
  options: [{ value, label }],        // the checkboxes, in display order
  matches: (row, values) => boolean,  // OR within the group
  style: 'radios'                     // optional - one value at a time
}
```

Multi-select within a group is OR; groups combine with AND. A group with `style: 'radios'` renders NHS radios instead of checkboxes and holds a single value: `parseFilterQuery` keeps the first valid one, so a hand-written URL offering several still resolves. Keep the array next to whatever builds the rows — reading cases keeps `READING_CASE_FILTER_GROUPS` in `app/lib/utils/reading-case-list.js`.

## 2. Wire the route

`app/lib/utils/filter-list.js`:

- `parseFilterQuery(req.query, groups)` — selected values per group. Checkbox forms send repeated params (`?status=a&status=b`); the comma form works too. Anything not in a group's own options is discarded.
- `applyFilterGroups(rows, groups, selected)` — the filtered rows.
- `getFilterCounts(rows, groups, selected)` — counts for every option, faceted: a group's own selection is left out of its own counts, so ticking one option doesn't zero out the rest of that group.
- `describeSelectedFilters(groups, selected, baseUrl, extraParams)` — the flat list for the selected-filters summary, each with the URL that removes it.
- `buildFilterUrl(baseUrl, selected, extraParams)` — a URL carrying a selection plus anything the page keeps alongside it (search text, view).
- `hasSelectedFilters(selected)` — whether to show the summary at all.

Counts come from the rows **before** any group filtering, so the route needs both: the unfiltered population and the filtered list.

```js
const groups = MY_FILTER_GROUPS
const selected = parseFilterQuery(req.query, groups)

const baseRows = getMyRows(data, { query })
const rows = applyFilterGroups(baseRows, groups, selected)

res.render('my/index', {
  rows,
  groups,
  selected,
  counts: getFilterCounts(baseRows, groups, selected),
  selectedFilters: describeSelectedFilters(groups, selected, '/my/index', { q: query }),
  isFiltered: hasSelectedFilters(selected),
  query,
  hiddenFields: { view }
})
```

Everything in `app/lib/utils` is registered as a Nunjucks filter automatically (`app/filters.js`), so `buildFilterUrl` and friends are usable in templates too.

## 3. Render the panel

`appFilterPanel` is imported in `app/views/_templates/layout.html`, so it is available without an import:

```njk
{{ appFilterPanel({
  action: "/my/index",
  groups: groups,
  selected: selected,
  counts: counts,
  search: {
    name: "q",
    value: query,
    label: { text: "Search by name or NHS number" }
  },
  hiddenFields: hiddenFields
}) }}
```

It renders a GET form as a grey feature card headed "Search and filter": the search box first, then a small-checkbox (or radios) fieldset per group with counts in the labels, then small "Apply filters" and "Clear filters" buttons. Search is part of the same form as the filters, so searching narrows what is on screen rather than resetting it, and `search` can be left out where a page has no search. "Clear filters" only appears when a filter or search is active, and clears both. `hiddenFields` are the params filtering must not drop — the current view — and they survive clearing.

## 4. Layout

Filter pages use the wide container with a third/two-thirds split:

```njk
{% set gridColumn = "nhsuk-grid-column-full" %}
{% set bodyClasses = (bodyClasses or "") + " app-page-width--wide" %}
```

```njk
<div class="nhsuk-grid-row">
  <div class="nhsuk-grid-column-one-third">{# panel #}</div>
  <div class="nhsuk-grid-column-two-thirds">{# summary, results #}</div>
</div>
```

The selected-filters summary sits above the results in the right-hand column.

## 5. Live updating (optional)

Pass `live` a CSS selector for the region that should update in place:

```njk
<div class="nhsuk-grid-row" id="filter-results">
  <div class="nhsuk-grid-column-one-third">
    {{ appFilterPanel({ ..., live: "#filter-results" }) }}
  </div>
  <div class="nhsuk-grid-column-two-thirds">{# results #}</div>
</div>
```

That puts `data-live-filters` on the form, and `app/assets/javascript/live-filters.js` takes it from there: ticking a checkbox, typing in the search box (debounced) or submitting the form fetches the same URL, morphs the region to the response with [idiomorph](https://github.com/bigskysoftware/idiomorph), and pushes the URL to history. Back and forward re-fetch the same way.

The region must contain the form, and should wrap the results too — that way one update refreshes the panel counts, the selected filters, the view tabs and the table together. Links inside the region pointing at the form's own path — "Clear filters", the selected-filter pills, the view tabs — are intercepted and updated in place as well; links anywhere else (a case, a participant) navigate normally.

The "Apply filters" button is hidden while the script is running, and the active view tab's text is announced in a visually hidden `role="status"` region. If a fetch fails the page falls back to a normal submission or navigation, and with JavaScript off none of this runs: the form is a plain GET and everything above behaves exactly as documented.

## Search

`app/lib/utils/search.js` holds the shared matching so every search box in the service behaves the same: `participantMatchesQuery(participant, query)` matches name orderings (including "SURNAME, Firstname", the form the tables present) and NHS number. A page with extra fields to search — the participant index also matches postcode and SX number — layers those on top of it.

## Notes

- Filtering is URL-driven and works without JavaScript; live updating is progressive enhancement on top (see above).
- A group's options are its declared list, so an option can show a count of zero where nothing in the current population matches it. States nothing ever sets are left out of the list instead.
