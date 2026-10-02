// app/assets/javascript/pacs-link-test.js
// Enhances the PACS link test page. Each participant has one button per way
// of opening its server-rendered URL, a timing choice applies to whichever
// button is clicked next, and an on-page log records what happened, including
// this page's own focus and visibility changes so a tester can see afterwards
// whether focus moved to the viewer.
//
// An immediate same-tab or new-tab click is left to the browser as a real link
// click, so what is tested is the link itself. Delayed launches have to go
// through window.open or location.assign, which browsers treat differently
// (no user activation, so new windows are usually blocked).

const DELAY = 5000
const COUNTDOWN_REFRESH = 500
const BODY_PREVIEW_LENGTH = 300
const POPUP_NAME = 'pacs-viewer'
const POPUP_FEATURES = 'popup,width=1200,height=900,left=100,top=100'

class PacsLinkTest {
  constructor(linksList) {
    this.linksList = linksList
    this.participants = Array.from(linksList.querySelectorAll('[data-url]')).map((item) => ({
      label: item.dataset.label,
      url: item.dataset.url
    }))

    this.log = document.getElementById('pacs-event-log')
    this.countdown = document.querySelector('[data-pacs-countdown]')
    this.queue = []
    this.countdownInterval = null
    this.popup = null
    this.popupWatcher = null

    this.init()
  }

  init() {
    document.querySelectorAll('[data-pacs-timing], [data-pacs-controls], [data-pacs-log-controls], [data-pacs-open][hidden]').forEach((element) => {
      element.removeAttribute('hidden')
    })

    document.querySelector('[data-pacs-cancel]').addEventListener('click', () => this.cancelQueue())
    document.querySelector('[data-pacs-close-popup]').addEventListener('click', () => this.closePopup())
    document.querySelector('[data-pacs-clear-log]').addEventListener('click', () => this.log.replaceChildren())

    this.linksList.querySelectorAll('[data-pacs-open]').forEach((button) => {
      button.addEventListener('click', (event) => this.handleOpenClick(event, button))
    })

    window.addEventListener('focus', () => this.record('Page gained focus'))
    window.addEventListener('blur', () => this.record('Page lost focus'))
    document.addEventListener('visibilitychange', () => this.record(`Page is now ${document.visibilityState}`))

    this.record(`Ready with ${this.participants.length} participant(s)`)
  }

  get timing() {
    const checked = document.querySelector('input[name="timing"]:checked')
    return checked ? checked.value : 'Immediately'
  }

  handleOpenClick(event, button) {
    const item = button.closest('[data-url]')
    const participant = { label: item.dataset.label, url: item.dataset.url }
    const style = button.dataset.pacsOpen
    const isLink = button.tagName === 'A'

    // Let the browser handle an immediate link click natively; just record it
    if (isLink && this.timing === 'Immediately')
    {
      this.record(`Link clicked for ${participant.label} (${style}, native link)`)
      return
    }

    event.preventDefault()
    this.launch(participant, style)
  }

  launch(participant, style) {
    this.cancelQueue()

    if (this.timing === 'After 5 seconds')
    {
      this.schedule(participant, style, DELAY)
    }
    else if (this.timing === 'Cycle')
    {
      this.participants.forEach((each, position) => {
        this.schedule(each, style, DELAY * (position + 1))
      })
    }
    else
    {
      this.open(participant, style)
    }
  }

  schedule(participant, style, delay) {
    this.record(`Scheduled ${participant.label} (${style}) in ${delay / 1000}s`)

    const queued = { participant, due: Date.now() + delay }
    queued.timer = setTimeout(() => {
      this.queue = this.queue.filter((other) => other !== queued)
      this.open(participant, style)
      this.updateCountdown()
    }, delay)

    this.queue.push(queued)
    this.startCountdown()
  }

  cancelQueue() {
    if (this.queue.length === 0)
    {
      return
    }
    this.queue.forEach(({ timer }) => clearTimeout(timer))
    this.queue = []
    this.record('Queued launches cancelled')
    this.updateCountdown()
  }

  startCountdown() {
    if (!this.countdownInterval)
    {
      this.countdownInterval = setInterval(() => this.updateCountdown(), COUNTDOWN_REFRESH)
    }
    this.updateCountdown()
  }

  updateCountdown() {
    if (this.queue.length === 0)
    {
      clearInterval(this.countdownInterval)
      this.countdownInterval = null
      this.countdown.setAttribute('hidden', '')
      this.countdown.textContent = ''
      return
    }

    const next = this.queue[0]
    const seconds = Math.max(0, Math.ceil((next.due - Date.now()) / 1000))
    this.countdown.removeAttribute('hidden')
    this.countdown.textContent = `Next: ${next.participant.label} in ${seconds}s (${this.queue.length} queued)`
  }

