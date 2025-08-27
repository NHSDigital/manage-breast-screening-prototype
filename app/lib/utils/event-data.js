// app/lib/utils/event-data.js
const { getParticipant } = require('./participants.js')

/**
 * Get an event by ID
 * @param {Object} data - Session data
 * @param {string} eventId - Event ID
 * @returns {Object|null} Event object or null if not found
 */
const getEvent = (data, eventId) => {
  return data.events.find(e => e.id === eventId) || null
}

const getEventData = (data, clinicId, eventId) => {
  const clinic = data.clinics.find(c => c.id === clinicId)
  if (!clinic) return null

  const event = data.events.find(e => e.id === eventId && e.clinicId === clinicId)
  if (!event) return null

  const participant = getParticipant(data, event.participantId)
  const unit = data.breastScreeningUnits.find(u => u.id === clinic.breastScreeningUnitId)
  const location = unit.locations.find(l => l.id === clinic.locationId)

  return { clinic, event, participant, location, unit }
}

/**
 * Find and update an event in session data
 * @param {Object} data - Session data
 * @param {string} eventId - Event ID
 * @param {Object} updatedEvent - Updated event object
 * @returns {Object|null} Updated event or null if not found
 */
const updateEvent = (data, eventId, updatedEvent) => {
  const eventIndex = data.events.findIndex(e => e.id === eventId)
  if (eventIndex === -1) return null

  // Update in the array
  data.events[eventIndex] = updatedEvent
  return updatedEvent
}

/**
 * Update event status and add to history
 * Also updates the temporary event data if it exists
 * @param {Object} data - Session data
 * @param {string} eventId - Event ID
 * @param {string} newStatus - New status
 * @returns {Object|null} Updated event or null if not found
 */
const updateEventStatus = (data, eventId, newStatus) => {
  const eventIndex = data.events.findIndex(e => e.id === eventId)
  if (eventIndex === -1) return null

  // Use temp event if it exists and matches, otherwise use the array event
  const baseEvent = (data.event && data.event.id === eventId) ? data.event : data.events[eventIndex]

  const updatedEvent = {
    ...baseEvent,
    status: newStatus,
    statusHistory: [
      ...baseEvent.statusHistory,
      {
        status: newStatus,
        timestamp: new Date().toISOString(),
      },
    ],
  }

  // Update main data
  data.events[eventIndex] = updatedEvent

  // Also update temp event data if it exists and matches this event
  // Only update the status-related fields to preserve other temp changes
  if (data.event && data.event.id === eventId) {
    data.event.status = newStatus
    data.event.statusHistory = updatedEvent.statusHistory
  }

  return updatedEvent
}

/**
 * Update event with arbitrary data changes
 * Also updates the temporary event data if it exists and matches
 * @param {Object} data - Session data
 * @param {string} eventId - Event ID
 * @param {Object} updates - Object containing updates to merge into the event
 * @returns {Object|null} Updated event or null if not found
 */
const updateEventData = (data, eventId, updates) => {
  const eventIndex = data.events.findIndex(e => e.id === eventId)
  if (eventIndex === -1) return null

  // Use temp event if it exists and matches, otherwise use the array event
  const baseEvent = (data.event && data.event.id === eventId) ? data.event : data.events[eventIndex]

  const updatedEvent = {
    ...baseEvent,
    ...updates
  }

  // Update main data
  data.events[eventIndex] = updatedEvent

  // Also update temp event data if it exists and matches this event
  // Merge updates into existing temp event to preserve any unsaved changes
  if (data.event && data.event.id === eventId) {
    data.event = {
      ...data.event,
      ...updates
    }
  }

  return updatedEvent
}

/**
 * Save temporary event data back to the main event
 * @param {Object} data - Session data
 * @returns {Object|null} Updated event or null if no temp data
 *
 * This function takes the data.event object and saves it back to the
 * events array, then clears event. It's used at the end of a workflow
 * to commit changes made to the temporary event back to the main array.
 */
const saveTempEventToEvent = (data) => {
  if (!data.event || !data.event.id) {
    return null
  }

  const eventId = data.event.id

  // Use updateEvent to save the temp data
  const updatedEvent = updateEvent(data, eventId, data.event)

  // Clear temp data
  delete data.event

  return updatedEvent
}


module.exports = {
  getEvent,
  getEventData,
  updateEvent,
  updateEventStatus,
  updateEventData,
  saveTempEventToEvent,
}
