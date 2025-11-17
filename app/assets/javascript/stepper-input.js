// app/assets/javascript/stepper-input.js

// Initialize stepper input (number input with increase/decrease buttons)
document.addEventListener('DOMContentLoaded', () => {
  // Prevent text selection when rapidly clicking buttons
  // This stops the browser from selecting page text when users click the +/- buttons quickly
  // We still allow selection on the input itself so users can select/copy the value
  const wrappers = document.querySelectorAll('.app-stepper-input__wrapper')
  wrappers.forEach((wrapper) => {
    wrapper.addEventListener('selectstart', (e) => {
      // Only prevent selection if it's not the input field being selected
      if (e.target.tagName !== 'INPUT') {
        e.preventDefault()
      }
    })
  })

  // Update button disabled states based on current value
  const updateButtonStates = (input) => {
    const minAttr = input.getAttribute('min')
    const maxAttr = input.getAttribute('max')
    const min = minAttr !== null ? parseInt(minAttr, 10) : null
    const max = maxAttr !== null ? parseInt(maxAttr, 10) : null
    const value = parseInt(input.value, 10) || 0

    const inputId = input.getAttribute('id')
    const decreaseButton = document.querySelector(
      `.app-stepper-input__button--decrease[data-input-id="${inputId}"]`
    )
    const increaseButton = document.querySelector(
      `.app-stepper-input__button--increase[data-input-id="${inputId}"]`
    )

    if (decreaseButton) {
      decreaseButton.disabled = min !== null && value <= min
    }

    if (increaseButton) {
      increaseButton.disabled = max !== null && value >= max
    }
  }

  // Announce value changes to screen readers
  const announceValue = (inputId, value, atLimit = false) => {
    const statusElement = document.getElementById(`${inputId}-status`)
    if (statusElement) {
      let announcement

      // Handle negative numbers explicitly for screen readers
      if (typeof value === 'number' && value < 0) {
        announcement = `negative ${Math.abs(value)}`
      } else {
        announcement = String(value)
      }

      // Add limit reached message if at boundary
      if (atLimit) {
        announcement += ', limit reached'
      }

      statusElement.textContent = announcement
    }
  }

  const buttons = document.querySelectorAll('.app-stepper-input__button')

  buttons.forEach((button) => {
    // Prevent text selection on rapid clicks
    button.addEventListener('selectstart', (e) => {
      e.preventDefault()
    })

    button.addEventListener('click', () => {
      const inputId = button.getAttribute('data-input-id')
      const input = document.getElementById(inputId)

      if (!input) {
        return
      }

      const currentValue = parseInt(input.value, 10) || 0
      const minAttr = input.getAttribute('min')
      const maxAttr = input.getAttribute('max')
      const min = minAttr !== null ? parseInt(minAttr, 10) : null
      const max = maxAttr !== null ? parseInt(maxAttr, 10) : null
      const step = parseInt(input.getAttribute('step'), 10) || 1

      let newValue = currentValue

      if (button.classList.contains('app-stepper-input__button--increase')) {
        newValue = currentValue + step
        if (max !== null) {
          newValue = Math.min(newValue, max)
        }
      } else if (
        button.classList.contains('app-stepper-input__button--decrease')
      ) {
        newValue = currentValue - step
        if (min !== null) {
          newValue = Math.max(newValue, min)
        }
      }

      input.value = newValue

      // Update button states
      updateButtonStates(input)

      // Announce new value, and add "limit reached" if we've hit a boundary
      const reachedMax = max !== null && newValue === max
      const reachedMin = min !== null && newValue === min

      announceValue(inputId, newValue, reachedMax || reachedMin)

      // Trigger input and change events so other listeners can respond
      input.dispatchEvent(new Event('input', { bubbles: true }))
      input.dispatchEvent(new Event('change', { bubbles: true }))
    })
  })

  // Handle manual input to enforce min/max
  const inputs = document.querySelectorAll(
    '.app-stepper-input input[type="text"][inputmode="numeric"]'
  )

  inputs.forEach((input) => {
    input.addEventListener('blur', () => {
      const minAttr = input.getAttribute('min')
      const maxAttr = input.getAttribute('max')
      const min = minAttr !== null ? parseInt(minAttr, 10) : null
      const max = maxAttr !== null ? parseInt(maxAttr, 10) : null
      let value = parseInt(input.value, 10)

      if (isNaN(value)) {
        value = min !== null ? min : 0
      } else {
        if (min !== null && value < min) {
          value = min
        }
        if (max !== null && value > max) {
          value = max
        }
      }

      input.value = value

      // Update button states after manual input
      updateButtonStates(input)
    })

    // Also update on input event for immediate feedback
    input.addEventListener('input', () => {
      updateButtonStates(input)
    })
  })
})
