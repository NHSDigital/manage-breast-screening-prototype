// app/assets/javascript/lib/fragments.js
//
// Helpers for swapping a server-rendered fragment into the page in place. No
// side effects, so any entry point can import them - esbuild bundles a copy
// into each one. Kept outside the entry point glob in app.js so it isn't built
// on its own.

export const fetchOptions = { headers: { 'X-Requested-With': 'XMLHttpRequest' } }

// Swap target for the fragment contained in html, verifying the ids match
// so an unexpected response (eg a redirect to a full page) never gets
// injected into the table
export const swapFragment = (target, html) => {
  const template = document.createElement('template')
  template.innerHTML = html.trim()
  const replacement = template.content.querySelector('[data-fragment-id]')
  if (
    !replacement ||
    replacement.dataset.fragmentId !== target.dataset.fragmentId
  ) {
    throw new Error('Response was not the expected fragment')
  }
  target.replaceWith(replacement)
  replacement.dispatchEvent(
    new CustomEvent('fragment:swapped', {
      bubbles: true,
      detail: { fragment: replacement }
    })
  )
  return replacement
}

// Fetch a fragment URL and swap the response into target
export const refreshFragment = (target, url) =>
  fetch(url, fetchOptions)
    .then((response) => {
      if (!response.ok) throw new Error('Failed to fetch fragment')
      return response.text()
    })
    .then((html) => swapFragment(target, html))
