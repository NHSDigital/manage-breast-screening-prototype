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
    this.inlineItems = []

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

      // Set up inline conditional enhancement
      if ('conditionalInline' in $input.dataset) {
        this.setupInline($input, $target)
      }
    })

    // Sync state on pageshow (handles browser back/forward)
    window.addEventListener('pageshow', () => this.syncAll())

    // Sync initial state
    this.syncAll()

    // Listen for changes
    this.element.addEventListener('change', (event) => this.handleChange(event))
  }

  // Set up inline conditional: move the input from the panel into the label
  setupInline($input, $panel) {
    const $label = this.element.querySelector(`label[for="${$input.id}"]`)
    if (!$label) return

    // Find the first input/textarea/select in the conditional panel
    const $inlineInput = $panel.querySelector('input, textarea, select')
    if (!$inlineInput) return

    // Strip width utility classes that don't make sense inline
    $inlineInput.classList.remove(
      'nhsuk-u-width-two-thirds',
      'nhsuk-u-width-one-half',
      'nhsuk-u-width-one-third',
      'nhsuk-u-width-full',
      'nhsuk-input--width-20',
      'nhsuk-input--width-10'
    )

    // Store original label text
    const textNode = Array.from($label.childNodes).find(
      (node) => node.nodeType === Node.TEXT_NODE && node.textContent.trim()
    )
    const originalText = textNode ? textNode.textContent.trim() : ''

    // Create inline wrapper
    const $wrapper = document.createElement('span')
    $wrapper.className = 'app-option-picker__inline-input'

    // Check if input already has error state
    if ($inlineInput.classList.contains('nhsuk-input--error')) {
      $wrapper.classList.add('app-option-picker__inline-input--error')
    }

    // Move the input into the wrapper
    $wrapper.appendChild($inlineInput)

    // Add error icon (hidden by default, shown via CSS when --error class present)
    const $errorIcon = document.createElement('span')
    $errorIcon.className = 'app-option-picker__inline-error-icon'
    $errorIcon.setAttribute('aria-hidden', 'true')
    $errorIcon.innerHTML =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" focusable="false">' +
      '<path d="M12 2a10 10 0 1 1 0 20 10 10 0 0 1 0-20Zm0 14a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3Zm-1.5-9.5V13a1.5 1.5 0 0 0 3 0V6.5a1.5 1.5 0 0 0-3 0Z">' +
      '</svg>'
    $wrapper.appendChild($errorIcon)

    // Append wrapper inside the label
    $label.appendChild($wrapper)

    // Prevent clicking/mousedown on the inline input from toggling the checkbox
    // or causing the button press visual (:active state on the label)
    $inlineInput.addEventListener('mousedown', (e) => {
      e.stopPropagation()
    })
    $inlineInput.addEventListener('click', (e) => {
      e.stopPropagation()
    })

    // Dynamic width: expand input as user types, up to a max
    this.resizeInput($inlineInput)
    $inlineInput.addEventListener('input', () => {
      this.resizeInput($inlineInput)
    })

    // Hide the below-panel permanently (inline replaces it)
    $panel.classList.add('app-option-picker__conditional--hidden')
    $panel.setAttribute('aria-hidden', 'true')

    // Track this inline item for sync
    this.inlineItems.push({
      $input,
      $label,
      $wrapper,
      $panel,
      $inlineInput,
      textNode,
      originalText
    })

    // Apply initial state
    this.syncInline(this.inlineItems[this.inlineItems.length - 1])
  }

  syncAll() {
    this.$inputs.forEach(($input) => this.syncConditionalReveal($input))
    this.inlineItems.forEach((item) => this.syncInline(item))
  }

  syncInline({ $input, $label, $wrapper, $panel, $inlineInput, textNode, originalText }, { focusInput = false } = {}) {
    const isChecked = $input.checked

    // Show/hide the inline input
    $wrapper.hidden = !isChecked
    $inlineInput.tabIndex = isChecked ? 0 : -1

    // Toggle label text: "Other" vs "Other:"
    if (textNode) {
      textNode.textContent = isChecked ? originalText + ': ' : originalText
    }

    // Toggle active class on the label
    $label.classList.toggle(
      'app-option-picker__label--inline-active',
      isChecked
    )

    // Keep below-panel hidden (inline mode owns the input)
    $panel.classList.add('app-option-picker__conditional--hidden')

    // Focus the inline input when revealed by user action
    if (isChecked && focusInput) {
      $inlineInput.focus()
    }
  }

  // Dynamically resize inline input based on content, with min/max bounds
  resizeInput($input) {
    const hasError = $input.classList.contains('nhsuk-input--error')
    const minWidth = hasError ? 120 : 80
    const maxWidth = 220

    // Use a canvas to measure text width — more reliable than DOM measurement
    const ctx = document.createElement('canvas').getContext('2d')
    ctx.font = window.getComputedStyle($input).font
    const textWidth = ctx.measureText($input.value || '').width

    // Account for padding + border (box-sizing: border-box)
    // Normal: 8px left pad + 8px right pad + 2px left border + 2px right border = 20px
    // Error: 8px left pad + 32px right pad + 2px left border + 2px right border = 44px
    const chrome = hasError ? 44 : 20
    const totalWidth = Math.ceil(textWidth) + chrome + 4
    const width = Math.min(Math.max(totalWidth, minWidth), maxWidth)
    $input.style.width = width + 'px'
  }

  syncConditionalReveal($input) {
    const targetId = $input.getAttribute('aria-controls')
    if (!targetId) return

    // Skip inline items — they're managed by syncInline
    if ('conditionalInline' in $input.dataset) return

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

      // Check if this is an inline item
      const inlineItem = this.inlineItems.find((item) => item.$input === $input)
      if (inlineItem) {
        this.syncInline(inlineItem, { focusInput: true })
      }
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
