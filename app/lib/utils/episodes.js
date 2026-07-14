// app/lib/utils/episodes.js
//
// An episode is one screening round for a participant - the container its
// appointment(s) sit in. See docs/data-conventions.md.
//
// Reading data still lives on appointments, not on the episode; the reading
// accessors here derive an episode's state from its appointments rather than
// holding a copy. That move happens with the work that needs it.

const dataStore = require('../data-store')
const { getAppointment } = require('./appointment-data.js')
const { getReadingStatusForAppointments } = require('./reading.js')
const { getClinic } = require('./clinics.js')

// An episode is open until it closes. While open, the stage says where in the
// process it has got to; `closed` means it has an outcome and is done.
//
// `assessment` needs no modelling of its own - it is simply an open episode
// that has not concluded.
const EPISODE_STAGES = [
  'scheduled',
  'mammograms',
  'reading',
  'assessment',
  'closed'
]

// What the round found, set only when the episode closes. This is the
// meta-level answer, not the detail of how we got there:
//
// - routine_recall        clear - reading found nothing, or assessment did not
// - refer_for_treatment   cancer or abnormality found; the round ends by
//                         referring them into treatment rather than back to
//                         routine screening
// - no_result             the round ended without a screening result. Why (did
//                         not attend, cancelled, attended but not screened) is
//                         on the appointment - it isn't stored twice
const EPISODE_OUTCOMES = ['routine_recall', 'refer_for_treatment', 'no_result']

// How stages and outcomes are shown. Kept as their own vocabularies rather
// than added to the one big shared status map - the labels users read are a
// display concern, and can differ from the stored value.
const EPISODE_STAGE_TAGS = {
  scheduled: { label: 'Scheduled', colour: 'blue' },
  mammograms: { label: 'Mammograms', colour: 'purple' },
  reading: { label: 'Waiting for reading', colour: 'yellow' },
  assessment: { label: 'At assessment', colour: 'orange' },
  closed: { label: 'Closed', colour: 'grey' }
}

const EPISODE_OUTCOME_TAGS = {
  routine_recall: { label: 'Routine recall', colour: 'green' },
  refer_for_treatment: { label: 'Referred for treatment', colour: 'red' },
  no_result: { label: 'No result', colour: 'grey' }
}

// Where an appointment's status leaves its episode. Shared by the generator (which
// settles seed episodes) and updateAppointmentStatus (which keeps them in step at
// runtime), so the two can't drift apart.
//
// appointment_rescheduled is deliberately absent: a rescheduled appointment means
// another one is coming, so the episode stays where it is.
const EPISODE_STAGE_BY_APPOINTMENT_STATUS = {
  appointment_scheduled: { stage: 'scheduled' },
  appointment_checked_in: { stage: 'mammograms' },
  appointment_in_progress: { stage: 'mammograms' },
  appointment_paused: { stage: 'mammograms' },
  appointment_complete: { stage: 'reading' },
  appointment_partially_screened: { stage: 'reading' },
  appointment_cancelled: { stage: 'closed', outcome: 'no_result' },
  appointment_did_not_attend: { stage: 'closed', outcome: 'no_result' },
  appointment_attended_not_screened: { stage: 'closed', outcome: 'no_result' }
}

// Where a concluded reading leaves its episode. Reading outcomes that mean
// reading is still under way (not_read, pending_second_read,
// arbitration_pending) are absent - the episode stays in `reading`.
//
// Note a clear reading is the only one that ends the episode. Recall for
// assessment is an interim routing decision, not a result: it moves the
// episode on to assessment, which is where the result actually comes from.
const EPISODE_STAGE_BY_READING_OUTCOME = {
  normal: { stage: 'closed', outcome: 'routine_recall' },
  recall_for_assessment: { stage: 'assessment' },
  // A re-screen is owed, so the episode goes back for more mammograms
  technical_recall: { stage: 'mammograms' }
}

/**
 * Whether an appointment's status means mammograms were taken.
 *
 * Derived from the stage map rather than listed again: any status that sends
 * the episode to reading produced images, because reading without images is
 * the thing the model forbids.
 *
 * @param {object} appointment - Appointment object
 * @returns {boolean} True if this appointment produced images
 */
