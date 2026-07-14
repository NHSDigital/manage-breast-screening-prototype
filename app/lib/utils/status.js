// app/lib/utils/status.js

const dayjs = require('dayjs')

/**
 * Define status groups for easier checking
 *
 * @type {object}
 */
const STATUS_GROUPS = {
  not_started: ['appointment_scheduled', 'appointment_checked_in'],
  completed: ['appointment_complete', 'appointment_partially_screened'],
  final: [
    'appointment_complete',
    'appointment_partially_screened',
    'appointment_did_not_attend',
    'appointment_attended_not_screened',
    'appointment_cancelled',
    'appointment_rescheduled'
  ],
  // Final statuses for seed data generation - excludes appointment_rescheduled which is user-initiated only
  final_seed_data: [
    'appointment_complete',
    'appointment_partially_screened',
    'appointment_did_not_attend',
    'appointment_attended_not_screened',
    'appointment_cancelled'
  ],
  active: [
    'appointment_scheduled',
    'appointment_checked_in',
    'appointment_in_progress',
    'appointment_paused'
  ],
  eligible_for_reading: ['appointment_complete', 'appointment_partially_screened']
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
 * Get status from either a status string or appointment object
 *
 * @param {string | object} input - Status string or appointment object
 * @returns {string|null} The status or null if invalid
 */
const getStatus = (input) => {
  if (!input) return null
  if (typeof input === 'string') return input
  return input.status || null
}

/**
 * Check if a status represents a not started appointment
 *
 * @param {string | object} input - Status string or appointment object
 * @returns {boolean} Whether the status is not started
 */
const hasNotStarted = (input) => {
  const status = getStatus(input)
  if (!status) return false
  return isStatusInGroup(status, 'not_started')
}

/**
 * Check if a status represents a completed appointment
 *
 * @param {string | object} input - Status string or appointment object
 * @returns {boolean} Whether the status is completed
 */
const isCompleted = (input) => {
  const status = getStatus(input)
  if (!status) return false
  return isStatusInGroup(status, 'completed')
}

/**
 * Check if a status represents an in-progress appointment (includes paused)
 *
 * @param {string | object} input - Status string or appointment object
 * @returns {boolean} Whether the status is in progress or paused
 */
const isInProgress = (input) => {
  const status = getStatus(input)
  if (!status) return false
  return status === 'appointment_in_progress' || status === 'appointment_paused'
}

/**
 * Check if a status represents a paused appointment
 *
 * @param {string | object} input - Status string or appointment object
 * @returns {boolean} Whether the status is paused
 */
const isPaused = (input) => {
  const status = getStatus(input)
  if (!status) return false
  return status === 'appointment_paused'
}

/**
 * Check if a status represents an in-progress appointment that is not paused
 *
 * @param {string | object} input - Status string or appointment object
 * @returns {boolean} Whether the status is in progress but not paused
 */
const isInProgressNotPaused = (input) => {
  const status = getStatus(input)
  if (!status) return false
  return status === 'appointment_in_progress'
}

/**
 * Check if a status represents a final state
 *
 * @param {string | object} input - Status string or appointment object
 * @returns {boolean} Whether the status is final
 */
const isFinal = (input) => {
  const status = getStatus(input)
  if (!status) return false
  return isStatusInGroup(status, 'final')
}

/**
 * Check if a status represents an active appointment
 *
 * @param {string | object} input - Status string or appointment object
 * @returns {boolean} Whether the status is active
 */
const isActive = (input) => {
  const status = getStatus(input)
  if (!status) return false
  return isStatusInGroup(status, 'active')
}

/**
 * Check if an appointment is in the appointment workflow for the current user
 *
 * @param {object} appointment - Appointment to check
 * @param {object | string} currentUser - User object with id property, or user id string directly
 * @returns {boolean} Whether the appointment is in the appointment workflow for this user
 */
const isAppointmentWorkflow = function (appointment, currentUser) {
  if (!appointment) return false

  // Get currentUser from context if not provided
  currentUser = currentUser || this?.ctx?.data?.currentUser

  const startedBy = appointment?.sessionDetails?.startedBy
  if (!currentUser || !startedBy) {
    console.log(
      `User or appointment not found: currentuser: ${currentUser?.id || currentUser}, startedBy: ${startedBy}`
    )
    return false
  }

  // Extract user ID whether currentUser is object or string
  const currentUserId =
    typeof currentUser === 'string' ? currentUser : currentUser.id
  if (!currentUserId) return false

  // Check if appointment is in progress (not paused) and started by current user
  const appointmentInProgressNotPaused = isInProgressNotPaused(appointment)

  return appointmentInProgressNotPaused && startedBy === currentUserId
}

/**
 * Check if a status indicates reading is eligible
 *
 * @param {string | object} appointment - Status string or appointment object
 * @returns {boolean} Whether reading is needed
 */
const eligibleForReading = (appointment) => {
  const status = getStatus(appointment)
  if (!status) return false
  const cutoffDate = dayjs().subtract(30, 'days').startOf('day')
  return (
    isStatusInGroup(status, 'eligible_for_reading') &&
    dayjs(appointment.timing.startTime).isAfter(cutoffDate)
  )
}

/**
 * Map a status key to its NHS tag colour string
 *
 * @param {string} status - The status to map
 * @returns {string} NHS tag colour (e.g. 'green', 'red', 'orange') or empty string for default blue
 * @example
 * getStatusTagColour('appointment_complete') // 'green'
 * getStatusTagColour('appointment_did_not_attend') // 'red'
 */
const getStatusTagColour = (status) => {
  // Keys are matched against snake_cased tag text as well as status keys -
  // the toTag filter tries the raw status first, then snakeCase(status), so
  // `"Waiting for 1st read" | toTag` reaches 'waiting_for_1st_read' here.
  // Check both forms before treating an entry as unused.
  const colourMap = {
    // Clinic statuses
    'scheduled': 'blue', // default blue
    'in_progress': 'blue',
    'closed': 'grey',

    // Appointment statuses
    'appointment_scheduled': 'blue', // default blue
    'appointment_checked_in': '', // no colour will get solid dark blue
    'appointment_in_progress': 'aqua-green',
    'appointment_paused': 'orange',
    'appointment_complete': 'green',
    'appointment_partially_screened': 'orange',
    'appointment_did_not_attend': 'red',
    'appointment_cancelled': 'red',
    'appointment_rescheduled': 'red',
    'appointment_attended_not_screened': 'orange',

    // Image reading results
    'normal': 'green',
    'recall_for_assessment': 'red',
    'technical_recall': 'orange',
    'clinical_recall': 'yellow',
    'abnormal': 'red',

    // Case metadata
    'has_symptoms': 'yellow',
    'highlight_to_image_readers': 'yellow',
    'imperfect': 'orange',
    'incomplete': 'orange',
    'urgent': 'red',
    'due_soon': 'orange',

    // Reading statuses
    'waiting_for_1st_read': 'grey',
    'waiting_for_2nd_read': 'grey',
    'not_started': 'grey',
    'skipped': 'grey',
    'previously_skipped': 'grey',
    'not_read': 'white',
    'complete': 'green',
    'partial_first_read': 'blue',
    'first_read_complete': 'yellow',
    'partial_second_read': 'blue',
    'mixed_reads': 'yellow',
    'no_appointments': 'grey',

    // Outcomes
    'arbitration': 'orange',
    'completed_(blind)': 'grey',

    'first_read': 'blue',
    'second_read': 'blue',

    // Prior mammogram request statuses
    'prior_not_requested': 'white',
    'prior_pending': 'orange',
    'prior_requested': 'yellow',
    'priors_requested': 'yellow',
    'deferred': 'orange',
    'prior_received': 'green',
    'prior_not_available': 'grey',
    'prior_not_needed': 'grey'
  }
  return colourMap[status.toLowerCase()] || ''
}

/**
 * Map a status key to its display text
 *
 * @param {string} status - The status to map
 * @returns {string} Human-readable status text, or empty string if unknown
 * @example
 * getStatusText('appointment_complete') // 'Screened'
 * getStatusText('appointment_did_not_attend') // 'Did not attend'
 */
const getStatusText = (status) => {
  const statusMap = {
    // Clinic statuses
    appointment_scheduled: 'Scheduled',
    // Appointment statuses
    appointment_checked_in: 'Checked in',
    appointment_in_progress: 'In progress',
    appointment_paused: 'Paused',
    appointment_complete: 'Screened',
    appointment_partially_screened: 'Partially screened',
    appointment_did_not_attend: 'Did not attend',
    appointment_attended_not_screened: 'Attended not screened',
    appointment_cancelled: 'Cancelled',
    appointment_rescheduled: 'Reschedule requested',

    // Image reading opinions
    technical_recall: 'Technical recall',
    clinical_recall: 'Clinical recall',
    recall_for_assessment: 'Recall for assessment',
    abnormal: 'Abnormal',

    // Prior mammogram request statuses
    prior_not_requested: 'Not requested',
    prior_pending: 'Needs requesting',
    prior_requested: 'Requested',
    prior_received: 'Received',
    prior_not_available: 'Not available',
    prior_not_needed: 'Not needed'

    // "technical-recall": 'Technical recall',
    // "recall-for-assesment": 'Recall for assessment',
  }
  return statusMap[status] || ''
}

/**
 * Filter appointments by status category
 *
 * @param {Array} appointments - Appointments to filter
 * @param {string} filter - Category: 'scheduled', 'checked-in', 'in-progress', 'complete', or 'remaining'
 * @returns {Array} Filtered appointments
 */
const filterAppointmentsByStatus = (appointments, filter) => {
  switch (filter) {
    case 'scheduled':
      return appointments.filter((e) => e.status === 'appointment_scheduled')
    case 'checked-in':
      return appointments.filter((e) => e.status === 'appointment_checked_in')
    case 'in-progress':
      return appointments.filter(
        (e) => e.status === 'appointment_in_progress' || e.status === 'appointment_paused'
      )
    case 'complete':
      return appointments.filter((e) => isFinal(e))
    case 'remaining':
      return appointments.filter((e) => hasNotStarted(e))
    default:
      return appointments
  }
}

/**
 * Check if an appointment is a special appointment
 *
 * @param {object} appointment - Appointment object to check
 * @returns {boolean} Whether the appointment is a special appointment
 */
const isSpecialAppointment = (appointment) => {
  return appointment?.specialAppointment?.supportTypes?.length > 0
}

/**
 * Check if an appointment has an appointment note
 *
 * @param {object} appointment - Appointment object to check
 * @returns {boolean} Whether the appointment has an appointment note
 */
const hasAppointmentNote = (appointment) => {
  return appointment?.appointmentNote && appointment.appointmentNote.trim().length > 0
}

/**
 * Check if an appointment has recorded symptoms
 *
 * @param {object} appointment - Appointment object to check
 * @returns {boolean} Whether the appointment has any symptoms
 */
const hasSymptoms = (appointment) => {
  // symptoms stored at appointment.medicalInformation.symptoms[]
  return (
    appointment?.medicalInformation?.symptoms &&
    appointment.medicalInformation.symptoms.length > 0
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
  filterAppointmentsByStatus,
  isSpecialAppointment,
  hasAppointmentNote,
  hasSymptoms,
  // Export groups for testing/reference
  STATUS_GROUPS
}
