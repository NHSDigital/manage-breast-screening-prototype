// app/assets/javascript/mammogram-channel.js
// BroadcastChannel-based communication for mammogram viewer

const CHANNEL_NAME = "mammogram-viewer"

/**
 * Get or create the broadcast channel
 * Lazily created to avoid errors if BroadcastChannel not supported
 */
let channel = null
const getChannel = () => {
  if (!channel && typeof BroadcastChannel !== "undefined") {
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
 * @param {object} data.images - Image paths (rcc, lcc, rmlo, lmlo)
 */
const broadcastShowParticipant = (data) => {
  const ch = getChannel()
  if (!ch) return

  ch.postMessage({
    type: "show",
    eventId: data.eventId,
    participantName: data.participantName,
    nhsNumber: data.nhsNumber || null,
    sxNumber: data.sxNumber || null,
    images: data.images || null,
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
    type: "clear",
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

  ch.addEventListener("message", handler)

  // Return cleanup function
  return () => {
    ch.removeEventListener("message", handler)
  }
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

// Auto-broadcast on page load if we have participant data in meta tags
document.addEventListener("DOMContentLoaded", () => {
  const eventIdMeta = document.querySelector('meta[name="mammogram-event-id"]')
  const participantNameMeta = document.querySelector('meta[name="mammogram-participant-name"]')

  if (eventIdMeta && participantNameMeta) {
    const eventId = eventIdMeta.getAttribute("content")
    const participantName = participantNameMeta.getAttribute("content")
    const nhsNumber = document.querySelector('meta[name="mammogram-nhs-number"]')?.getAttribute("content")
    const sxNumber = document.querySelector('meta[name="mammogram-sx-number"]')?.getAttribute("content")

    // Get image paths from meta tags
    const images = {
      rcc: document.querySelector('meta[name="mammogram-image-rcc"]')?.getAttribute("content"),
      lcc: document.querySelector('meta[name="mammogram-image-lcc"]')?.getAttribute("content"),
      rmlo: document.querySelector('meta[name="mammogram-image-rmlo"]')?.getAttribute("content"),
      lmlo: document.querySelector('meta[name="mammogram-image-lmlo"]')?.getAttribute("content")
    }

    if (eventId && participantName) {
      broadcastShowParticipant({
        eventId,
        participantName,
        nhsNumber,
        sxNumber,
        images
      })
    }
  }
})

// Expose for manual use and for the viewer
window.MammogramChannel = {
  broadcastShowParticipant,
  broadcastClear,
  onMammogramMessage,
  closeChannel
}
