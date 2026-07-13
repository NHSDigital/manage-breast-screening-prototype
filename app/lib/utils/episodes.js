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
// - routine_recall  clear - reading found nothing, or assessment did not
// - under_care      cancer or abnormality found; they are in treatment or
//                   follow-up rather than routine screening
// - no_result       the round ended without a screening result. Why (did not
//                   attend, cancelled, attended but not screened) is on the
//                   appointment - it isn't stored twice
const EPISODE_OUTCOMES = ['routine_recall', 'under_care', 'no_result']

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

  const episodeIds =
    dataStore.state.episodeIdsByParticipant.get(participantId) || []

  const episodes = episodeIds
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
  }

  return updateEpisode(data, episodeId, updates)
}

/**
 * Move an event's episode to wherever the event's status leaves it.
 *
 * Called from updateEventStatus, so the episode keeps step with its
 * appointment without every route having to know episodes exist.
 *
 * @param {object} data - Session data
 * @param {object} event - The event whose status just changed
 * @returns {object | null} The updated episode, or null if nothing to do
 */
const advanceEpisodeForEventStatus = (data, event) => {
  if (!event?.episodeId) return null

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
  isEpisodeClosed,
  isEpisodeOpen,
  updateEpisode,
  updateEpisodeStage,
  advanceEpisodeForEventStatus,
  advanceEpisodeForReadingOutcome
}
