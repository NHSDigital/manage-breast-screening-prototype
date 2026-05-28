// app/assets/javascript/retry-worklist-connection.js
//
// Adds a brief "Attempting to reconnect" transient state to the Retry
// connection button so the user sees feedback before the page reloads.

(function () {
  const RECONNECT_DELAY_MS = 1500
  const button = document.querySelector('[data-retry-connection-button]')
  if (!button) return

  const form = button.form
  if (!form) return

  const originalText = button.textContent

  // Reset the button on initial load and when restored from bfcache, so it
  // doesn't get stuck in the "Attempting to reconnect" disabled state after
  // the post-redirect page load.
  const resetButton = function () {
    button.disabled = false
    button.textContent = originalText
  }
  resetButton()
  window.addEventListener('pageshow', resetButton)

  let isSubmitting = false

  form.addEventListener('submit', function (event) {
    // Only intercept when the user clicked the Retry button (not the
    // secondary "Switch to manual" button, which uses its own formaction).
    if (event.submitter !== button) return

    // After the simulated reconnect delay we re-submit programmatically;
    // let that submission through without re-intercepting it.
    if (isSubmitting) return

    event.preventDefault()

    button.disabled = true
    button.textContent = 'Attempting to reconnect'

    window.setTimeout(function () {
      isSubmitting = true
      // Re-enable so the value is submitted, then submit using the
      // button's formaction.
      button.disabled = false
      if (typeof form.requestSubmit === 'function') {
        form.requestSubmit(button)
      } else {
        form.submit()
      }
    }, RECONNECT_DELAY_MS)
  })
})()
