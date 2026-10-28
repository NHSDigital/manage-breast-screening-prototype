// app/assets/javascript/live-updates.js
//
// Live updates when data is shared between browsers (see
// app/lib/shared-data.js). Only loaded when this browser is sharing.
//
// Listens to the server's stream of change notices. Each notice lists the ids
// it is about - the changed record's own id and the ids it links to. Then:
//
// - a region marked data-live-region whose data-live-ids include one of them
//   is re-rendered in place, from a fresh copy of the current page
// - otherwise, if the page itself shows one of those records (the ids on the
//   banner template, from the layout), a banner says the page has changed,
//   with a link to refresh. Never an automatic reload, so form input is safe.
//
// A reset of the shared data affects everything, so it refreshes every region
// or shows the banner.
//
// Without JavaScript nothing here runs, and pages show current data on reload.

import { Idiomorph } from 'idiomorph'

// Saving one thing can change several records, so notices arriving close
// together are handled as one
const debounceDelay = 300

const bannerTemplate = document.querySelector('[data-live-updates-banner]')

const getIds = (element) =>
  (element?.dataset.liveIds || '').split(' ').filter(Boolean)

const pageIds = getIds(bannerTemplate)

let pendingRegions = new Set()
let pendingBanner = false
let timer = null

const showBanner = () => {
  if (!bannerTemplate || document.querySelector('[data-live-updates-shown]')) {
    return
  }
  const main = document.querySelector('#maincontent')
  if (!main) return
  main.prepend(bannerTemplate.content.cloneNode(true))
}

const refreshRegions = async (regions) => {
  try {
    const response = await window.fetch(window.location.href, {
      headers: { Accept: 'text/html' }
    })
    if (!response.ok) throw new Error(`Request failed: ${response.status}`)

    const html = await response.text()
    const freshDocument = new DOMParser().parseFromString(html, 'text/html')

    for (const region of regions) {
      const freshRegion = region.id
        ? freshDocument.getElementById(region.id)
        : null
      if (!freshRegion) throw new Error('Region missing from the response')

      // innerHTML keeps the region element and any listeners on it. Ignoring
      // the active value stops a refresh overwriting what is being typed.
      Idiomorph.morph(region, freshRegion.children, {
        morphStyle: 'innerHTML',
        ignoreActiveValue: true
      })

      region.dispatchEvent(
        new CustomEvent('fragment:swapped', {
          bubbles: true,
          detail: { fragment: region }
        })
      )
    }
  } catch {
    showBanner()
  }
}

const flush = () => {
  const regions = [...pendingRegions]
  const banner = pendingBanner
  pendingRegions = new Set()
  pendingBanner = false

  if (regions.length) refreshRegions(regions)
  else if (banner) showBanner()
}

const handleNotice = (notice) => {
  const isReset = notice.type === 'reset'
  const ids = notice.ids || []
  const matches = (candidateIds) =>
    isReset || candidateIds.some((id) => ids.includes(id))

  const regions = [...document.querySelectorAll('[data-live-region]')].filter(
    (region) => matches(getIds(region))
  )

  if (regions.length) {
    regions.forEach((region) => pendingRegions.add(region))
  } else if (matches(pageIds)) {
    pendingBanner = true
  } else {
    return
  }

  window.clearTimeout(timer)
  timer = window.setTimeout(flush, debounceDelay)
}

if (window.EventSource) {
  const source = new window.EventSource('/shared-data/events')
  source.addEventListener('message', (event) => {
    try {
      handleNotice(JSON.parse(event.data))
    } catch (error) {
      console.error('Live updates: could not handle notice', error)
    }
  })
}
