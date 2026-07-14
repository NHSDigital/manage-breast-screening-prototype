// app/lib/utils/status.js

const dayjs = require('dayjs')

/**
 * Define status groups for easier checking
 *
 * @type {object}
 */
const STATUS_GROUPS = {
  not_started: ['scheduled', 'checked_in'],
  completed: ['complete', 'partially_screened'],
  final: [
    'complete',
    'partially_screened',
    'did_not_attend',
    'attended_not_screened',
    'cancelled',
    'rescheduled'
  ],
  // Final statuses for seed data generation - excludes rescheduled which is user-initiated only
  final_seed_data: [
    'complete',
    'partially_screened',
    'did_not_attend',
    'attended_not_screened',
    'cancelled'
  ],
  active: [
    'scheduled',
    'checked_in',
    'in_progress',
    'paused'
  ],
  eligible_for_reading: ['complete', 'partially_screened']
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
  return status === 'in_progress' || status === 'paused'
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
  return status === 'paused'
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
  return status === 'in_progress'
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

// How statuses are shown, one vocabulary per entity. Each entry gives the
// tag colour and (where the label differs from sentence-cased words) the
// label. Callers can name the vocabulary (toTag's vocabulary option, or the
// second argument to the getters); without one, DEFAULT_VOCABULARY_ORDER
// below decides which vocabulary wins a shared key.
//
// Keys are matched against snake_cased tag text as well as status keys -
// the toTag filter tries the raw status first, then snakeCase(status), so
// `"Waiting for 1st read" | toTag` reaches 'waiting_for_1st_read' here.
// Check both forms before treating an entry as unused.
const STATUS_TAGS = {
  appointment: {
    scheduled: { label: 'Scheduled', colour: 'blue' },
    checked_in: { label: 'Checked in', colour: '' }, // no colour will get solid dark blue
    in_progress: { label: 'In progress', colour: 'aqua-green' },
    paused: { label: 'Paused', colour: 'orange' },
    complete: { label: 'Screened', colour: 'green' },
    partially_screened: { label: 'Partially screened', colour: 'orange' },
    did_not_attend: { label: 'Did not attend', colour: 'red' },
    attended_not_screened: { label: 'Attended not screened', colour: 'orange' },
    cancelled: { label: 'Cancelled', colour: 'red' },
    rescheduled: { label: 'Reschedule requested', colour: 'red' }
  },
  clinic: {
    scheduled: { colour: 'blue' },
    in_progress: { colour: 'blue' },
    closed: { colour: 'grey' }
  },
  // Image reading results and outcomes
  opinion: {
    normal: { colour: 'green' },
    recall_for_assessment: { label: 'Recall for assessment', colour: 'red' },
    technical_recall: { label: 'Technical recall', colour: 'orange' },
    clinical_recall: { label: 'Clinical recall', colour: 'yellow' },
    abnormal: { label: 'Abnormal', colour: 'red' },
    arbitration: { colour: 'orange' }
  },
  // Reading journey state - mostly derived, reached via snake-cased tag text
  readingState: {
    'waiting_for_1st_read': { colour: 'grey' },
    'waiting_for_2nd_read': { colour: 'grey' },
    'not_started': { colour: 'grey' },
    'skipped': { colour: 'grey' },
    'previously_skipped': { colour: 'grey' },
    'not_read': { colour: 'white' },
    'complete': { colour: 'green' },
    'partial_first_read': { colour: 'blue' },
    'first_read_complete': { colour: 'yellow' },
    'partial_second_read': { colour: 'blue' },
    'mixed_reads': { colour: 'yellow' },
    'no_appointments': { colour: 'grey' },
    'completed_(blind)': { colour: 'grey' },
    'first_read': { colour: 'blue' },
    'second_read': { colour: 'blue' }
  },
  // External prior mammogram request tracking (episode.priors)
  priorsRequest: {
    not_requested: { label: 'Not requested', colour: 'white' },
    pending: { label: 'Needs requesting', colour: 'orange' },
    requested: { label: 'Requested', colour: 'yellow' },
    received: { label: 'Received', colour: 'green' },
    not_available: { label: 'Not available', colour: 'grey' },
    not_needed: { label: 'Not needed', colour: 'grey' }
  },
  // Ad-hoc case tags, reached via snake-cased tag text
  misc: {
    has_symptoms: { colour: 'yellow' },
    highlight_to_image_readers: { colour: 'yellow' },
    imperfect: { colour: 'orange' },
    incomplete: { colour: 'orange' },
    urgent: { colour: 'red' },
    due_soon: { colour: 'orange' },
    priors_requested: { colour: 'yellow' },
    deferred: { colour: 'orange' }
  }
}

// Which vocabulary wins a shared key when the caller doesn't name one.
// Mirrors the behaviour of the old single shared map: unhinted 'in_progress'
// and 'complete' read as clinic/reading values, and appointment statuses
// resolve last - appointment call sites should pass the vocabulary.
// priorsRequest is deliberately absent: its unprefixed keys are only
// reachable with an explicit vocabulary, as they were only reachable with
// the old prior_ display prefix before.
const DEFAULT_VOCABULARY_ORDER = [
  'clinic',
  'readingState',
  'opinion',
  'misc',
  'appointment'
]

/**
 * Find a status's display entry, in one vocabulary or across the default
 * search order
 *
 * @param {string} status - The status to look up
 * @param {string} [vocabulary] - Vocabulary to look in (e.g. 'appointment')
 * @returns {object | null} { label?, colour } or null if not found
 */
const findStatusTag = (status, vocabulary = null) => {
  if (!status) return null

  const key = String(status).toLowerCase()

  if (vocabulary) {
    return STATUS_TAGS[vocabulary]?.[key] || null
  }

  for (const name of DEFAULT_VOCABULARY_ORDER) {
    if (STATUS_TAGS[name][key]) return STATUS_TAGS[name][key]
  }
  return null
}

/**
 * Map a status key to its NHS tag colour string
 *
 * @param {string} status - The status to map
 * @param {string} [vocabulary] - Vocabulary to look in (e.g. 'appointment')
 * @returns {string} NHS tag colour (e.g. 'green', 'red', 'orange') or empty string for default blue
 * @example
 * getStatusTagColour('complete', 'appointment') // 'green'
 * getStatusTagColour('did_not_attend') // 'red'
 */
const getStatusTagColour = (status, vocabulary = null) => {
  return findStatusTag(status, vocabulary)?.colour || ''
}

/**
 * Map a status key to its display text
 *
 * @param {string} status - The status to map
 * @param {string} [vocabulary] - Vocabulary to look in (e.g. 'appointment')
 * @returns {string} Human-readable status text, or empty string if unknown
 * @example
 * getStatusText('complete', 'appointment') // 'Screened'
 * getStatusText('did_not_attend') // 'Did not attend'
 */
const getStatusText = (status, vocabulary = null) => {
  return findStatusTag(status, vocabulary)?.label || ''
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
      return appointments.filter((appointment) => appointment.status === 'scheduled')
    case 'checked-in':
      return appointments.filter((appointment) => appointment.status === 'checked_in')
    case 'in-progress':
      return appointments.filter(
        (appointment) =>
          appointment.status === 'in_progress' ||
          appointment.status === 'paused'
      )
    case 'complete':
      return appointments.filter((appointment) => isFinal(appointment))
    case 'remaining':
      return appointments.filter((appointment) => hasNotStarted(appointment))
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
  // Export groups and display vocabularies for testing/reference
  STATUS_GROUPS,
  STATUS_TAGS
}
