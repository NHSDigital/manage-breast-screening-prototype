# Modal system

Forms in this prototype can be opened in a modal overlay instead of navigating to a separate page. The system is progressively enhanced — without JavaScript, links navigate normally.

## How it works

The modal is a single persistent `<div id="app-form-modal">` in the page. When a modal link is clicked, `modal.js` fetches the target URL as an AJAX fragment and injects it into the modal dialog. The server detects the request and renders a bare fragment layout instead of the full page.

### Server-side detection

Middleware in `app/routes.js` detects modal requests by:

- `X-Requested-With: XMLHttpRequest` header (set on the initial fetch)
- `?_modal=1` query param (threaded through subsequent redirects and form POSTs)

When detected, it sets `res.locals.parentLayout = '_templates/layout-modal-form.html'` and wraps `res.redirect()` to preserve `?_modal=1` through server-side redirect chains.

### Templates

Pages that may be opened in a modal must extend `parentLayout or` rather than a fixed layout:

```nunjucks
{% extends parentLayout or 'layout-appointment.html' %}
```

The `layout-modal-form.html` layout outputs only:

- Error summary
- A hidden back link (shown by JS when navigating deeper)
- A `<div class="app-modal__body">` wrapper
- A `<div data-form-action="...">` container (handles nested-form limitations)
- A hidden `<input name="_modal" value="1">` to thread the param through POSTs

## Opening a link in a modal

Use the `openInModal` Nunjucks filter. It adds data attributes to the link/button/item while keeping the real `href` (or form submit) for progressive enhancement.

**Standalone link:**

```nunjucks
{{ appLink({ text: "Cancel appointment", href: cancelUrl } | openInModal) }}
```

**Button with href:**

```nunjucks
{{ button({ text: "Add", href: addUrl } | openInModal) }}
```

**Submit button (no href) — POST-then-open pattern:**

For submit buttons that trigger a server-side redirect (no pre-known URL), `openInModal` adds `data-modal-submit` instead of `data-load-modal-url`. A delegated handler in `modal.js` intercepts the click, POSTs the form via fetch, and opens the redirect destination in the modal. Without JS the button submits normally.

```nunjucks
{{ button({
  text: "Technical recall",
  value: "technical_recall",
  name: "someField"
} | openInModal) }}
```

**Summary list action item:**

```nunjucks
{
  href: editUrl,
  text: "Change",
  visuallyHiddenText: "something"
} | openInModal
```

**Entire summary list (all action items wired):**

```nunjucks
{{ summaryList(params | openInModal) }}
```

`openInModal` only activates when `data.settings.modalForms` is `'true'`. Otherwise it returns the component unchanged, so the same template code works with or without modals enabled.

## Routing and redirects

Once a form is inside a modal, the middleware threads `?_modal=1` through all redirects automatically — no per-route changes needed for simple flows.

### Escaping the modal (breakout)

When a form flow is complete and the modal should close, wrap the redirect URL with `modalBreakout()`:

```js
const { modalBreakout } = require('../lib/utils/referrers')

// In a route handler:
res.redirect(modalBreakout(eventUrl))

// Or combined with getReturnUrl:
res.redirect(modalBreakout(getReturnUrl(eventUrl, req.query.referrerChain)))
```

`modalBreakout` appends `?_modal_breakout=1` to the URL. The middleware intercepts this and returns a 200 `<div data-modal-navigate="...">` fragment instead of a real redirect. `modal.js` reads this, closes the modal, and navigates the browser to the destination — preserving any flash messages that would otherwise be consumed.

Use `modalBreakout` on **every terminal redirect** from a route that may be reached from inside a modal: saves, deletes, and completed flows.

### Multi-step flows inside the modal

If a POST redirects to another form page (e.g. a warning or confirmation step), the modal stays open and loads the next page automatically. This works because `?_modal=1` is threaded through the redirect. Intermediate pages need `parentLayout or` to render as fragments.

### Return URL threading

Use `urlWithReferrer(referrerChain)` on form action URLs when you need to track where to return after a flow completes. The referrer chain is carried through the modal alongside `_modal`.

```nunjucks
{% set formAction = "./edit-answer" | urlWithReferrer(referrerChain) %}
```

In the route, use `getReturnUrl` with the referrer chain to resolve where to go:

```js
const returnUrl = modalBreakout(getReturnUrl(fallbackUrl, req.query.referrerChain))
res.redirect(returnUrl)
```

## Duplicate ID protection

When a modal loads content onto a page, both the page and the modal fragment may have form fields with the same `name` attribute. NHS Frontend derives `id` attributes from `name`, which would produce duplicate IDs in the DOM — causing hover states and other CSS to bleed across.

`modal.js` automatically prefixes all IDs inside modal content with `modal-` after loading, and updates all `for`, `aria-*`, and `href="#..."` references to match. This runs after `initAll()` so that NHS Frontend's conditional reveal initialises with the original IDs before they are renamed.

## Checklist for wiring a page to a modal

1. Template extends `parentLayout or 'layout-something.html'`
2. `{% set formAction = "..." | urlWithReferrer(referrerChain) %}` (so referrer survives)
3. Links to the page use `| openInModal`
4. Terminal route redirects use `modalBreakout()`
5. Intermediate pages in the flow also extend `parentLayout or`
