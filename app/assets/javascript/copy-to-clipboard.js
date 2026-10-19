// app/assets/javascript/copy-to-clipboard.js
// Progressive-enhancement component: the button is rendered with [hidden]
// and only made visible once JS has initialised it and confirmed the
// clipboard API is available.

const RESET_DELAY = 5000
const copyButtonInstances = new WeakMap()

class CopyToClipboard {
  constructor(element) {
    this.element = element
    this.resetTimeout = null
    this.defaultLabel = element.getAttribute('aria-label')
    this.listenerAdded = false

    // Visually hidden live region so screen readers hear the result.
    // Swapping the button's aria-label alone is not announced.
    this.status = document.createElement('span')
    this.status.setAttribute('aria-live', 'polite')
    this.status.classList.add('nhsuk-u-visually-hidden')

    this.init()
  }

  init() {
    if (this.status.previousElementSibling !== this.element) {
      this.element.insertAdjacentElement('afterend', this.status)
    }
    const fallback = this.element.previousElementSibling
    if (fallback?.classList.contains('app-copy-to-clipboard__value-fallback')) {
      fallback.hidden = true
    }
    this.element.removeAttribute('hidden')

    if (!this.listenerAdded) {
      this.element.addEventListener('click', () => {
        this.copy()
      })
      this.listenerAdded = true
    }
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
    this.status.textContent =
      this.element.dataset.copiedAnnouncement || 'Copied to clipboard'

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

const initialiseCopyButtons = (container) => {
  if (!('clipboard' in navigator)) {
    return
  }

  const buttons = container.querySelectorAll(
    '[data-module="app-copy-to-clipboard"]'
  )

  buttons.forEach((element) => {
    const instance = copyButtonInstances.get(element)
    if (instance) {
      instance.init()
    } else {
      copyButtonInstances.set(element, new CopyToClipboard(element))
    }
  })
}

document.addEventListener('fragment:swapped', (event) => {
  initialiseCopyButtons(event.detail.fragment)
})

// Initialise all copy-to-clipboard buttons when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  initialiseCopyButtons(document)
})
