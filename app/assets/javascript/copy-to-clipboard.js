// app/assets/javascript/copy-to-clipboard.js
// Progressive-enhancement component: the button is rendered with [hidden]
// and only made visible once JS has initialised it and confirmed the
// clipboard API is available.

const RESET_DELAY = 5000

class CopyToClipboard {
  constructor(element) {
    this.element = element
    this.resetTimeout = null
    this.defaultLabel = element.getAttribute('aria-label')

    // Visually hidden live region so screen readers hear the result.
    // Swapping the button's aria-label alone is not announced.
    this.status = document.createElement('span')
    this.status.setAttribute('aria-live', 'polite')
    this.status.classList.add('nhsuk-u-visually-hidden')

    this.init()
  }

  init() {
    this.element.insertAdjacentElement('afterend', this.status)
    this.element.removeAttribute('hidden')

    this.element.addEventListener('click', () => {
      this.copy()
    })
  }

  copy() {
    // Get text from data attribute, stripping all whitespace
    const rawText = this.element.dataset.copyText || ''
    const text = rawText.replace(/\s+/g, '')

    navigator.clipboard
      .writeText(text)
      .then(() => this.copied())
      .catch(() => this.reset())
  }

  copied() {
    this.element.classList.add('app-copy-to-clipboard--copied')
    this.setLabel('Copied')
    this.status.textContent = this.element.dataset.copiedAnnouncement || 'Copied to clipboard'

    this.reset(RESET_DELAY)
  }

  // Only buttons that started with an aria-label get it swapped. The value
  // variant names itself from its visible content, so it is left alone.
  setLabel(label) {
    if (this.defaultLabel) {
      this.element.setAttribute('aria-label', label)
    }
  }

  reset(delay = 0) {
    // Cancel any in-progress reset so rapid clicks don't cause flicker
    if (this.resetTimeout) {
      clearTimeout(this.resetTimeout)
    }

    this.resetTimeout = setTimeout(() => {
      this.element.classList.remove('app-copy-to-clipboard--copied')
      this.setLabel(this.defaultLabel)
      this.status.textContent = ''
      this.resetTimeout = null
    }, delay)
  }
}

// Initialise all copy-to-clipboard buttons when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  if (!('clipboard' in navigator)) {
    return
  }

  const buttons = document.querySelectorAll(
    '[data-module="app-copy-to-clipboard"]'
  )

  buttons.forEach((element) => {
    new CopyToClipboard(element)
  })
})
