// app/assets/javascript/main.js

// ES6 or Vanilla JavaScript

document.addEventListener('DOMContentLoaded', () => {

  // Inline check in without requiring page reload
  const checkInLinks = document.querySelectorAll('.js-check-in-link')

  checkInLinks.forEach(link => {
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
              'Accept': 'application/json'
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
          const startAppointmentLink = eventRow.querySelector('.js-start-appointment-link')
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
          const originalCheckInLink = document.querySelector(`a[onclick*="openModal('${modalId}')"]`)

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

  // Handle clear data link with AJAX
  const clearDataLinks = document.querySelectorAll('a[href="/clear-data"]')
  clearDataLinks.forEach(link => {
    link.addEventListener('click', async (e) => {
      e.preventDefault()
      try {
        const response = await fetch('/clear-data', {
          method: 'GET',
          headers: {
            'Accept': 'application/json'
          }
        })

        if (!response.ok) {
          throw new Error('Failed to clear data')
        }

        const result = await response.json()
        if (result.success) {
          // Refresh the page to reflect the cleared data
          window.location.reload()
        } else {
          throw new Error('Failed to clear data')
        }
      } catch (error) {
        console.error('Error clearing data:', error)
        window.location.href = link.href
      }
    })
  })
})