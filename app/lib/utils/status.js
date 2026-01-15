// app/lib/utils/status.js

const dayjs = require('dayjs')

/**
 * Define status groups for easier checking
 *
 * @type {object}
 */
const STATUS_GROUPS = {
  not_started: ['event_scheduled', 'event_checked_in'],
  completed: ['event_complete', 'event_partially_screened'],
  final: [
    'event_complete',
    'event_partially_screened',
    'event_did_not_attend',
    'event_attended_not_screened',
    'event_cancelled',
    'event_rescheduled'
  ],
  // Final statuses for seed data generation - excludes event_rescheduled which is user-initiated only
  final_seed_data: [
    'event_complete',
    'event_partially_screened',
    'event_did_not_attend',
    'event_attended_not_screened',
    'event_cancelled'
  ],
  active: [
    'event_scheduled',
    'event_checked_in',
    'event_in_progress',
    'event_paused'
  ],
  eligible_for_reading: ['event_complete', 'event_partially_screened']
}

/**
 * Check if a status belongs to a specific group
 *
 * @param {string} status - The status to check
 * @param {string} group - The group to check against
 * @returns {boolean} Whether the status belongs to the group
 */
const isStatusInGroup = (status, group) => {
  if (!STATUS_GROUPS[group]) return false
  return STATUS_GROUPS[group].includes(status)
}

/**
 * Get status from either a status string or event object
 *
 * @param {string | object} input - Status string or event object
 * @returns {string|null} The status or null if invalid
 */
const getStatus = (input) => {
  if (!input) return null
  if (typeof input === 'string') return input
  return input.status || null
}

/**
 * Check if a status represents a not started event
 *
 * @param {string | object} input - Status string or event object
 * @returns {boolean} Whether the status is not started
 */
const hasNotStarted = (input) => {
  const status = getStatus(input)
  if (!status) return false
  return isStatusInGroup(status, 'not_started')
}

/**
 * Check if a status represents a completed event
 *
 * @param {string | object} input - Status string or event object
 * @returns {boolean} Whether the status is completed
 */
const isCompleted = (input) => {
  const status = getStatus(input)
  if (!status) return false
  return isStatusInGroup(status, 'completed')
}

/**
 * Check if a status represents an in-progress event (includes paused)
 *
 * @param {string | object} input - Status string or event object
 * @returns {boolean} Whether the status is in progress or paused
 */
const isInProgress = (input) => {
  const status = getStatus(input)
  if (!status) return false
  return status === 'event_in_progress' || status === 'event_paused'
}

/**
 * Check if a status represents a paused event
 *
 * @param {string | object} input - Status string or event object
 * @returns {boolean} Whether the status is paused
 */
const isPaused = (input) => {
  const status = getStatus(input)
  if (!status) return false
  return status === 'event_paused'
}

/**
 * Check if a status represents an in-progress event that is not paused
 *
 * @param {string | object} input - Status string or event object
 * @returns {boolean} Whether the status is in progress but not paused
 */
const isInProgressNotPaused = (input) => {
  const status = getStatus(input)
  if (!status) return false
  return status === 'event_in_progress'
}

/**
 * Check if a status represents a final state
 *
 * @param {string | object} input - Status string or event object
 * @returns {boolean} Whether the status is final
 */
const isFinal = (input) => {
  const status = getStatus(input)
  if (!status) return false
  return isStatusInGroup(status, 'final')
}

/**
 * Check if a status represents an active event
 *
 * @param {string | object} input - Status string or event object
 * @returns {boolean} Whether the status is active
 */
const isActive = (input) => {
  const status = getStatus(input)
  if (!status) return false
  return isStatusInGroup(status, 'active')
}

/**
 * Check if an event is in the appointment workflow for the current user
 *
 * @param {object} event - Event to check
 * @param {object | string} currentUser - User object with id property, or user id string directly
 * @returns {boolean} Whether the event is in the appointment workflow for this user
 */
const isAppointmentWorkflow = function (event, currentUser) {
  if (!event) return false

  // Get currentUser from context if not provided
  currentUser = currentUser || this?.ctx?.data?.currentUser

  const startedBy = event?.sessionDetails?.startedBy
  if (!currentUser || !startedBy) {
    console.log(
      `User or event not found: currentuser: ${currentUser?.id || currentUser}, startedBy: ${startedBy}`
    )
    return false
  }

  // Extract user ID whether currentUser is object or string
  const currentUserId =
    typeof currentUser === 'string' ? currentUser : currentUser.id
  if (!currentUserId) return false

  // Check if event is in progress (not paused) and started by current user
  const eventInProgressNotPaused = isInProgressNotPaused(event)

  return eventInProgressNotPaused && startedBy === currentUserId
}

/**
 * Check if a status indicates reading is eligible
 *
 * @param {string | object} event - Status string or event object
 * @returns {boolean} Whether reading is needed
 */
const eligibleForReading = (event) => {
  const status = getStatus(event)
  if (!status) return false
  const cutoffDate = dayjs().subtract(30, 'days').startOf('day')
  return (
    isStatusInGroup(status, 'eligible_for_reading') &&
    dayjs(event.timing.startTime).isAfter(cutoffDate)
  )
}

