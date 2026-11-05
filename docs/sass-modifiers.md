# Sass modifiers

Project modifier classes you can add to a component, through its `classes` option if it is a macro. Check here before writing a new class. `npm test` fails if a class listed here no longer exists in the Sass.

This list leaves out modifiers that a macro sets through its own parameters, and those that belong to one page. For components, see [components.md](components.md).

| Class | Add to | What it does |
|---|---|---|
| `app-action-link--small` | NHS `actionLink` | Smaller text and arrow, for dense places such as dashboards |
| `app-card--feature-grey` | NHS `card` with `variant: "feature"` | Grey heading and pale grey background |
| `app-card--feature-green` | NHS `card` with `variant: "feature"` | Green heading |
| `app-card--feature-orange` | NHS `card` with `variant: "feature"` | Orange heading |
| `app-count--reverse` | `appCount` | Dark blue badge, for a count on a blue background |
| `app-link--warning` | `appLink`, NHS `link` or `nhsuk-link` | Red link, for destructive actions |
| `app-link-button--warning` | `app-link-button` | Red version of a button styled as a link |
| `app-status-message--small` | `appStatusMessage` | Smaller text |
