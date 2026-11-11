# Referrers: returning to where the user came from

Pages that can be reached from several places (edit forms, add flows, detail pages) need to send the user back to the right place afterwards. The referrer chain does this. Always use its filters rather than hand-building `?returnTo=` or similar query strings.

## How it works

The chain is a query parameter, `referrerChain`, holding a comma-separated list of paths:

```
/edit/123?referrerChain=/check-information,/confirm-information/medical-history
```

- Going deeper appends the current page to the chain.
- Going back pops the last entry and goes there, carrying the rest of the chain.
- When the chain is empty the fallback URL is used.

The filters encode the chain, so an entry can carry its own query string. A filtered or tabbed list passes its full URL rather than `currentUrl` (which is the path alone), so coming back restores the filters: see the issue links in `app/views/review/issues/index.html`.

Every view has `currentUrl` (the current path) and `referrerChain` (from the query string) available as locals, set in [app/locals.js](../app/locals.js). Routes read it from `req.query.referrerChain`.

The filters are in [app/lib/utils/referrers.js](../app/lib/utils/referrers.js) and are available in templates and routes:

| Filter | Use for |
|---|---|
| `urlWithReferrer(chain, scrollToId)` | A link or form action that goes *deeper*. Adds `?referrerChain=chain` to the URL |
| `getReturnUrl(chain, scrollToId)` | A link or form action that goes *back*. Pops the chain, returns the destination with the remaining chain attached, or the fallback URL if the chain is empty |
| `appendReferrer(chain, url)` | Extends a chain with another URL. Used to build the chain passed to `urlWithReferrer` |
| `modalBreakout(url)` | Wraps a return URL so a modal form navigates the whole page. See [modal-system.md](modal-system.md) |

## The three patterns

### 1. Link out to a deeper page

The user should come back here afterwards.

```njk
{# Starting a chain from this page #}
<a href="{{ './medical-history/edit' | urlWithReferrer(currentUrl) }}">Change</a>

{# Already inside a flow: extend the chain rather than replace it #}
<a href="{{ './edit/123' | urlWithReferrer(referrerChain | appendReferrer(currentUrl)) }}">Change</a>
```

Use the second form whenever the current page might itself have been reached with a chain. It is the common case in multi-level flows.

### 2. Return after finishing

Continue and back links, and the action of the form that ends the flow.

```njk
{% set formAction = "./save" | urlWithReferrer(referrerChain) %}
```

The form carries the chain to the route, and the route consumes it:

```js
router.post('/participants/:participantId/save', (req, res) => {
  // ...save...
  res.redirect(getReturnUrl(`/participants/${participantId}`, req.query.referrerChain))
})
```

Back links pop the chain directly:

```njk
{{ backLink({
  href: "../" | getReturnUrl(referrerChain),
  text: "Back"
}) }}
```

Always give `getReturnUrl` a sensible fallback as its first argument. An empty string returns nothing when there is no chain.

### 3. Pre-building a chain

For an "add" button that should return through a review page rather than straight back:

```njk
{% set addReferrerChain = currentUrl | appendReferrer('./review') %}
<a href="{{ './add' | urlWithReferrer(addReferrerChain) }}">Add item</a>
```

## Scrolling back to a section

Both `urlWithReferrer` and `getReturnUrl` take an optional second argument, an element id to scroll to on return. The current page's value is available as `query.scrollTo`:

```njk
{% set formAction = "./save" | urlWithReferrer(referrerChain, query.scrollTo) %}
```

## Worked example

Starting at `/clinics/1/appointments/2/check-information`:

1. Check information links to `./confirm-information/medical-history` with `urlWithReferrer(currentUrl)`. The chain is now `/check-information`.
2. Medical history links to an edit page with `urlWithReferrer(referrerChain | appendReferrer(currentUrl))`. The chain is `/check-information,/confirm-information/medical-history`.
3. The edit page's save uses `getReturnUrl`. It pops the chain and goes to medical history with the chain `/check-information`.
4. Medical history's continue uses `getReturnUrl` again. It goes to check information with no chain left.

## Common mistakes

| Mistake | Instead |
|---|---|
| `urlWithReferrer` on a back or continue link | `getReturnUrl` - back links consume the chain, they do not add to it |
| `urlWithReferrer(currentUrl)` from inside a flow | `urlWithReferrer(referrerChain \| appendReferrer(currentUrl))` so the existing chain is kept |
| `'' \| getReturnUrl(referrerChain)` | Always pass a fallback: `'../parent' \| getReturnUrl(referrerChain)` |
| Building `?referrerChain=` or `?returnTo=` strings by hand | Use the filters; they encode the chain and handle existing query strings |
| Storing the return URL in session data | Keep it in the URL. It survives new tabs and reloads, and does not leak between flows |
