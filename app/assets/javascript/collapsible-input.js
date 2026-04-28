// app/assets/javascript/collapsible-input.js

// Collapsible input component
// Hides a form input or textarea behind a toggle link until the user activates it.
// Progressively enhanced: without JS the input renders as normal.

class CollapsibleInput {
  constructor(element) {
    this.element = element
    this.content = element.querySelector('.app-collapsible-input__content')
    this.input =
      this.content && this.content.querySelector('input, textarea, select')
    this.triggerText = element.dataset.triggerText || 'Add a comment'

    // Don't collapse if there's already a value — show the input as-is
    if (!this.input || this.input.value.trim()) return

    this.init()
  }

  init() {
    // Hide the content area
    this.content.hidden = true

    // Create the toggle trigger button, styled as a link
    this.trigger = document.createElement('button')
    this.trigger.type = 'button'
    this.trigger.className = 'app-collapsible-input__trigger'
    this.trigger.textContent = this.triggerText

    this.element.insertBefore(this.trigger, this.content)

    this.trigger.addEventListener('click', () => this.expand())
  }

  expand() {
    this.trigger.hidden = true
    this.content.hidden = false

    // Focus the input to help keyboard and screen reader users continue without extra steps
    if (this.input) {
      this.input.focus()
    }
  }
}

const initCollapsibleInputs = (scope) => {
  scope
    .querySelectorAll('[data-module="app-collapsible-input"]')
    .forEach((element) => {
      new CollapsibleInput(element)
    })
}

document.addEventListener('DOMContentLoaded', () =>
  initCollapsibleInputs(document)
)

// Re-initialise when modal.js injects new content
document.addEventListener('app:init', (e) =>
  initCollapsibleInputs(e.detail.scope)
)

window.CollapsibleInput = CollapsibleInput
