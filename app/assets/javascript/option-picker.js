// app/assets/javascript/option-picker.js

// Option picker conditional reveal
// Shows/hides conditional content panels when an option is checked/unchecked.
// Follows the same accessibility pattern as NHS Frontend checkboxes:
// - Promotes data-aria-controls to aria-controls
// - Sets aria-expanded on the input
// - Hides panels with --hidden class (no-JS fallback: panels always visible)

class OptionPicker {
  constructor(element) {
    this.element = element
    this.$inputs = element.querySelectorAll('.app-option-picker__input')

    this.$inputs.forEach(($input) => {
      const targetId =
        $input.dataset.ariaControls || $input.getAttribute('aria-controls')

      // Skip inputs without conditional targets
      if (!targetId) return

      const $target = document.getElementById(targetId)
      if (!$target) return

      // Promote data-aria-controls to aria-controls for accessibility
      if (!$input.hasAttribute('aria-controls')) {
        $input.setAttribute('aria-controls', targetId)
        delete $input.dataset.ariaControls
      }
    })

    // Sync state on pageshow (handles browser back/forward)
    window.addEventListener('pageshow', () => this.syncAll())

    // Sync initial state
    this.syncAll()

    // Listen for changes
    this.element.addEventListener('change', (event) => this.handleChange(event))
  }

  syncAll() {
    this.$inputs.forEach(($input) => this.syncConditionalReveal($input))
  }

  syncConditionalReveal($input) {
    const targetId = $input.getAttribute('aria-controls')
    if (!targetId) return

    const $target = document.getElementById(targetId)
    if (!$target) return

    // Set aria-expanded on the input
    $input.setAttribute('aria-expanded', $input.checked.toString())

    // Toggle visibility class
    $target.classList.toggle(
      'app-option-picker__conditional--hidden',
      !$input.checked
    )
  }

  handleChange(event) {
    const $input = event.target
    if (
      !($input instanceof HTMLInputElement) ||
      !$input.classList.contains('app-option-picker__input')
    ) {
      return
    }

    // For radios, we need to sync all inputs (unchecking others hides their panels)
    if ($input.type === 'radio') {
      this.syncAll()
    } else {
      // For checkboxes, just sync the one that changed
      this.syncConditionalReveal($input)
    }
  }
}

const initOptionPickers = (scope) => {
  scope
    .querySelectorAll('[data-module="app-option-picker"]')
    .forEach((element) => {
      new OptionPicker(element)
    })
}

document.addEventListener('DOMContentLoaded', () => initOptionPickers(document))

// Re-initialise when modal.js injects new content
document.addEventListener('app:init', (e) => initOptionPickers(e.detail.scope))

window.OptionPicker = OptionPicker
