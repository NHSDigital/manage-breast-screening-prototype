// app/lib/utils/episodes.js
//
// An episode is one screening round for a participant - the container its
// appointment(s) sit in. See docs/data-conventions.md.
//
// Reading data still lives on events, not on the episode; the reading
// accessors here derive an episode's state from its events rather than
// holding a copy. That move happens with the work that needs it.

const dataStore = require('../data-store')
const { getEvent } = require('./event-data.js')
const { getReadingStatusForEvents } = require('./reading.js')
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

// Where an event's status leaves its episode. Shared by the generator (which
// settles seed episodes) and updateEventStatus (which keeps them in step at
// runtime), so the two can't drift apart.
//
// event_rescheduled is deliberately absent: a rescheduled appointment means
// another one is coming, so the episode stays where it is.
const EPISODE_STAGE_BY_EVENT_STATUS = {
  event_scheduled: { stage: 'scheduled' },
  event_checked_in: { stage: 'mammograms' },
  event_in_progress: { stage: 'mammograms' },
  event_paused: { stage: 'mammograms' },
  event_complete: { stage: 'reading' },
  event_partially_screened: { stage: 'reading' },
  event_cancelled: { stage: 'closed', outcome: 'no_result' },
  event_did_not_attend: { stage: 'closed', outcome: 'no_result' },
  event_attended_not_screened: { stage: 'closed', outcome: 'no_result' }
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
 * Record a changed episode so it persists for this session
 *
 * Mirrors recordEventChange: the episodes array attached to `data` is rebuilt
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
 * Get an episode's events, oldest first
 *
 * @param {object} data - Session data
 * @param {object} episode - Episode object
 * @returns {Array} The episode's events
 */
const getEpisodeEvents = (data, episode) => {
  if (!episode?.eventIds?.length) return []

  return episode.eventIds
    .map((eventId) => getEvent(data, eventId))
    .filter(Boolean)
}

/**
 * Get the reading status of an episode, derived from its events.
 *
 * Reading data lives on events, so this rescopes the existing group-level
 * reading helper over just this episode's events.
 *
 * @param {object} data - Session data
 * @param {object} episode - Episode object
 * @param {string} [userId] - Optional user, for per-user reading counts
 * @returns {object} Reading status and metrics for the episode
 */
const getEpisodeReadingStatus = (data, episode, userId = null) => {
  return getReadingStatusForEvents(getEpisodeEvents(data, episode), userId)
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
 * The date this round's screening happened, or is due to happen.
 *
 * Takes it from the episode's latest appointment, falling back to the
 * mammogram summary a historic episode carries instead of appointments.
 *
 * @param {object} data - Session data
 * @param {object} episode - Episode object
 * @returns {string | null} ISO date, or null if there's nothing to show
 */
const getEpisodeScreeningDate = (data, episode) => {
  const events = getEpisodeEvents(data, episode)
  const latestEvent = events[events.length - 1]

  if (latestEvent) {
    return (
      latestEvent.timing?.actualStartTime ||
      latestEvent.timing?.startTime ||
      null
    )
  }

  return episode?.mammogramSummary?.takenDate || null
}

/**
 * The participant's last mammogram on record, before today.
 *
 * Reads across their episodes, so it works whether the round was screened
 * here (an appointment) or is only held as a summary of a past round. This is
 * what "most recent mammogram on record" means on a participant record.
 *
 * @param {object} data - Session data
 * @param {string} participantId - Participant ID
 * @returns {object | null} { date, location, type }, or null if none on record
 */
const getLastScreening = (data, participantId) => {
  const startOfToday = new Date().setHours(0, 0, 0, 0)

  // Episodes come back oldest-first, so the last match is the most recent
  const screened = getEpisodesForParticipant(data, participantId)
    .map((episode) => ({
      episode,
      date: getEpisodeScreeningDate(data, episode)
    }))
    .filter(({ date }) => date && new Date(date) < startOfToday)

  const latest = screened[screened.length - 1]
  if (!latest) return null

  const events = getEpisodeEvents(data, latest.episode)
  const latestEvent = events[events.length - 1]

  // A round screened here knows its clinic; a summary round only knows the unit
  const unitId = latestEvent
    ? getClinic(data, latestEvent.clinicId)?.breastScreeningUnitId
    : latest.episode.mammogramSummary?.breastScreeningUnitId

  const unit = data.breastScreeningUnits?.find((each) => each.id === unitId)

  return {
    date: latest.date,
    location: unit?.name || 'Not known',

    // Every round we hold is a screening round. Appointments gain a `type`
    // (mammogram / technical recall / assessment) with the event→appointment
    // rename - read it from the appointment then, rather than assuming
    type: 'screening'
  }
}

/**
 * The participant's next booked appointment, if they have one.
 *
 * @param {object} data - Session data
 * @param {string} participantId - Participant ID
 * @returns {object | null} The event, or null if nothing is booked
 */
const getNextAppointment = (data, participantId) => {
  const now = Date.now()

  const upcoming = getEpisodesForParticipant(data, participantId)
    .filter(isEpisodeOpen)
    .flatMap((episode) => getEpisodeEvents(data, episode))
    .filter((event) => new Date(event.timing?.startTime) >= now)
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
 * Move an event's episode to wherever the event's status leaves it.
 *
 * Called from updateEventStatus, so the episode keeps step with its
 * appointment without every route having to know episodes exist.
 *
 * Only the episode's *latest* appointment moves it. An episode with more than
 * one (a technical recall) is where its most recent appointment has got to -
 * changing an earlier one, or an appointment that has been superseded, must
 * not drag the whole round backwards. This matches how the generator settles
 * seed episodes, which reads the latest event too.
 *
 * @param {object} data - Session data
 * @param {object} event - The event whose status just changed
 * @returns {object | null} The updated episode, or null if nothing to do
 */
const advanceEpisodeForEventStatus = (data, event) => {
  if (!event?.episodeId) return null

  const episode = getEpisode(data, event.episodeId)
  if (!episode) return null

  const latestEventId = episode.eventIds?.[episode.eventIds.length - 1]
  if (latestEventId && latestEventId !== event.id) return null

  const destination = EPISODE_STAGE_BY_EVENT_STATUS[event.status]
  if (!destination) return null

  return updateEpisodeStage(data, event.episodeId, destination.stage, {
    outcome: destination.outcome
  })
}

/**
 * Move an event's episode to wherever its reading outcome leaves it.
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
 * @param {object} event - The event that was read
 * @param {string} readingOutcome - Outcome from getOutcome
 * @returns {object | null} The updated episode, or null if nothing to do
 */
const advanceEpisodeForReadingOutcome = (data, event, readingOutcome) => {
  if (!event?.episodeId) return null

  const destination = EPISODE_STAGE_BY_READING_OUTCOME[readingOutcome]
  if (!destination) return null

  return updateEpisodeStage(data, event.episodeId, destination.stage, {
    outcome: destination.outcome
  })
}

module.exports = {
  EPISODE_STAGES,
  EPISODE_OUTCOMES,
  EPISODE_STAGE_BY_EVENT_STATUS,
  EPISODE_STAGE_BY_READING_OUTCOME,
  getEpisode,
  getEpisodesForParticipant,
  getCurrentEpisode,
  getEpisodeEvents,
  getEpisodeReadingStatus,
  getEpisodeScreeningDate,
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
  advanceEpisodeForEventStatus,
  advanceEpisodeForReadingOutcome
}
