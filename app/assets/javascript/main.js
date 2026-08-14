// app/assets/javascript/main.js

// ES6 or Vanilla JavaScript

import { swapFragment } from './fragment-actions.js'

document.addEventListener('DOMContentLoaded', () => {
  // Inline check-in without a page reload. The server responds with the
  // re-rendered appointment row (see the check-in route), which replaces the
  // old one. Handled here rather than by fragment-actions.js directly because
  // the trigger can be a button inside the confirm-identity modal, which
  // lives inside the row being replaced.
  const checkInLinks = document.querySelectorAll('.js-check-in-link')

  checkInLinks.forEach((link) => {
    link.addEventListener('click', async (e) => {
      e.preventDefault()
      const { clinicId, appointmentId } = e.currentTarget.dataset
      const url = `/clinics/${clinicId}/check-in/${appointmentId}`

      try {
        const response = await fetch(url, {
          headers: { 'X-Requested-With': 'XMLHttpRequest' }
        })
        if (!response.ok) {
          throw new Error('Failed to check in participant')
        }
        const html = await response.text()

        // Close the confirm-identity modal before the swap - its markup
        // lives inside the row that's about to be replaced
        const openModal = document.querySelector('.app-modal:not([hidden])')
        if (openModal && window.closeModal) {
          window.closeModal(openModal.id)
        }

        const row = document.querySelector(`tr[data-fragment-id="${appointmentId}"]`)
        if (!row) throw new Error('Appointment row not found')
        const newRow = swapFragment(row, html)

        // Set focus on the row for accessibility
        newRow.setAttribute('tabindex', '-1')
        newRow.focus()
      } catch (error) {
        console.error('Error checking in participant:', error)
        window.location.href = url
      }
    })
  })

  // Handle reset data in background
  setupResetSessionLink()

  // Reading workflow: auto-dismiss the opinion banner after a delay
  const opinionBanner = document.querySelector('[data-reading-opinion-banner]')
  if (opinionBanner) {
    const delay = parseInt(opinionBanner.dataset.autoCloseDelay, 10) || 3000
    setTimeout(() => {
      opinionBanner.classList.add('app-reading-opinion-banner--fade-out')
      // Remove from DOM after the CSS transition (0.2s) completes
      opinionBanner.addEventListener('transitionend', () => {
        opinionBanner.remove()
      }, { once: true })
    }, delay)
  }

  // Reading workflow: delay initial opinion controls to prevent premature clicks
  // When first arriving on a case, users should be prevented from giving an opinion for a period of time. On NBSS this is 30 seconds, but for the prototype is set to 5 seconds to avoid being annoying whilst testing.
  const opinionForm = document.querySelector('[data-reading-opinion-form]')
  if (opinionForm) {
    const appointmentId = opinionForm.dataset.appointmentId
    if (appointmentId) {
      try {
        if (opinionForm.dataset.readingOpinionLocked !== 'true') {
          opinionForm.classList.remove('app-reading-opinion--locked')
          opinionForm.dataset.readingOpinionLocked = 'false'
        } else {
          // Key by date + session + appointment so resets and new sessions re-lock
          const sessionId = opinionForm.dataset.sessionId || 'no-session'
          const todayKey = new Date().toISOString().slice(0, 10)
          const unlockKey = `readingOpinionUnlocked:${todayKey}:${sessionId}:${appointmentId}`

          if (!sessionStorage.getItem(unlockKey)) {
            sessionStorage.setItem(unlockKey, 'true')
            opinionForm.classList.add('app-reading-opinion--locked')
            opinionForm.dataset.readingOpinionLocked = 'true'

            const controls = Array.from(
              opinionForm.querySelectorAll('button, input, select, textarea')
            )
            const interactiveControls = controls.filter((control) => {
              if (
                control.tagName.toLowerCase() === 'input' &&
                control.type === 'hidden'
              ) {
                return false
              }

              return true
            })
            const linkControls = Array.from(
              opinionForm.querySelectorAll('.app-button-link')
            ).filter((control) => control.tagName.toLowerCase() === 'a')

            interactiveControls.forEach((control) => {
              control.disabled = true
            })

            linkControls.forEach((control) => {
              control.setAttribute('aria-disabled', 'true')
              control.dataset.readingOpinionDisabled = 'true'
              control.addEventListener('click', (event) => {
                if (control.dataset.readingOpinionDisabled === 'true') {
                  event.preventDefault()
                }
              })
            })

            setTimeout(() => {
              interactiveControls.forEach((control) => {
                control.disabled = false
              })

              linkControls.forEach((control) => {
                control.removeAttribute('aria-disabled')
                control.dataset.readingOpinionDisabled = 'false'
              })

              opinionForm.classList.remove('app-reading-opinion--locked')
              opinionForm.dataset.readingOpinionLocked = 'false'
            }, 5000)
          } else {
            opinionForm.classList.remove('app-reading-opinion--locked')
            opinionForm.dataset.readingOpinionLocked = 'false'
          }
        }
      } catch (error) {
        console.error('Error applying opinion delay:', error)
      }
    }
  }
})

// Quick settings modal — press backtick (`) to open settings in a modal overlay.
// On close, the page reloads to pick up any changes.
document.addEventListener('keydown', (e) => {
  // Ignore when typing in a form field
  const tag = e.target.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || e.target.isContentEditable) return

  // Ignore if a modal is already open
  const existingModal = document.querySelector('.app-modal--open')
  if (existingModal) return

  if (e.key !== '`') return

  e.preventDefault()

  const modal = document.getElementById('app-form-modal')
  if (!modal || !modal.appModal) return

  // Temporarily wrap close() to reload the page after dismissing the settings modal
  const originalClose = modal.appModal.close.bind(modal.appModal)
  modal.appModal.close = function () {
    originalClose()
    modal.appModal.close = originalClose
    window.location.reload()
  }

  window.openModal('app-form-modal', { loadUrl: '/settings' })
})

function setupResetSessionLink() {
  if (window.resetSessionListenerAdded) {
    return
  }

  window.resetSessionListenerAdded = true

  document.addEventListener('click', async (e) => {
    const resetLink = e.target.closest('a[data-reset-session]')
    if (!resetLink) {
      return
    }

    e.preventDefault()

    try {
      const returnPage = `${window.location.pathname}${window.location.search}`
      const response = await fetch('/prototype-admin/reset-session-data', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: `returnPage=${encodeURIComponent(returnPage)}`,
        redirect: 'follow'
      })

      if (response.redirected) {
        window.location.href = response.url
        return
      }

      if (!response.ok) {
        throw new Error('Failed to clear data')
      }

      // Refresh the page to reflect the cleared data
      window.location.reload()
    } catch (error) {
      console.error('Error clearing data:', error)

      // Fall back to reset confirmation page
      window.location.href = resetLink.href
    }
  })
}
