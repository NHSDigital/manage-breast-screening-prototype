// app/assets/javascript/live-filters.js

// Live filtering for index pages, as progressive enhancement.
// A form marked `data-live-filters="<region selector>"` stops being a plain
// GET submission: ticking a checkbox, typing in the search box, choosing an
// order or following a filter link fetches the same URL and morphs the named
// region in place, so the panel counts, selected filters, view tabs and
// results all update together without a page load.
//
// Several forms can drive the same region - the filter panel and the sort
// control - and one instance covers them all, since the listeners are
// delegated to the region rather than the forms.
//
// Without JavaScript nothing here runs and the form submits normally.

import { Idiomorph } from 'idiomorph'

const searchDebounceDelay = 400

class LiveFilters {
  constructor(form) {
    const selector =
      form.dataset.liveFilters || form.dataset.liveFiltersRegion || ''

    this.region = selector ? document.querySelector(selector) : null

    // The region has to contain the form: it is the region that survives each
    // morph, so it is what the delegated listeners are attached to
    if (!this.region || !this.region.contains(form)) return

    this.regionSelector = selector
    this.actionPath = new URL(form.action, window.location.href).pathname
    this.latestRequest = 0
    this.searchTimer = null

    this.$status = createStatusRegion()

    this.region.addEventListener('change', (event) => this.handleChange(event))
    this.region.addEventListener('input', (event) => this.handleInput(event))
    this.region.addEventListener('submit', (event) => this.handleSubmit(event))
    this.region.addEventListener('click', (event) => this.handleClick(event))

    window.addEventListener('popstate', () => {
      // Going back restores a previous URL, so the server's values are the
      // truth - the search box has to take them even if it holds older text
      this.update(window.location.href, {
        push: false,
        ignoreActiveValue: false
      })
    })

    this.active = true

    this.enhance()
  }

  // The morph replaces the panel with server HTML, so anything the script adds
  // to it has to be reapplied every time
  enhance() {
    this.region
      .querySelectorAll('[data-live-filters]')
      .forEach((form) => form.classList.add('app-live-filters'))
  }

  // The form's current state as a URL: empty values are dropped so the address
  // bar matches what a plain GET submission would produce
  buildFormUrl(form) {
    const params = new URLSearchParams()

    for (const [name, value] of new FormData(form)) {
      if (typeof value === 'string' && value.trim() !== '') {
        params.append(name, value)
      }
    }

    const query = params.toString()
    return query ? `${form.action}?${query}` : form.action
  }

  handleChange(event) {
    const input = event.target
    const isTickable =
      input instanceof HTMLInputElement &&
      (input.type === 'checkbox' || input.type === 'radio')

    // A select fires change on selection - waiting for blur would strand a
    // keyboard user part-way down the list
    if (!isTickable && !(input instanceof HTMLSelectElement)) return

    const form = input.closest('[data-live-filters]')
    if (!form) return

    this.updateFromForm(form)
  }

  handleInput(event) {
    const input = event.target
    if (!(input instanceof HTMLInputElement)) return
    if (input.type !== 'search' && input.type !== 'text') return

    const form = input.closest('[data-live-filters]')
    if (!form) return

    window.clearTimeout(this.searchTimer)
    this.searchTimer = window.setTimeout(() => {
      this.updateFromForm(form)
    }, searchDebounceDelay)
  }

  // Covers pressing Enter in the search box, and the search button
  handleSubmit(event) {
    const form = event.target
    if (
      !(form instanceof HTMLFormElement) ||
      !form.matches('[data-live-filters]')
    ) {
      return
    }

    event.preventDefault()
    this.updateFromForm(form)
  }

  // Filter links inside the region - clear filters, the selected-filter pills,
  // the view tabs - point at the same path as the form, so they can update in
  // place too. Links to anywhere else (a case, a participant) navigate.
  handleClick(event) {
    if (event.defaultPrevented) return
    if (event.button !== 0) return
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    if (!(event.target instanceof Element)) return

    const link = event.target.closest('a')
    if (!link || !this.region.contains(link)) return
    if (link.target && link.target !== '_self') return
    if (!link.href || link.getAttribute('href') === '#') return

    const url = new URL(link.href, window.location.href)
    if (url.origin !== window.location.origin) return
    if (url.pathname !== this.actionPath) return

    event.preventDefault()
    window.clearTimeout(this.searchTimer)

    this.update(url.href, {
      fallback: () => window.location.assign(url.href)
    })
  }

  updateFromForm(form) {
    window.clearTimeout(this.searchTimer)

    this.update(this.buildFormUrl(form), {
      fallback: () => form.submit()
    })
  }

  /**
   * Fetch a URL and morph the region to whatever it renders.
   *
   * @param {string} url - the URL to render
   * @param {object} [options]
   * @param {boolean} [options.push] - add the URL to history (not on popstate)
   * @param {boolean} [options.ignoreActiveValue] - keep what is being typed
   * @param {Function} [options.fallback] - what to do if the fetch fails
   */
  async update(url, { push = true, ignoreActiveValue = true, fallback } = {}) {
    this.latestRequest += 1
    const request = this.latestRequest

    try {
      const response = await window.fetch(url, {
        headers: { Accept: 'text/html' }
      })

      if (!response.ok) throw new Error(`Request failed: ${response.status}`)

      const html = await response.text()

      // A slower earlier request must not overwrite a later one
      if (request !== this.latestRequest) return

      const responseDocument = new DOMParser().parseFromString(
        html,
        'text/html'
      )
      const newRegion = responseDocument.querySelector(this.regionSelector)

      if (!newRegion) throw new Error('No matching region in the response')

      // innerHTML keeps the region element itself, which is what the delegated
      // listeners are on - so the new content is the region's children, not
      // the region element (passing the element would nest it inside itself).
      // Idiomorph restores focus by default; ignoring the active value stops
      // the server's echo of the search text overwriting what has been typed
      // since - which is wrong on popstate, hence the option.
      Idiomorph.morph(this.region, newRegion.children, {
        morphStyle: 'innerHTML',
        ignoreActiveValue
      })

      this.enhance()
      this.announce()

      if (push) window.history.pushState({}, '', response.url || url)
    } catch {
      if (fallback) fallback()
    }
  }

  // The active view tab carries the result summary, counts included
  announce() {
    const current = this.region.querySelector(
      '.app-secondary-navigation__link[aria-current]'
    )

    this.$status.textContent = current
      ? current.textContent.trim().replace(/\s+/g, ' ')
      : ''
  }
}

// One shared announcement region, kept outside the morphed region so morphing
// never replaces it mid-announcement
const createStatusRegion = () => {
  let $status = document.querySelector('[data-live-filters-status]')

  if (!$status) {
    $status = document.createElement('div')
    $status.setAttribute('data-live-filters-status', '')
    $status.setAttribute('role', 'status')
    $status.className = 'nhsuk-u-visually-hidden'
    document.body.appendChild($status)
  }

  return $status
}

document.addEventListener('DOMContentLoaded', () => {
  // One instance per region, not per form - a second instance on the same
  // region would duplicate its delegated listeners and fetch twice
  const claimedRegions = new Set()

  document.querySelectorAll('[data-live-filters]').forEach((form) => {
    const region = document.querySelector(form.dataset.liveFilters || '')
    if (region && claimedRegions.has(region)) return

    // Only a working instance claims the region - one that bailed leaves the
    // next form on the same region free to try
    if (new LiveFilters(form).active && region) claimedRegions.add(region)
  })
})

export { LiveFilters }
