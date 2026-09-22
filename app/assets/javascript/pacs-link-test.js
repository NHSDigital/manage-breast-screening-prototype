// app/assets/javascript/pacs-link-test.js
// Enhances the PACS link test page: fires the server-rendered URLs using the
// chosen link style and timing, and keeps an on-page log of what happened,
// including this page's own focus and visibility changes so a tester can see
// after the fact whether focus moved to the viewer.

const DELAY = 5000
const POPUP_FEATURES = 'popup,width=1200,height=900,left=100,top=100'

class PacsLinkTest {
  constructor(linksList) {
    this.linksList = linksList
    this.linkStyle = linksList.dataset.linkStyle
    this.timing = linksList.dataset.timing
    this.participants = Array.from(linksList.querySelectorAll('[data-url]')).map((item) => ({
      label: item.dataset.label,
      url: item.dataset.url
    }))

    this.log = document.getElementById('pacs-event-log')
    this.countdown = document.querySelector('[data-pacs-countdown]')
    this.controls = document.querySelector('[data-pacs-controls]')
    this.timers = []
    this.popup = null

    this.init()
  }

  init() {
    this.controls.removeAttribute('hidden')
    document.querySelector('[data-pacs-log-controls]').removeAttribute('hidden')

    document.querySelector('[data-pacs-launch]').addEventListener('click', () => this.launch())
    document.querySelector('[data-pacs-cancel]').addEventListener('click', () => this.cancelTimers())
    document.querySelector('[data-pacs-close-popup]').addEventListener('click', () => this.closePopup())
    document.querySelector('[data-pacs-clear-log]').addEventListener('click', () => {
      this.log.replaceChildren()
    })

    // Plain links still work as links, but log the click so the sequence is recorded
    this.linksList.querySelectorAll('[data-pacs-link]').forEach((link) => {
      link.addEventListener('click', () => {
        this.record(`Link clicked (${this.linkStyle}): ${link.href}`)
      })
    })

    window.addEventListener('focus', () => this.record('Page gained focus'))
    window.addEventListener('blur', () => this.record('Page lost focus'))
    document.addEventListener('visibilitychange', () => {
      this.record(`Page is now ${document.visibilityState}`)
    })

    this.record(`Ready. ${this.participants.length} participant(s), style “${this.linkStyle}”, timing “${this.timing}”`)
  }

  launch() {
    if (this.participants.length === 0)
    {
      this.record('Nothing to launch: no participants filled in')
      return
    }

    this.cancelTimers()

    if (this.timing === 'After 5 seconds')
    {
      this.schedule(this.participants[0], DELAY)
    }
    else if (this.timing === 'Cycle')
    {
      this.participants.forEach((participant, position) => {
        this.schedule(participant, DELAY * (position + 1))
      })
    }
    else
    {
      this.open(this.participants[0])
    }
  }

  schedule(participant, delay) {
    this.record(`Scheduled ${participant.label} in ${delay / 1000}s`)
    const timer = setTimeout(() => {
      this.timers = this.timers.filter((queued) => queued.timer !== timer)
      this.open(participant)
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

  open(participant) {
    const { label, url } = participant

    switch (this.linkStyle)
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
      // no-cors so a cross-origin PACS does not reject the request outright;
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
