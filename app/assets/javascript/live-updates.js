// app/assets/javascript/live-updates.js
//
// Live updates when data is shared between browsers (see
// app/lib/shared-data.js). Only loaded when this browser is sharing.
//
// Listens to the server's stream of change notices. Each notice lists the ids
// it is about - the changed record's own id and the ids it links to - and the
// record's fields that changed. Then:
//
// - a region marked data-live-region whose data-live-ids include one of them
//   is re-rendered in place, from a fresh copy of the current page. A region
//   can also list the fields it shows in data-live-fields, as
//   "collection.field" (eg "appointments.status"), and is then only refreshed
//   when one of those changed
// - if the page itself shows one of those records (the ids on the banner
//   template, from the layout), and no refreshed region shows everything that
//   changed, a banner says the page has changed, with a link to refresh.
//   Never an automatic reload, so form input is safe.
// - either way, screen reader users hear what changed. A region can give its
//   own message in data-live-announcement, read from the refreshed copy so it
//   describes the new state. Otherwise the message is generic.
//
// A reset of the shared data affects everything, so it refreshes every region
// and shows the banner unless a region showing every field covers it.
//
// Without JavaScript nothing here runs, and pages show current data on reload.

import { Idiomorph } from 'idiomorph'

// Saving one thing can change several records, so notices arriving close
// together are handled as one
const debounceDelay = 300

const bannerTemplate = document.querySelector('[data-live-updates-banner]')

const getIds = (element) =>
  (element?.dataset.liveIds || '').split(' ').filter(Boolean)

// Null when the region shows every field
const getFields = (element) =>
  element.dataset.liveFields
    ? element.dataset.liveFields.split(' ').filter(Boolean)
    : null

const pageIds = getIds(bannerTemplate)

const statusElement = document.querySelector('[data-live-updates-status]')
const defaultAnnouncement = 'This page has been updated'
const bannerAnnouncement =
  'This page has been updated. Refresh the page to see the changes.'

const announce = (messages) => {
  if (!statusElement || !messages.length) return
  // Cleared first so the same message is announced again
  statusElement.textContent = ''
  window.setTimeout(() => {
    statusElement.textContent = [...new Set(messages)].join('. ')
  }, 100)
}

let pendingRegions = new Set()
let pendingBanner = false
let timer = null

// True if it added the banner
const showBanner = () => {
  if (!bannerTemplate || document.querySelector('[data-live-updates-shown]')) {
    return false
  }
  const main = document.querySelector('#maincontent')
  if (!main) return false
  main.prepend(bannerTemplate.content.cloneNode(true))
  announce([bannerAnnouncement])
  return true
}

const refreshRegions = async (regions, options = {}) => {
  try {
    const response = await window.fetch(window.location.href, {
      headers: { Accept: 'text/html' }
    })
    if (!response.ok) throw new Error(`Request failed: ${response.status}`)

    const html = await response.text()
    const freshDocument = new DOMParser().parseFromString(html, 'text/html')
    const announcements = []

    for (const region of regions) {
      const freshRegion = region.id
        ? freshDocument.getElementById(region.id)
        : null
      if (!freshRegion) throw new Error('Region missing from the response')

      const announcement = freshRegion.dataset.liveAnnouncement
      if (announcement) announcements.push(announcement)

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

    if (options.announce) {
      announce(announcements.length ? announcements : [defaultAnnouncement])
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

  // A new banner's announcement covers any regions refreshed with it
  const isBannerAdded = banner && showBanner()
  if (regions.length) refreshRegions(regions, { announce: !isBannerAdded })
}

const handleNotice = (notice) => {
  const isReset = notice.type === 'reset'
  const ids = notice.ids || []
  const matches = (candidateIds) =>
    isReset || candidateIds.some((id) => ids.includes(id))

  // Null when the server couldn't tell what changed, so treat it as anything
  const changedFields =
    !isReset && notice.fields
      ? notice.fields.map((field) => `${notice.collection}.${field}`)
      : null

  const regions = [...document.querySelectorAll('[data-live-region]')].filter(
    (region) => {
      if (!matches(getIds(region))) return false
      const fields = getFields(region)
      return (
        !fields ||
        !changedFields ||
        changedFields.some((field) => fields.includes(field))
      )
    }
  )

  const shownFields = regions.flatMap((region) => getFields(region) || [])
  const isCovered =
    regions.some((region) => !getFields(region)) ||
    (changedFields !== null &&
      changedFields.every((field) => shownFields.includes(field)))

  regions.forEach((region) => pendingRegions.add(region))
  if (!isCovered && matches(pageIds)) pendingBanner = true

  if (!pendingRegions.size && !pendingBanner) return

  window.clearTimeout(timer)
  timer = window.setTimeout(flush, debounceDelay)
}

// The server sends a heartbeat every 25 seconds. Hearing nothing for longer
// than this means the connection is stuck - in development the kit's proxy
// leaves a request it can't pass on hanging forever, which uses up one of the
// few connections a browser allows to one address - so it is replaced.
const silenceLimit = 40 * 1000
const watchdogInterval = 5 * 1000

let source = null
let lastHeard = 0

const hearFromServer = () => {
  lastHeard = Date.now()
}

const connect = () => {
  source = new window.EventSource('/shared-data/events')
  hearFromServer()
  source.addEventListener('open', hearFromServer)
  source.addEventListener('heartbeat', hearFromServer)
  source.addEventListener('message', (event) => {
    hearFromServer()
    try {
      handleNotice(JSON.parse(event.data))
    } catch (error) {
      console.error('Live updates: could not handle notice', error)
    }
  })
}

const disconnect = () => {
  source?.close()
  source = null
}

if (window.EventSource) {
  connect()

  window.setInterval(() => {
    // Closed by the server (it stopped sharing) or by leaving the page
    if (!source || source.readyState === window.EventSource.CLOSED) return
    if (Date.now() - lastHeard > silenceLimit) {
      disconnect()
      connect()
    }
  }, watchdogInterval)

  // Free the connection while the page is in the back-forward cache
  window.addEventListener('pagehide', disconnect)
  window.addEventListener('pageshow', (event) => {
    if (event.persisted) connect()
  })
}
