// app/assets/javascript/custom-elements/is-sticky.js

// Copied from https://github.com/nhsuk/manage-vaccinations-in-schools-prototype/blob/main/app/assets/javascripts/custom-elements/is-sticky.js

const IsStickyComponent = class extends HTMLElement {
  constructor() {
    super()
    this.stickyElementStyle = null
    this.stickyElementTop = 0

    this.determineStickyState = this.determineStickyState.bind(this)
    this.throttledStickyState = this.throttle(this.determineStickyState, 100)
  }

  connectedCallback() {
    this.stickyElementStyle = window.getComputedStyle(this)
    this.stickyElementTop = parseInt(this.stickyElementStyle.top, 10)

    window.addEventListener('scroll', this.throttledStickyState)

    this.determineStickyState()
  }

  disconnectedCallback() {
    window.removeEventListener('scroll', this.throttledStickyState)
  }

  determineStickyState() {
    const currentTop = this.getBoundingClientRect().top
    this.dataset.stuck = String(currentTop <= this.stickyElementTop)
  }

  throttle(callback, limit) {
    let inThrottle
    return function () {
      const args = arguments
      const context = this
      if (!inThrottle) {
        callback.apply(context, args)
        inThrottle = true
        setTimeout(() => (inThrottle = false), limit)
      }
    }
  }
}

customElements.define('is-sticky', IsStickyComponent)