const appointmentProducedImages = (appointment) => {
  return EPISODE_STAGE_BY_APPOINTMENT_STATUS[appointment?.status]?.stage === 'reading'
}

/**
 * Build the episode's summary record of one set of mammograms.
 *
 * The raw image data stays on the appointment (`mammogramData`); this is the light
 * entry the episode carries so "was this round screened, when and where" is
 * answerable without walking appointments. Shared with the seed generator so
 * the two can't drift. One entry per image set is also the skeleton the
 * reading-cases model hangs off later.
 *
 * @param {object} appointment - The appointment that produced the images
 * @param {object} [clinic] - The appointment's clinic, for where they were taken
 * @returns {object} Mammogram entry
 */
const buildMammogramEntry = (appointment, clinic) => {
  const views = appointment.mammogramData?.views || {}

  return {
    takenDate: appointment.timing?.actualStartTime || appointment.timing?.startTime || null,
    appointmentId: appointment.id,
    breastScreeningUnitId: clinic?.breastScreeningUnitId || null,
    locationId: clinic?.locationId || null,
    viewCount: Object.values(views).filter(Boolean).length || null
  }
}

/**
 * Record a changed episode so it persists for this session
 *
 * Mirrors recordAppointmentChange: the episodes array attached to `data` is rebuilt
 * from the shared store every request, so only records written into
 * data._changes survive (see the attach middleware in app/routes.js).
 *
 * @param {object} data - Session data
 * @param {object} episode - Whole replacement episode record
 */
const recordEpisodeChange = (data, episode) => {
  if (data._changes?.episodes) {
    data._changes.episodes[episode.id] = episode
  }
}

/**
 * Get an episode by ID
 *
 * Session changes first, then the shared store's id index, then a scan of
 * data.episodes for records that exist only in the passed data.
 *
 * @param {object} data - Session data
 * @param {string} episodeId - Episode ID
 * @returns {object | null} Episode object or null if not found
 */
const getEpisode = (data, episodeId) => {
  if (!episodeId) return null

  return (
    data._changes?.episodes?.[episodeId] ??
    dataStore.state.episodesById.get(episodeId) ??
    data.episodes?.find((episode) => episode.id === episodeId) ??
    null
  )
}

/**
 * Get all of a participant's episodes, oldest first
 *
 * @param {object} data - Session data
 * @param {string} participantId - Participant ID
 * @returns {Array} Episodes in sequence order
 */
const getEpisodesForParticipant = (data, participantId) => {
  if (!participantId) return []

  const episodeIds = new Set(
    dataStore.state.episodeIdsByParticipant.get(participantId) || []
  )

  // Anything created this session exists only in _changes, so isn't in the
  // store's index. Nothing creates episodes at runtime today, but getEpisode
  // would find such a record and this shouldn't disagree with it.
  Object.values(data._changes?.episodes || {})
    .filter((episode) => episode.participantId === participantId)
    .forEach((episode) => episodeIds.add(episode.id))

  const episodes = [...episodeIds]
    .map((episodeId) => getEpisode(data, episodeId))
    .filter(Boolean)

  return episodes.sort(
    (a, b) => new Date(a.openedDate) - new Date(b.openedDate)
  )
}

/**
 * Get a participant's current episode - their most recent one that hasn't
 * closed. Returns null if every episode is closed (nothing in progress).
 *
 * @param {object} data - Session data
 * @param {string} participantId - Participant ID
 * @returns {object | null} The open episode, or null
 */
const getCurrentEpisode = (data, participantId) => {
  const episodes = getEpisodesForParticipant(data, participantId)

  return (
    [...episodes].reverse().find((episode) => !isEpisodeClosed(episode)) ?? null
  )
}

/**
 * Get an episode's appointments, oldest first
 *
 * @param {object} data - Session data
 * @param {object} episode - Episode object
 * @returns {Array} The episode's appointments
 */
const getEpisodeAppointments = (data, episode) => {
  if (!episode?.appointmentIds?.length) return []

  return episode.appointmentIds
    .map((appointmentId) => getAppointment(data, appointmentId))
    .filter(Boolean)
}