  open(participant, style) {
    switch (style)
    {
      case 'New tab':
        this.openNewTab(participant)
        break
      case 'Popup':
        this.openPopup(participant)
        break
      case 'Fetch':
        this.fetch(participant)
        break
      case 'Hidden iframe':
        this.loadInIframe(participant)
        break
      default:
        this.record(`Navigating this tab to ${participant.label} (location.assign)`)
        window.location.assign(participant.url)
    }
  }

  openNewTab({ label, url }) {
    // No noopener feature: with it window.open always returns null, which
    // would make a blocked tab indistinguishable from an opened one
    const opened = window.open(url, '_blank')
    if (opened === null)
    {
      this.record(`New tab for ${label} was blocked by the browser (window.open without user activation)`)
      return
    }
    this.record(`New tab opened for ${label} (window.open)`)
  }

  openPopup({ label, url }) {
    // A fixed window name means a second launch reuses the popup rather than
    // opening another, which is closer to how a reading page would behave
    this.popup = window.open(url, POPUP_NAME, POPUP_FEATURES)

    if (this.popup === null)
    {
      this.record(`Popup for ${label} was blocked by the browser`)
      return
    }

    this.record(`Popup opened for ${label}`)
    this.watchPopup()
  }

  watchPopup() {
    if (this.popupWatcher)
    {
      return
    }
    this.popupWatcher = setInterval(() => {
      if (!this.popup || this.popup.closed)
      {
        clearInterval(this.popupWatcher)
        this.popupWatcher = null
        this.popup = null
        this.record('Popup was closed')
      }
    }, COUNTDOWN_REFRESH)
  }

  closePopup() {
    if (this.popup && !this.popup.closed)
    {
      this.popup.close()
      return
    }
    this.record('No popup open')
  }

  // Tries a CORS request first so the response can be read when the viewer
  // allows our origin, and falls back to no-cors, which still sends the
  // request but returns an opaque response
  async fetch({ label, url }) {
    this.record(`Fetching ${label} (mode cors)`)
    const started = performance.now()

    try
    {
      const response = await window.fetch(url, {
        mode: 'cors',
        credentials: 'include',
        cache: 'no-store'
      })
      const body = await response.text()
      const contentType = response.headers.get('content-type') || 'no content-type'
      this.record(`Fetch for ${label} returned ${response.status} ${response.statusText} (${contentType}) after ${this.elapsed(started)}`)
      this.record(`Response body (first ${BODY_PREVIEW_LENGTH} chars): ${body.slice(0, BODY_PREVIEW_LENGTH)}`)
    }
    catch (error)
    {
      this.record(`CORS fetch for ${label} failed after ${this.elapsed(started)}: ${error.message}. Usually the viewer has not allowed this origin. Retrying with mode no-cors`)
      await this.fetchOpaque({ label, url })
    }
  }

  async fetchOpaque({ label, url }) {
    const started = performance.now()

    try
    {
      const response = await window.fetch(url, {
        mode: 'no-cors',
        credentials: 'include',
        cache: 'no-store'
      })
      this.record(`no-cors fetch for ${label} completed after ${this.elapsed(started)} (response type ${response.type}, status and body unreadable)`)
    }
    catch (error)
    {
      this.record(`no-cors fetch for ${label} failed after ${this.elapsed(started)}: ${error.message}`)
    }
  }

  loadInIframe({ label, url }) {
    const existing = document.getElementById('pacs-hidden-iframe')
    if (existing)
    {
      existing.remove()
    }

    const iframe = document.createElement('iframe')
    iframe.id = 'pacs-hidden-iframe'
    iframe.setAttribute('hidden', '')
    iframe.setAttribute('title', 'PACS activation')
    // The load event fires even when the browser shows its own error page,
    // so it only proves the request finished, not that it succeeded
    iframe.addEventListener('load', () => this.record(`Hidden iframe for ${label} fired its load event (fires for error pages too)`))
    iframe.src = url
    document.body.appendChild(iframe)
    this.record(`Hidden iframe requested ${label}`)
  }

  elapsed(started) {
    return `${Math.round(performance.now() - started)}ms`
  }

  record(message) {
    const item = document.createElement('li')
    const time = new Date().toLocaleTimeString('en-GB', {
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      fractionalSecondDigits: 3
    })
    item.textContent = `${time} ${message}`
    this.log.appendChild(item)
    console.log(`[PACS link test] ${message}`)
  }
}

document.addEventListener('DOMContentLoaded', () => {
  const linksList = document.getElementById('pacs-links')
  if (linksList)
  {
    new PacsLinkTest(linksList)
  }
})
