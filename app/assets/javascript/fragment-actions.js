// app/assets/javascript/fragment-actions.js
//
// Progressive enhancement for in-place status updates. Mark a link or form
// with data-fragment-action and wrap the markup it changes in an element
// with a unique data-fragment-id. The action is sent with fetch, and the
// server responds with a re-rendered copy of that element (built from the
// same Nunjucks macro the page used), which is swapped in place - so tags,
// labels and action links can't drift from the server's rendering. Routes
// detect these requests with req.xhr and render the fragment view instead
// of redirecting. Without JS, or on any failure, the link or form falls
// back to a normal navigation.
//
// A bubbling fragment:swapped event fires on each replacement element, for
// pages that need to react (eg revealing a 'refresh to update counts' hint).
//
// Scripts that swap fragments themselves import from lib/fragments.js, never
// from this file - esbuild bundles each entry point separately, so importing
// this file would register these listeners a second time.

import { fetchOptions, swapFragment } from './lib/fragments.js'

// GET actions: <a data-fragment-action href="...">
document.addEventListener('click', (event) => {
  const link = event.target.closest('a[data-fragment-action]')
  if (!link) return
  const target = link.closest('[data-fragment-id]')
  if (!target) return

  event.preventDefault()
  fetch(link.href, fetchOptions)
    .then((response) => {
      if (!response.ok) throw new Error('Request failed')
      return response.text()
    })
    .then((html) => swapFragment(target, html))
    .catch(() => {
      window.location.href = link.href
    })
})

// POST actions: <form data-fragment-action>
document.addEventListener('submit', (event) => {
  const form = event.target.closest('form[data-fragment-action]')
  if (!form) return
  const target = form.closest('[data-fragment-id]')
  if (!target) return

  event.preventDefault()
  fetch(form.action, {
    method: (form.method || 'POST').toUpperCase(),
    body: new URLSearchParams(new FormData(form)),
    headers: fetchOptions.headers
  })
    .then((response) => {
      if (!response.ok) throw new Error('Request failed')
      return response.text()
    })
    .then((html) => swapFragment(target, html))
    .catch(() => form.submit())
})