/**
 * Get the reading status of an episode, derived from its appointments.
 *
 * Reading data lives on appointments, so this rescopes the existing group-level
 * reading helper over just this episode's appointments.
 *
 * @param {object} data - Session data
 * @param {object} episode - Episode object
 * @param {string} [userId] - Optional user, for per-user reading counts
 * @returns {object} Reading status and metrics for the episode
 */
const getEpisodeReadingStatus = (data, episode, userId = null) => {
  return getReadingStatusForAppointments(getEpisodeAppointments(data, episode), userId)
}

/**
 * Whether an episode has closed
 *
 * @param {object} episode - Episode object
 * @returns {boolean} True if closed
 */
const isEpisodeClosed = (episode) => {
  return episode?.stage === 'closed'
}

/**
 * Whether an episode is still open - anything that hasn't closed, whatever
 * stage it has reached
 *
 * @param {object} episode - Episode object
 * @returns {boolean} True if open
 */
const isEpisodeOpen = (episode) => {
  return Boolean(episode) && !isEpisodeClosed(episode)
}

/**
 * When this round's mammograms were taken, from the episode's own record.
 *
 * Null when the round has produced no images - not yet screened, did not
 * attend, cancelled. A round with no images has no mammogram date, which is
 * what stops a missed appointment showing as someone's last mammogram.
 *
 * @param {object} episode - Episode object
 * @returns {string | null} ISO date of the latest set, or null if never screened
 */
const getEpisodeMammogramDate = (episode) => {
  const entries = episode?.mammograms || []
  return entries[entries.length - 1]?.takenDate || null
}

/**
 * The participant's last mammogram on record, before today.
 *
 * Reads the mammogram entries across their episodes, so it works whether the
 * round was screened here (entry carries the appointment and site) or is only
 * held as a summary of a past round (entry carries the unit). This is what
 * "most recent mammogram on record" means on a participant record.
 *
 * @param {object} data - Session data
 * @param {string} participantId - Participant ID
 * @returns {object | null} { date, location, type }, or null if none on record
 */
const getLastScreening = (data, participantId) => {
  const startOfToday = new Date().setHours(0, 0, 0, 0)

  // Every image set across their episodes, oldest first
  const taken = getEpisodesForParticipant(data, participantId)
    .flatMap((episode) => episode.mammograms || [])
    .filter(
      (entry) => entry.takenDate && new Date(entry.takenDate) < startOfToday
    )
    .sort((a, b) => new Date(a.takenDate) - new Date(b.takenDate))

  const latest = taken[taken.length - 1]
  if (!latest) return null

  const unit = data.breastScreeningUnits?.find(
    (each) => each.id === latest.breastScreeningUnitId
  )
  const location = unit?.locations?.find(
    (each) => each.id === latest.locationId
  )

  return {
    date: latest.takenDate,

    // The specific site where we know it (a round screened here); a summary
    // round only knows its unit
    location: location?.name || unit?.name || 'Not known',

    // Every round we hold is a screening round. Appointments gain a `type`
    // (mammogram / technical recall / assessment) with the appointment→appointment
    // rename - read it from the appointment then, rather than assuming
    type: 'screening'
  }
}

/**
 * The participant's next booked appointment, if they have one.
 *
 * @param {object} data - Session data
 * @param {string} participantId - Participant ID
 * @returns {object | null} The appointment, or null if nothing is booked
 */
const getNextAppointment = (data, participantId) => {
  const now = Date.now()

  const upcoming = getEpisodesForParticipant(data, participantId)
    .filter(isEpisodeOpen)
    .flatMap((episode) => getEpisodeAppointments(data, episode))
    .filter((appointment) => new Date(appointment.timing?.startTime) >= now)
    .sort((a, b) => new Date(a.timing.startTime) - new Date(b.timing.startTime))

  return upcoming[0] || null
}

/**
 * Display text for an episode's stage
 *
 * @param {string} stage - Episode stage
 * @returns {string} Label to show
 */
const getEpisodeStageText = (stage) => {
  return EPISODE_STAGE_TAGS[stage]?.label || 'Unknown'
}

