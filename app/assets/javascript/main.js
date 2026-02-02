// app/assets/javascript/main.js

// ES6 or Vanilla JavaScript

document.addEventListener('DOMContentLoaded', () => {
  // Inline check in without requiring page reload
  const checkInLinks = document.querySelectorAll('.js-check-in-link')

  checkInLinks.forEach((link) => {
    link.addEventListener('click', async (e) => {
      e.preventDefault()
      const link = e.currentTarget
      const clinicId = link.dataset.clinicId
      const eventId = link.dataset.eventId
      const statusTagId = link.dataset.statusTagId

      try {
        const response = await fetch(
          `/clinics/${clinicId}/check-in/${eventId}`,
          {
            method: 'GET',
            headers: {
              Accept: 'application/json'
            }
          }
        )

        if (!response.ok) {
          throw new Error('Failed to check in participant')
        }

        // Update the status tag if we have an ID
        if (statusTagId) {
          const statusTag = document.getElementById(statusTagId)
          if (statusTag) {
            // Update the existing tag's text and classes
            statusTag.textContent = 'Checked in'
            statusTag.className = 'nhsuk-tag app-nowrap'
          }
        }

        // Show the start appointment link by removing the hidden class
        const eventRow = document.getElementById(`event-row-${eventId}`)
        if (eventRow) {
          const startAppointmentLink = eventRow.querySelector(
            '.js-start-appointment-link'
          )
          if (startAppointmentLink) {
            startAppointmentLink.classList.remove('app-display-none')
          }

          // Set focus on the row for accessibility
          eventRow.setAttribute('tabindex', '-1')
          eventRow.focus()
        }

        // Remove the check-in link
        // Check if this is a modal button or a direct link
        const isModalButton = link.closest('.app-modal')

        if (isModalButton) {
          // For modal buttons, find the original check-in link on the main page
          // Look for a link that opens the modal for this specific event
          const modalId = `check-in-modal-${eventId}`
          const originalCheckInLink = document.querySelector(
            `a[onclick*="openModal('${modalId}')"]`
          )

          if (originalCheckInLink) {
            const checkInParagraph = originalCheckInLink.closest('p')
            if (checkInParagraph) {
              checkInParagraph.remove()
            }
          }
        } else {
          // For direct links, remove the paragraph containing the link
          const checkInParagraph = link.closest('p')
          if (checkInParagraph) {
            checkInParagraph.remove()
          }
        }

        // Close any open modal (for modal-based check-ins)
        const openModal = document.querySelector('.app-modal:not([hidden])')
        if (openModal && window.closeModal) {
          window.closeModal(openModal.id)
        }
      } catch (error) {
        console.error('Error checking in participant:', error)
        window.location.href = link.href
      }
    })
  })

  // Handle reset data in background
  const $resetLink = document.querySelector('a[data-reset-session]')
  if ($resetLink) {
    $resetLink.addEventListener('click', async (e) => {
      e.preventDefault()
      sessionStorage.clear()

      try {
        const response = await fetch('/prototype-admin/reset-session-data', {
          method: 'GET',
          redirect: 'error'
        })

        if (!response.ok) {
          throw new Error('Failed to clear data')
        }

        // Refresh the page to reflect the cleared data
        window.location.reload()
      } catch (error) {
        console.error('Error clearing data:', error)

        // Fall back to reset confirmation page
        window.location.href = $resetLink.href
      }
    })
  }

  // Reading workflow: delay initial opinion controls to prevent premature clicks

  // When first arriving on a case, users should be prevented from giving an opinion for a period of time. On NBSS this is 30 seconds, but for the prototype is set to 5 seconds to avoid being annoying whilst testing.
  const opinionForm = document.querySelector('[data-reading-opinion-form]')
  if (opinionForm) {
    const eventId = opinionForm.dataset.eventId
    if (eventId) {
      try {
        if (opinionForm.dataset.readingOpinionLocked !== 'true') {
          opinionForm.classList.remove('app-reading-opinion--locked')
          opinionForm.dataset.readingOpinionLocked = 'false'
          return
        }

        // Key by date + batch + event so resets and new batches re-lock
        const batchId = opinionForm.dataset.batchId || 'no-batch'
        const todayKey = new Date().toISOString().slice(0, 10)
        const unlockKey = `readingOpinionUnlocked:${todayKey}:${batchId}:${eventId}`
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
      } catch (error) {
        console.error('Error applying opinion delay:', error)
      }
    }
  }

  // Reading workflow: auto-dismiss temporary opinion banner
  const opinionBanner = document.querySelector('[data-reading-opinion-banner]')
  if (opinionBanner) {
    const delayValue = Number(opinionBanner.dataset.autoCloseDelay)
    if (!Number.isNaN(delayValue) && delayValue > 0) {
      const fadeDurationMs = 200
      setTimeout(() => {
        opinionBanner.classList.add('app-reading-opinion-banner--fade-out')
        setTimeout(() => {
          opinionBanner.remove()
        }, fadeDurationMs)
      }, delayValue)
    }
  }
})