/**
 * Map a status to its corresponding tag colour in NHS.UK frontend
 *
 * @param {string} status - The status to map
 * @returns {string} The tag colour
 */
const getStatusTagColour = (status) => {
  const colourMap = {
    // Clinic statuses
    'scheduled': 'blue', // default blue
    'in_progress': 'blue',
    'closed': 'grey',

    // Event statuses
    'event_scheduled': 'blue', // default blue
    'event_checked_in': '', // no colour will get solid dark blue
    'event_in_progress': 'aqua-green',
    'event_paused': 'orange',
    'event_complete': 'green',
    'event_partially_screened': 'orange',
    'event_did_not_attend': 'red',
    'event_cancelled': 'red',
    'event_rescheduled': 'red',
    'event_attended_not_screened': 'orange',

    // Task list
    'incomplete': 'blue',
    'complete': 'green',
    'to_review': 'blue',
    'reviewed': 'green',

    // Image reading
    'not_started': 'grey',
    'not_provided': 'grey',
    'not_read': 'grey',
    'skipped': 'white',

    // Image reading results
    'normal': 'green',
    'recall_for_assessment': 'red',
    'technical_recall': 'orange',

    // Image status
    'available': 'green',
    'requested': 'orange',
    'images_requested': 'orange',
    'not_in_pacs': 'grey',

    // Metadata
    'has_symptoms': 'yellow',
    'has_repeat': 'yellow',
    'significant_symptom': 'yellow',
    'highlight_to_image_readers': 'yellow',

    // Reading statuses
    'waiting_for_1st_read': 'grey',
    'waiting_for_2nd_read': 'grey',
    'not_started': 'grey',
    'skipped': 'grey',
    'not_read': 'grey',
    'complete': 'green',
    'partial_first_read': 'blue',
    'first_read_complete': 'yellow',
    'partial_second_read': 'blue',
    'mixed_reads': 'yellow',
    'mixed_with_arbitration': 'yellow',

    'no_events': 'grey',

    // Outcomes
    'normal': 'green',
    'recall_for_assessment': 'red',
    'technical_recall': 'grey',
    'arbitration': 'orange',
    'completed_(blind)': 'grey',

    'first_read': 'blue',
    'second_read': 'blue',

    'urgent': 'red',
    'due_soon': 'orange'
  }
  return colourMap[status.toLowerCase()] || ''
}

/**
 * Map a status to its corresponding text
 *
 * @param {string} status - The status to map
 * @returns {string} The tag text
 */
const getStatusText = (status) => {
  const statusMap = {
    // Clinic statuses
    event_scheduled: 'Scheduled',
    // Event statuses
    event_checked_in: 'Checked in',
    event_in_progress: 'In progress',
    event_paused: 'Paused',
    event_complete: 'Screened',
    event_partially_screened: 'Partially screened',
    event_did_not_attend: 'Did not attend',
    event_attended_not_screened: 'Attended not screened',
    event_cancelled: 'Cancelled',
    event_rescheduled: 'Reschedule requested'

    // "technical-recall": 'Technical recall',
    // "recall-for-assesment": 'Recall for assessment',
  }
  return statusMap[status] || ''
}

const filterEventsByStatus = (events, filter) => {
  switch (filter) {
    case 'scheduled':
      return events.filter((e) => e.status === 'event_scheduled')
    case 'checked-in':
      return events.filter((e) => e.status === 'event_checked_in')
    case 'in-progress':
      return events.filter(
        (e) => e.status === 'event_in_progress' || e.status === 'event_paused'
      )
    case 'complete':
      return events.filter((e) => isFinal(e))
    case 'remaining':
      return events.filter((e) => hasNotStarted(e))
    default:
      return events
  }
}

/**
 * Check if an event is a special appointment
 *
 * @param {object} event - Event object to check
 * @returns {boolean} Whether the event is a special appointment
 */
const isSpecialAppointment = (event) => {
  return event?.specialAppointment?.supportTypes?.length > 0
}

/**
 * Check if an event has an appointment note
 *
 * @param {object} event - Event object to check
 * @returns {boolean} Whether the event has an appointment note
 */
const hasAppointmentNote = (event) => {
  return event?.appointmentNote && event.appointmentNote.trim().length > 0
}

/**
 * Check if an event has an appointment note
 *
 * @param {object} event - Event object to check
 * @returns {boolean} Whether the event has an appointment note
 */
const hasSymptoms = (event) => {
  // symptoms stored at event.medicalInformation.symptoms[]
  return (
    event?.medicalInformation?.symptoms &&
    event.medicalInformation.symptoms.length > 0
  )
}

module.exports = {
  hasNotStarted,
  isCompleted,
  isInProgress,
  isPaused,
  isInProgressNotPaused,
  isFinal,
  isActive,
  isAppointmentWorkflow,
  eligibleForReading,
  getStatusTagColour,
  getStatusText,
  filterEventsByStatus,
  isSpecialAppointment,
  hasAppointmentNote,
  hasSymptoms,
  // Export groups for testing/reference
  STATUS_GROUPS
}