/**
 * Tag colour for an episode's stage
 *
 * @param {string} stage - Episode stage
 * @returns {string} NHS tag colour
 */
const getEpisodeStageTagColour = (stage) => {
  return EPISODE_STAGE_TAGS[stage]?.colour || 'grey'
}

/**
 * Display text for an episode's outcome
 *
 * @param {string} outcome - Episode outcome
 * @returns {string} Label to show
 */
const getEpisodeOutcomeText = (outcome) => {
  return EPISODE_OUTCOME_TAGS[outcome]?.label || 'Unknown'
}

/**
 * Tag colour for an episode's outcome
 *
 * @param {string} outcome - Episode outcome
 * @returns {string} NHS tag colour
 */
const getEpisodeOutcomeTagColour = (outcome) => {
  return EPISODE_OUTCOME_TAGS[outcome]?.colour || 'grey'
}

/**
 * Update an episode, persisting the change for this session.
 *
 * Build a whole replacement record - never mutate the one you read, it's
 * frozen (see docs/data-conventions.md).
 *
 * @param {object} data - Session data
 * @param {string} episodeId - Episode ID
 * @param {object} updates - Fields to merge into the episode
 * @returns {object | null} The updated episode, or null if not found
 */
const updateEpisode = (data, episodeId, updates) => {
  const episode = getEpisode(data, episodeId)
  if (!episode) {
    console.warn(`updateEpisode: no episode with id ${episodeId}`)
    return null
  }

  const updatedEpisode = { ...episode, ...updates }

  // Replace in the request's episodes array so later reads in this request
  // see the change, then record it so it survives to the next request
  const index = data.episodes?.findIndex(
    (candidate) => candidate.id === episodeId
  )
  if (index >= 0) {
    data.episodes[index] = updatedEpisode
  }
  recordEpisodeChange(data, updatedEpisode)

  return updatedEpisode
}

/**
 * Advance an episode to a new stage, appending to its stageHistory.
 *
 * Stage moves are not validated: any stage can follow any other. Moving to
 * `closed` sets closedDate, and takes the final outcome if one is given.
 * Moving *off* closed reopens the episode - the outcome and closedDate are
 * cleared, because an open episode has neither (undoing a cancellation is the
 * path that gets here).
 *
 * @param {object} data - Session data
 * @param {string} episodeId - Episode ID
 * @param {string} stage - New stage
 * @param {object} [options]
 * @param {string} [options.outcome] - Final outcome, when closing
 * @returns {object | null} The updated episode, or null if not found
 */
const updateEpisodeStage = (data, episodeId, stage, options = {}) => {
  const episode = getEpisode(data, episodeId)
  if (!episode) {
    console.warn(`updateEpisodeStage: no episode with id ${episodeId}`)
    return null
  }

  if (!EPISODE_STAGES.includes(stage)) {
    console.warn(`updateEpisodeStage: unknown stage "${stage}"`)
  }

  // Already there - nothing to record
  if (episode.stage === stage) return episode

  const timestamp = new Date().toISOString()

  const updates = {
    stage,
    stageHistory: [...(episode.stageHistory || []), { stage, timestamp }]
  }

  if (stage === 'closed') {
    updates.closedDate = timestamp
    if (options.outcome) updates.outcome = options.outcome
  } else if (isEpisodeClosed(episode)) {
    // Reopening: it has no result any more, and it isn't closed
    updates.outcome = null
    updates.closedDate = null
  }

  return updateEpisode(data, episodeId, updates)
}

/**
 * Keep an episode's mammograms record in step with one of its appointments.
 *
 * Called from updateAppointmentStatus alongside advanceEpisodeForAppointmentStatus: an
 * appointment reaching a screened status writes its entry, and leaving one
 * (an undo) removes it. Recording the fact at the moment it happens is what
 * lets everything downstream trust episode.mammograms instead of re-deriving
 * "were they screened" from appointment timing.
 *
 * Unlike stage moves this applies whichever of the episode's appointments
 * changed - images from an earlier appointment still exist when a re-screen
 * supersedes it.
 *
 * @param {object} data - Session data
 * @param {object} appointment - The appointment whose status just changed
 * @returns {object | null} The updated episode, or null if nothing to do
 */
