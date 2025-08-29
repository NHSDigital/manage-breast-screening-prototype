// app/assets/javascript/expanded-state-tracker.js

// Generic expanded state tracker
// Tracks open/closed state of elements with .js-track-expanded class

;(function () {
  'use strict'

  const STORAGE_KEY_PREFIX = 'expanded-sections-'
  const PENDING_EXPAND_KEY_PREFIX = 'pending-expand-'

  function getStorageKey() {
    return STORAGE_KEY_PREFIX + window.location.pathname
  }

  function getPendingExpandKey() {
    return PENDING_EXPAND_KEY_PREFIX + window.location.pathname
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
  }

  function clearExpandedStateIfNeeded() {
    const path = window.location.pathname

    // Clear if on main event page (not sub-pages)
    if (path.match(/^\/clinics\/[^/]+\/events\/[^/]+\/?$/)) {
      clearAllExpandedStates()
    }
  }

  function clearAllExpandedStates() {
    Object.keys(sessionStorage).forEach((key) => {
      if (
        key.startsWith(STORAGE_KEY_PREFIX) ||
        key.startsWith(PENDING_EXPAND_KEY_PREFIX)
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

  // Expose clear function globally for clear data link
  window.clearAllExpandedStates = clearAllExpandedStates
})()
