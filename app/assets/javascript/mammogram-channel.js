// app/assets/javascript/mammogram-channel.js
// BroadcastChannel-based communication for mammogram viewer

const CHANNEL_NAME = 'mammogram-viewer'

/**
 * Get or create the broadcast channel
 * Lazily created to avoid errors if BroadcastChannel not supported
 */
let channel = null
const getChannel = () => {
  if (!channel && typeof BroadcastChannel !== 'undefined') {
    channel = new BroadcastChannel(CHANNEL_NAME)
  }
  return channel
}

/**
 * Broadcast a message to show mammograms for a participant
 * @param {object} data - The data to broadcast
 * @param {string} data.eventId - The event ID (used for image selection)
 * @param {string} data.participantName - Display name for the participant
 * @param {string} data.nhsNumber - NHS number (optional)
 * @param {string} data.sxNumber - SX number (optional)
 * @param {string} data.dateOfBirth - Date of birth with age (optional)
 * @param {object} data.images - Image paths (rcc, lcc, rmlo, lmlo)
 */
const broadcastShowParticipant = (data) => {
  const ch = getChannel()
  if (!ch) return

  ch.postMessage({
    type: 'show',
    eventId: data.eventId,
    participantName: data.participantName,
    nhsNumber: data.nhsNumber || null,
    sxNumber: data.sxNumber || null,
    dateOfBirth: data.dateOfBirth || null,
    images: data.images || null,
    setId: data.setId || null,
    setDescription: data.setDescription || null,
    setTag: data.setTag || null,
    context: data.context || null,
    timestamp: Date.now()
  })
}

/**
 * Broadcast a message to clear/blank the viewer
 */
const broadcastClear = () => {
  const ch = getChannel()
  if (!ch) return

  ch.postMessage({
    type: 'clear',
    timestamp: Date.now()
  })
}

/**
 * Listen for mammogram viewer messages
 * Used by the viewer page to receive updates
 * @param {function} callback - Called with message data when received
 * @returns {function} - Cleanup function to remove listener
 */
const onMammogramMessage = (callback) => {
  const ch = getChannel()
  if (!ch) return () => {}

  const handler = (event) => {
    callback(event.data)
  }

  ch.addEventListener('message', handler)

  // Return cleanup function
  return () => {
    ch.removeEventListener('message', handler)
  }
}

/**
 * Request current participant data from any open parent pages
 * Used by viewer when it first opens
 */
const requestCurrent = () => {
  const ch = getChannel()
  if (!ch) return

  ch.postMessage({
    type: 'request-current',
    timestamp: Date.now()
  })
}

/**
 * Close the channel (cleanup)
 */
const closeChannel = () => {
  if (channel) {
    channel.close()
    channel = null
  }
}

/**
 * Open the mammogram viewer window
 * @returns {Window|null} - The opened window or null if blocked
 */
const openViewer = () => {
  return window.open(
    '/reading/mammogram-viewer',
    'mammogram-viewer',
    'width=800,height=900,resizable=yes'
  )
}

/**
 * Check if viewer is already open by sending a ping and waiting for pong
 * @returns {Promise<boolean>} - Resolves to true if viewer is open
 */
const isViewerOpen = () => {
  return new Promise((resolve) => {
    const ch = getChannel()
    if (!ch) {
      resolve(false)
      return
    }

    let resolved = false
    const handler = (event) => {
      if (event.data.type === 'pong' && !resolved) {
        resolved = true
        ch.removeEventListener('message', handler)
        resolve(true)
      }
    }

    ch.addEventListener('message', handler)
    ch.postMessage({ type: 'ping', timestamp: Date.now() })

    // If no pong within 100ms, viewer is not open
    setTimeout(() => {
      if (!resolved) {
        resolved = true
        ch.removeEventListener('message', handler)
        resolve(false)
      }
    }, 100)
  })
}

// Auto-broadcast on page load if we have participant data in meta tags
document.addEventListener('DOMContentLoaded', () => {
  const eventIdMeta = document.querySelector('meta[name="mammogram-event-id"]')
  const participantNameMeta = document.querySelector(
    'meta[name="mammogram-participant-name"]'
  )
  const autoOpenMeta = document.querySelector(
    'meta[name="mammogram-auto-open"]'
  )

  // Helper to get current participant data from meta tags
  const getCurrentParticipantData = () => {
    if (!eventIdMeta || !participantNameMeta) return null

    const eventId = eventIdMeta.getAttribute('content')
    const participantName = participantNameMeta.getAttribute('content')

    if (!eventId || !participantName) return null

    const nhsNumber = document
      .querySelector('meta[name="mammogram-nhs-number"]')
      ?.getAttribute('content')
    const sxNumber = document
      .querySelector('meta[name="mammogram-sx-number"]')
      ?.getAttribute('content')
    const dateOfBirth = document
      .querySelector('meta[name="mammogram-date-of-birth"]')
      ?.getAttribute('content')
    const images = {
      rcc: document
        .querySelector('meta[name="mammogram-image-rcc"]')
        ?.getAttribute('content'),
      lcc: document
        .querySelector('meta[name="mammogram-image-lcc"]')
        ?.getAttribute('content'),
      rmlo: document
        .querySelector('meta[name="mammogram-image-rmlo"]')
        ?.getAttribute('content'),
      lmlo: document
        .querySelector('meta[name="mammogram-image-lmlo"]')
        ?.getAttribute('content')
    }

    // Get set info for debugging
    const setId = document
      .querySelector('meta[name="mammogram-set-id"]')
      ?.getAttribute('content')
    const setDescription = document
      .querySelector('meta[name="mammogram-set-description"]')
      ?.getAttribute('content')
    const setTag = document
      .querySelector('meta[name="mammogram-set-tag"]')
      ?.getAttribute('content')

    // Get context info for debugging
    const contextRaw = document
      .querySelector('meta[name="mammogram-context"]')
      ?.getAttribute('content')
    let context = null
    try {
      context = contextRaw ? JSON.parse(contextRaw) : null
    } catch (e) {
      // Invalid JSON, ignore
    }

    return {
      eventId,
      participantName,
      nhsNumber,
      sxNumber,
      dateOfBirth,
      images,
      setId,
      setDescription,
      setTag,
      context
    }
  }

  // Listen for request-current messages from the viewer
  const ch = getChannel()
  if (ch) {
    ch.addEventListener('message', (event) => {
      if (event.data.type === 'request-current') {
        const data = getCurrentParticipantData()
        if (data) {
          broadcastShowParticipant(data)
        }
      }
    })
  }

  if (eventIdMeta && participantNameMeta) {
    const data = getCurrentParticipantData()

    // Auto-open viewer if enabled and viewer is not already open
    if (autoOpenMeta?.getAttribute('content') === 'true') {
      isViewerOpen().then((isOpen) => {
        if (!isOpen) {
          openViewer()
        }
      })
    }

    if (data) {
      broadcastShowParticipant(data)
    }
  } else {
    // No participant data - broadcast clear to show placeholder
    broadcastClear()
  }
})

// Expose for manual use and for the viewer
window.MammogramChannel = {
  broadcastShowParticipant,
  broadcastClear,
  onMammogramMessage,
  requestCurrent,
  closeChannel,
  openViewer,
  isViewerOpen
}
