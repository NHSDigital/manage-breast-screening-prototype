// app/assets/javascript/keyboard-shortcuts.js
// Keyboard shortcut handling for reading workflow

const CHANNEL_NAME = 'mammogram-viewer'

/**
 * Play an alert sound when shortcut is blocked (e.g., during lockout)
 */
const playAlertSound = () => {
  // Create a short beep using Web Audio API
  try {
    const audioContext = new (
      window.AudioContext || window.webkitAudioContext
    )()
    const oscillator = audioContext.createOscillator()
    const gainNode = audioContext.createGain()

    oscillator.connect(gainNode)
    gainNode.connect(audioContext.destination)

    oscillator.frequency.value = 440 // A4 note
    oscillator.type = 'sine'
    gainNode.gain.value = 0.3

    oscillator.start()
    oscillator.stop(audioContext.currentTime + 0.15) // Short beep
  } catch (e) {
    // Audio not supported, fail silently
  }
}

/**
 * Check if the active element is a form field where shortcuts should be disabled
 */
const isInFormField = (element) => {
  if (!element) return false
  const tagName = element.tagName.toLowerCase()
  return (
    tagName === 'input' ||
    tagName === 'textarea' ||
    tagName === 'select' ||
    element.isContentEditable
  )
}

/**
 * Check if the opinion form is locked (during initial delay)
 */
const isOpinionLocked = () => {
  const form = document.querySelector('[data-reading-opinion-locked]')
  return form && form.getAttribute('data-reading-opinion-locked') === 'true'
}

/**
 * Find and trigger an element with a matching data-shortcut attribute (buttons)
 * or data-shortcut-radio attribute (radio inputs)
 * @param {string} key - The shortcut key (lowercase)
 * @returns {boolean} - True if a shortcut was triggered
 */
const triggerShortcut = (key) => {
  // Check if opinion is locked - play alert sound if so
  if (isOpinionLocked()) {
    console.log('[Shortcut] Blocked - opinion is locked')
    playAlertSound()
    return false
  }

  // First, try button/submit elements with data-shortcut
  const button = document.querySelector(`[data-shortcut="${key}"]`)
  if (button && !button.disabled) {
    console.log('[Shortcut] Triggering:', key)
    button.click()
    return true
  }

  // Then, try radio inputs with data-shortcut-radio (attribute is on the input)
  const radio = document.querySelector(`input[data-shortcut-radio="${key}"]`)
  if (radio && !radio.disabled) {
    console.log('[Shortcut] Triggering:', key)
    radio.checked = true
    radio.dispatchEvent(new Event('change', { bubbles: true }))

    // Submit the form
    const form = radio.closest('form')
    if (form) {
      form.submit()
    }
    return true
  }

  return false
}

/**
 * Initialise keyboard shortcut handling on the reading page
 */
const initReadingShortcuts = () => {
  // Get the broadcast channel for cross-window communication
  let channel = null
  if (typeof BroadcastChannel !== 'undefined') {
    channel = new BroadcastChannel(CHANNEL_NAME)
  }

  // Handle local keyboard events
  document.addEventListener('keydown', (e) => {
    // Ignore if in a form field
    if (isInFormField(e.target)) return

    // Ignore if modifier keys are pressed (except shift for future use)
    if (e.ctrlKey || e.altKey || e.metaKey) return

    const key = e.key.toLowerCase()
    triggerShortcut(key)
  })

  // Listen for shortcut messages from PACS viewer
  if (channel) {
    channel.addEventListener('message', (event) => {
      if (event.data.type === 'shortcut') {
        triggerShortcut(event.data.key)
      }
    })
  }
}

/**
 * Initialise keyboard shortcut forwarding from the PACS viewer
 * Call this from the mammogram viewer page
 */
const initViewerShortcutForwarding = () => {
  let channel = null
  if (typeof BroadcastChannel !== 'undefined') {
    channel = new BroadcastChannel(CHANNEL_NAME)
  }

  if (!channel) return

  // Define which keys to forward to the reading page
  const forwardKeys = ['n', 't', 'r']

  document.addEventListener('keydown', (e) => {
    // Ignore if modifier keys are pressed
    if (e.ctrlKey || e.altKey || e.metaKey) return

    const key = e.key.toLowerCase()

    // Forward reading shortcuts to the reading page
    if (forwardKeys.includes(key)) {
      channel.postMessage({
        type: 'shortcut',
        key: key,
        timestamp: Date.now()
      })
    }
  })
}

// Auto-initialise on reading pages (pages with shortcut elements)
document.addEventListener('DOMContentLoaded', () => {
  // Check if this page has any shortcut elements (buttons or radios)
  const hasShortcuts = document.querySelector(
    '[data-shortcut], [data-shortcut-radio]'
  )
  if (hasShortcuts) {
    initReadingShortcuts()
  }
})

// Expose for manual initialisation (e.g., from PACS viewer)
window.KeyboardShortcuts = {
  initReadingShortcuts,
  initViewerShortcutForwarding,
  triggerShortcut
}
