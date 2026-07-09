// app/assets/javascript/copy-to-clipboard.js
// Progressive-enhancement component: the button is rendered with [hidden]
// and only made visible once JS has initialised it.

class CopyToClipboard {
  constructor(element) {
    this.element = element
    this.resetTimeout = null

    this.init()
  }

  init() {
    // Reveal the button now that JS is available
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
      .then(() => {
        this.showCopiedFeedback()
      })
      .catch(() => {
        // Silently fail — clipboard API can be unavailable in some contexts
      })
  }

  showCopiedFeedback() {
    // Cancel any in-progress reset so rapid clicks don't cause flicker
    if (this.resetTimeout) {
      clearTimeout(this.resetTimeout)
    }

    this.element.classList.add('app-copy-to-clipboard--copied')
    this.element.setAttribute('aria-label', 'Copied')

    this.resetTimeout = setTimeout(() => {
      this.element.classList.remove('app-copy-to-clipboard--copied')

      // Restore original aria-label from the data attribute if present,
      // otherwise fall back to the current aria-label without "Copied"
      const originalLabel = this.element.dataset.ariaLabel
      if (originalLabel) {
        this.element.setAttribute('aria-label', originalLabel)
      }

      this.resetTimeout = null
    }, 2000)
  }
}

// Initialise all copy-to-clipboard buttons when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  const buttons = document.querySelectorAll(
    '[data-module="app-copy-to-clipboard"]'
  )

  buttons.forEach((element) => {
    // Store original aria-label so we can restore it after the "Copied" feedback
    if (element.getAttribute('aria-label')) {
      element.dataset.ariaLabel = element.getAttribute('aria-label')
    }

    new CopyToClipboard(element)
  })
})
