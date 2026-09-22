// app/assets/javascript/pacs-link-test.js
// Enhances the PACS link test page: each participant has one button per way
// of opening its server-rendered URL, a timing choice applies to whichever
// button is clicked next, and an on-page log records what happened,
// including this page's own focus and visibility changes so a tester can see
// after the fact whether focus moved to the viewer.

const DELAY = 5000
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
    this.timers = []
    this.popup = null

    this.init()
  }

  init() {
    document.querySelectorAll('[data-pacs-timing], [data-pacs-controls], [data-pacs-log-controls], [data-pacs-open][hidden]').forEach((element) => {
      element.removeAttribute('hidden')
    })

    document.querySelector('[data-pacs-cancel]').addEventListener('click', () => this.cancelTimers())
    document.querySelector('[data-pacs-close-popup]').addEventListener('click', () => this.closePopup())
    document.querySelector('[data-pacs-clear-log]').addEventListener('click', () => {
      this.log.replaceChildren()
    })

    // Every open button, links included, goes through launch() so timing applies
    this.linksList.querySelectorAll('[data-pacs-open]').forEach((button) => {
      button.addEventListener('click', (event) => {
        event.preventDefault()
        const item = button.closest('[data-url]')
        this.launch({ label: item.dataset.label, url: item.dataset.url }, button.dataset.pacsOpen)
      })
    })

    window.addEventListener('focus', () => this.record('Page gained focus'))
    window.addEventListener('blur', () => this.record('Page lost focus'))
    document.addEventListener('visibilitychange', () => {
      this.record(`Page is now ${document.visibilityState}`)
    })

    this.record(`Ready with ${this.participants.length} participant(s)`)
  }

  get timing() {
    const checked = document.querySelector('input[name="timing"]:checked')
    return checked ? checked.value : 'Immediately'
  }

  launch(participant, style) {
    this.cancelTimers()

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
    const timer = setTimeout(() => {
      this.timers = this.timers.filter((queued) => queued.timer !== timer)
      this.open(participant, style)
      this.updateCountdown()
    }, delay)
    this.timers.push({ timer, participant, due: Date.now() + delay })
    this.updateCountdown()
  }

  cancelTimers() {
    if (this.timers.length === 0)
    {
      return
    }
    this.timers.forEach(({ timer }) => clearTimeout(timer))
    this.timers = []
    this.record('Timers cancelled')
    this.updateCountdown()
  }

  updateCountdown() {
    if (this.timers.length === 0)
    {
      this.countdown.setAttribute('hidden', '')
      this.countdown.textContent = ''
      return
    }
    const next = this.timers[0]
    const seconds = Math.max(0, Math.ceil((next.due - Date.now()) / 1000))
    this.countdown.removeAttribute('hidden')
    this.countdown.textContent = `Next: ${next.participant.label} in ${seconds}s (${this.timers.length} queued)`
    setTimeout(() => this.updateCountdown(), 500)
  }

  open(participant, style) {
    const { label, url } = participant

    switch (style)
    {
      case 'New tab':
        this.record(`Opening ${label} in a new tab`)
        window.open(url, '_blank', 'noopener')
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
        this.record(`Navigating this tab to ${label}`)
        window.location.assign(url)
    }
  }

  openPopup({ label, url }) {
    // Reusing the window name means a second launch retargets the same popup
    // rather than opening another, which is closer to how a reading page would behave
    this.popup = window.open(url, 'pacs-viewer', POPUP_FEATURES)

    if (!this.popup)
    {
      this.record(`Popup for ${label} was blocked by the browser`)
      return
    }

    this.record(`Popup opened for ${label}`)

    const watchForClose = setInterval(() => {
      if (this.popup && this.popup.closed)
      {
        clearInterval(watchForClose)
        this.record('Popup was closed')
        this.popup = null
      }
    }, 500)
  }

  closePopup() {
    if (this.popup && !this.popup.closed)
    {
      this.popup.close()
      return
    }
    this.record('No popup open')
  }

  async fetch({ label, url }) {
    this.record(`Fetching ${label}`)
    const started = performance.now()

    try
    {
      // no-cors so a cross-origin viewer does not reject the request outright;
      // the response is opaque, so only success or failure is known
      const response = await window.fetch(url, {
        mode: 'no-cors',
        credentials: 'include',
        cache: 'no-store'
      })
      const elapsed = Math.round(performance.now() - started)
      this.record(`Fetch for ${label} returned (type ${response.type}, status ${response.status || 'opaque'}) after ${elapsed}ms`)
    }
    catch (error)
    {
      const elapsed = Math.round(performance.now() - started)
      this.record(`Fetch for ${label} failed after ${elapsed}ms: ${error.message}`)
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
    iframe.addEventListener('load', () => this.record(`Hidden iframe for ${label} finished loading`))
    iframe.addEventListener('error', () => this.record(`Hidden iframe for ${label} failed to load`))
    iframe.src = url
    document.body.appendChild(iframe)
    this.record(`Hidden iframe requested ${label}`)
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