const syncEpisodeMammogramsForAppointment = (data, appointment) => {
  if (!appointment?.episodeId) return null

  const episode = getEpisode(data, appointment.episodeId)
  if (!episode) return null

  const existing = episode.mammograms || []
  const otherEntries = existing.filter((entry) => entry.appointmentId !== appointment.id)

  if (!appointmentProducedImages(appointment)) {
    // No images from this appointment - drop its entry if it had one
    if (otherEntries.length === existing.length) return null
    return updateEpisode(data, episode.id, { mammograms: otherEntries })
  }

  const entries = [
    ...otherEntries,
    buildMammogramEntry(appointment, getClinic(data, appointment.clinicId))
  ].sort((a, b) => new Date(a.takenDate) - new Date(b.takenDate))

  return updateEpisode(data, episode.id, { mammograms: entries })
}

/**
 * Move an appointment's episode to wherever the appointment's status leaves it.
 *
 * Called from updateAppointmentStatus, so the episode keeps step with its
 * appointment without every route having to know episodes exist.
 *
 * Only the episode's *latest* appointment moves it. An episode with more than
 * one (a technical recall) is where its most recent appointment has got to -
 * changing an earlier one, or an appointment that has been superseded, must
 * not drag the whole round backwards. This matches how the generator settles
 * seed episodes, which reads the latest appointment too.
 *
 * @param {object} data - Session data
 * @param {object} appointment - The appointment whose status just changed
 * @returns {object | null} The updated episode, or null if nothing to do
 */
const advanceEpisodeForAppointmentStatus = (data, appointment) => {
  if (!appointment?.episodeId) return null

  const episode = getEpisode(data, appointment.episodeId)
  if (!episode) return null

  const latestAppointmentId = episode.appointmentIds?.[episode.appointmentIds.length - 1]
  if (latestAppointmentId && latestAppointmentId !== appointment.id) return null

  const destination = EPISODE_STAGE_BY_APPOINTMENT_STATUS[appointment.status]
  if (!destination) return null

  return updateEpisodeStage(data, appointment.episodeId, destination.stage, {
    outcome: destination.outcome
  })
}

/**
 * Move an appointment's episode to wherever its reading outcome leaves it.
 *
 * Deliberately NOT called when a read is saved. Two opinions and a computed
 * outcome is not a confirmed result: there is no confirmation step in the
 * app yet, so writing a read leaves the episode in `reading`. This is what
 * that confirmation step should call once it exists.
 *
 * The seed generator uses the same map to settle rounds read long enough ago
 * that they would have been confirmed by now.
 *
 * @param {object} data - Session data
 * @param {object} appointment - The appointment that was read
 * @param {string} readingOutcome - Outcome from getOutcome
 * @returns {object | null} The updated episode, or null if nothing to do
 */
const advanceEpisodeForReadingOutcome = (data, appointment, readingOutcome) => {
  if (!appointment?.episodeId) return null

  const destination = EPISODE_STAGE_BY_READING_OUTCOME[readingOutcome]
  if (!destination) return null

  return updateEpisodeStage(data, appointment.episodeId, destination.stage, {
    outcome: destination.outcome
  })
}

module.exports = {
  EPISODE_STAGES,
  EPISODE_OUTCOMES,
  EPISODE_STAGE_BY_APPOINTMENT_STATUS,
  EPISODE_STAGE_BY_READING_OUTCOME,
  appointmentProducedImages,
  buildMammogramEntry,
  getEpisode,
  getEpisodesForParticipant,
  getCurrentEpisode,
  getEpisodeAppointments,
  getEpisodeReadingStatus,
  getEpisodeMammogramDate,
  getLastScreening,
  getNextAppointment,
  getEpisodeStageText,
  getEpisodeStageTagColour,
  getEpisodeOutcomeText,
  getEpisodeOutcomeTagColour,
  isEpisodeClosed,
  isEpisodeOpen,
  updateEpisode,
  updateEpisodeStage,
  syncEpisodeMammogramsForAppointment,
  advanceEpisodeForAppointmentStatus,
  advanceEpisodeForReadingOutcome
}
