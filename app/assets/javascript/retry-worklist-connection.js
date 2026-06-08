// app/assets/javascript/retry-worklist-connection.js
//
// Handles retry connection simulation entirely client-side.
// First click: shows "Attempting to reconnect" then shows a failure message.
// Second click: shows "Attempting to reconnect" then submits the form (server
// marks worklist as connected and redirects via referrerChain).

;(function () {
  const RECONNECT_DELAY_MS = 1500
  const button = document.querySelector('[data-retry-connection-button]')
  if (!button) return

  const form = button.form
  if (!form) return

  const failureMessage = document.querySelector('[data-retry-failure-message]')
  const retryTimeSpan = document.querySelector('[data-retry-time]')
  const originalText = button.textContent
  let attempts = 0

  // Reset button state on page load and bfcache restore
  const resetButton = () => {
    button.disabled = false
    button.textContent = originalText
  }
  resetButton()
  window.addEventListener('pageshow', resetButton)

  let isSubmitting = false

  form.addEventListener('submit', (event) => {
    // Only intercept the Retry button (not the secondary Switch to manual button)
    if (event.submitter !== button) return

    // After a successful retry we re-submit programmatically — let it through
    if (isSubmitting) return

    event.preventDefault()

    button.disabled = true
    button.textContent = 'Attempting to reconnect'

    setTimeout(() => {
      attempts++

      if (attempts >= 2) {
        // Second attempt: simulate success — submit form to server
        isSubmitting = true
        button.disabled = false
        if (typeof form.requestSubmit === 'function') {
          form.requestSubmit(button)
        } else {
          form.submit()
        }
        return
      }

      // First attempt: simulate failure — show message and re-enable button
      if (failureMessage && retryTimeSpan) {
        const now = new Date()
        const timeString = now.toLocaleTimeString('en-GB', {
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit'
        })
        retryTimeSpan.textContent = timeString
        failureMessage.style.display = ''
      }

      resetButton()
    }, RECONNECT_DELAY_MS)
  })
})()
