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
      const appointmentId = link.dataset.appointmentId
      const statusTagId = link.dataset.statusTagId

      try {
        const response = await fetch(
          `/clinics/${clinicId}/check-in/${appointmentId}`,
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
        const appointmentRow = document.getElementById(`appointment-row-${appointmentId}`)
        if (appointmentRow) {
          const startAppointmentLink = appointmentRow.querySelector(
            '.js-start-appointment-link'
          )
          if (startAppointmentLink) {
            startAppointmentLink.classList.remove('app-display-none')
          }

          // Set focus on the row for accessibility
          appointmentRow.setAttribute('tabindex', '-1')
          appointmentRow.focus()
        }

        // Remove the check-in link
        // Check if this is a modal button or a direct link
        const isModalButton = link.closest('.app-modal')

        if (isModalButton) {
          // For modal buttons, find the original check-in link on the main page
          // Look for a link that opens the modal for this specific appointment
          const modalId = `check-in-modal-${appointmentId}`
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
  setupResetSessionLink()

  // Auto-save breast density factors when changed
  setupBreastDensityFactorsAutosave()

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

// The HRT answer is edited in place rather than on its own page, so there's no
// submit button to save it - each change posts on its own.
function setupBreastDensityFactorsAutosave() {
  const container = document.querySelector('[data-breast-density-factors-save-url]')
  if (!container) {
    return
  }

  const saveUrl = container.dataset.breastDensityFactorsSaveUrl
  if (!saveUrl) {
    return
  }

  const statusName = 'appointment[medicalInformation][hrt][status]'
  const yearStartedName = 'appointment[medicalInformation][hrt][yearStarted]'
  const yearStoppedName = 'appointment[medicalInformation][hrt][yearStopped]'

  const statusRadios = container.querySelectorAll(`input[name="${statusName}"]`)

  if (statusRadios.length === 0) {
    return
  }

  // Keep the expander's "n factors added" line in step with the inputs.
  // Only the review page wraps these in an expander, so this does nothing
  // elsewhere. Pregnancy and breastfeeding is edited on its own page, so its
  // count comes from the server - match getBreastDensityFactors so the two
  // never disagree
  const updateContentsSummary = () => {
    const summary = container
      .closest('.js-expandable-section')
      ?.querySelector('.app-details__contents-summary')

    if (!summary) {
      return
    }

    const factorCount = Number(container.dataset.breastDensityFactorCount) || 0
    const takingHrt = container.querySelector(`input[name="${statusName}"]:checked`)?.value === 'yes'
    const count = factorCount + (takingHrt ? 1 : 0)

    if (count === 0) {
      summary.textContent = 'No breast density factors added'
    } else if (count === 1) {
      summary.textContent = '1 breast density factor added'
    } else {
      summary.textContent = `${count} breast density factors added`
    }
  }

  // Changes can land faster than the requests complete, so keep them in a
  // queue - otherwise an earlier response could be the last one to arrive
  let pendingSave = Promise.resolve()

  const saveHrt = () => {
    const formData = new URLSearchParams()

    const selectedStatus = container.querySelector(`input[name="${statusName}"]:checked`)
    if (selectedStatus) {
      formData.append(statusName, selectedStatus.value)
    }

    ;[yearStartedName, yearStoppedName].forEach((name) => {
      const input = container.querySelector(`input[name="${name}"]`)
      if (input) {
        formData.append(name, input.value)
      }
    })

    updateContentsSummary()

    pendingSave = pendingSave
      .then(async () => {
        const response = await fetch(saveUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'X-Requested-With': 'XMLHttpRequest'
          },
          body: formData.toString()
        })

        if (!response.ok) {
          throw new Error(
            `Breast density factors auto-save failed (${response.status})`
          )
        }
      })
      .catch((error) => console.error(error))
  }

  container
    .querySelectorAll(
      `input[name="${statusName}"], input[name="${yearStartedName}"], input[name="${yearStoppedName}"]`
    )
    .forEach((input) => input.addEventListener('change', saveHrt))
}

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
