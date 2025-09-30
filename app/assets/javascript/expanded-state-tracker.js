// app/assets/javascript/expanded-state-tracker.js

// Generic expanded state tracker
// Tracks open/closed state of elements with .js-track-expanded class
// Also tracks section statuses for elements with .js-expandable-section class

;(function () {
  'use strict'

  const STORAGE_KEY_PREFIX = 'expanded-sections-'
  const PENDING_EXPAND_KEY_PREFIX = 'pending-expand-'
  const STATUS_KEY_PREFIX = 'section-statuses-'

  function getStorageKey() {
    return STORAGE_KEY_PREFIX + window.location.pathname
  }

  function getPendingExpandKey() {
    return PENDING_EXPAND_KEY_PREFIX + window.location.pathname
  }

  function getStatusStorageKey() {
    return STATUS_KEY_PREFIX + window.location.pathname
  }

  function saveExpandedState() {
    const trackableElements = document.querySelectorAll('.js-track-expanded')
    const expandedSections = []

    trackableElements.forEach((element) => {
      if (element.hasAttribute('open')) {
        expandedSections.push(element.id)
      }
    })

    sessionStorage.setItem(getStorageKey(), JSON.stringify(expandedSections))
  }

  function saveStatusState(sectionId, statusText) {
    const storedStatuses = sessionStorage.getItem(getStatusStorageKey())
    let statuses = {}

    if (storedStatuses) {
      try {
        statuses = JSON.parse(storedStatuses)
      } catch (e) {
        console.warn('Failed to parse stored statuses:', e)
      }
    }

    statuses[sectionId] = statusText
    sessionStorage.setItem(getStatusStorageKey(), JSON.stringify(statuses))
  }

  function restoreStatusState() {
    const storedStatuses = sessionStorage.getItem(getStatusStorageKey())
    if (storedStatuses) {
      try {
        const statuses = JSON.parse(storedStatuses)
        Object.keys(statuses).forEach((sectionId) => {
          const section = document.getElementById(sectionId)
          if (section && section.classList.contains('js-expandable-section')) {
            const statusText = statuses[sectionId]
            updateSectionStatusDisplay(section, statusText)
          }
        })
      } catch (e) {
        console.warn('Failed to restore status state:', e)
      }
    }
  }

  function updateSectionStatusDisplay(section, statusText) {
    const sectionId = section.getAttribute('id')
    let statusElement = null

    // Use the same strategies to find the status element
    const parent = section.parentElement
    if (parent) {
      statusElement = parent.querySelector('.app-details__status .nhsuk-tag')
    }

    if (!statusElement && sectionId) {
      statusElement =
        document.querySelector(`[data-section="${sectionId}"] .nhsuk-tag`) ||
        document.querySelector(`#${sectionId}-status .nhsuk-tag`)
    }

    if (!statusElement) {
      let currentElement = section.previousElementSibling
      while (currentElement && !statusElement) {
        statusElement = currentElement.querySelector(
          '.app-details__status .nhsuk-tag'
        )

        if (!statusElement) {
          currentElement = currentElement.previousElementSibling
        }
      }
    }

    if (!statusElement) {
      let currentElement = section.nextElementSibling
      while (currentElement && !statusElement) {
        statusElement = currentElement.querySelector(
          '.app-details__status .nhsuk-tag'
        )

        if (!statusElement) {
          currentElement = currentElement.nextElementSibling
        }
      }
    }

    if (!statusElement) {
      const container =
        section.closest('.nhsuk-grid-column-two-thirds') ||
        section.closest('.nhsuk-grid-row') ||
        document.body

      const allStatusElements = container.querySelectorAll(
        '.app-details__status .nhsuk-tag'
      )

      const allSections = container.querySelectorAll('.js-expandable-section')
      const sectionIndex = Array.from(allSections).indexOf(section)

      if (allStatusElements[sectionIndex]) {
        statusElement = allStatusElements[sectionIndex]
      }
    }

    if (statusElement) {
      statusElement.textContent = statusText

      // Update the tag colour class based on status
      statusElement.classList.remove(
        'nhsuk-tag--blue',
        'nhsuk-tag--green',
        'nhsuk-tag--yellow'
      )

      if (statusText === 'Complete' || statusText === 'Reviewed') {
        statusElement.classList.add('nhsuk-tag--green')
      } else if (statusText === 'Incomplete') {
        statusElement.classList.add('nhsuk-tag--blue')
      } else if (statusText === 'To review') {
        statusElement.classList.add('nhsuk-tag--yellow')
      }
    }
  }

  function restoreExpandedState() {
    const storedState = sessionStorage.getItem(getStorageKey())
    if (storedState) {
      try {
        const expandedSections = JSON.parse(storedState)
        expandedSections.forEach((sectionId) => {
          const element = document.getElementById(sectionId)
          if (element && element.classList.contains('js-track-expanded')) {
            element.setAttribute('open', 'open')
          }
        })
      } catch (e) {
        console.warn('Failed to restore expanded state:', e)
      }
    }

    // Also check for pending expand sections
    const pendingExpandState = sessionStorage.getItem(getPendingExpandKey())
    if (pendingExpandState) {
      try {
        const sectionsToExpand = JSON.parse(pendingExpandState)
        sectionsToExpand.forEach((sectionId) => {
          const element = document.getElementById(sectionId)
          if (element && element.classList.contains('js-track-expanded')) {
            element.setAttribute('open', 'open')
          }
        })
        // Clear pending expand state after using it
        sessionStorage.removeItem(getPendingExpandKey())
      } catch (e) {
        console.warn('Failed to restore pending expand state:', e)
      }
    }

    // Restore section statuses
    restoreStatusState()
  }

  function clearExpandedStateIfNeeded() {
    const path = window.location.pathname

    // Clear if on main event page (not sub-pages)
    if (path.match(/^\/clinics\/[^\/]+\/events\/[^\/]+\/?$/)) {
      clearAllExpandedStates()
    }
  }

  function clearAllExpandedStates() {
    Object.keys(sessionStorage).forEach((key) => {
      if (
        key.startsWith(STORAGE_KEY_PREFIX) ||
        key.startsWith(PENDING_EXPAND_KEY_PREFIX) ||
        key.startsWith(STATUS_KEY_PREFIX)
      ) {
        sessionStorage.removeItem(key)
      }
    })
  }

  function setupEventListeners() {
    const trackableElements = document.querySelectorAll('.js-track-expanded')

    trackableElements.forEach((element) => {
      element.addEventListener('toggle', saveExpandedState)
    })

    // Handle links that should expand their parent section
    const expandParentLinks = document.querySelectorAll(
      '.js-expand-parent-section'
    )
    expandParentLinks.forEach((link) => {
      link.addEventListener('click', function () {
        // Find the parent section (closest .js-track-expanded element)
        const parentSection = this.closest('.js-track-expanded')
        if (parentSection && parentSection.id) {
          // Store this section ID as pending expand for the return URL
          const returnUrl = this.getAttribute('href')
          if (returnUrl) {
            // We need to figure out what the return URL will be
            // For now, assume it returns to the current page
            const currentPath = window.location.pathname
            const pendingExpandSections = [parentSection.id]
            sessionStorage.setItem(
              PENDING_EXPAND_KEY_PREFIX + currentPath,
              JSON.stringify(pendingExpandSections)
            )
            console.log(
              'Marked section for expansion on return:',
              parentSection.id
            )
          }
        }
      })
    })
  }

  // Initialize on page load
  document.addEventListener('DOMContentLoaded', function () {
    clearExpandedStateIfNeeded()
    restoreExpandedState()
    setupEventListeners()
  })

  // Expose functions globally
  window.clearAllExpandedStates = clearAllExpandedStates
  window.saveSectionStatus = saveStatusState
})()
