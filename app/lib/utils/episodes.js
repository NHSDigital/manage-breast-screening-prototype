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

// Stages an episode passes through, in order. `assessment` isn't modelled yet.
const EPISODE_STAGES = ['scheduled', 'mammograms', 'reading', 'closed']

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
  event_cancelled: { stage: 'closed', outcome: 'cancelled' },
  event_did_not_attend: { stage: 'closed', outcome: 'did_not_attend' },
  event_attended_not_screened: { stage: 'closed', outcome: 'did_not_complete' }
}

// Where a concluded reading leaves its episode. Reading outcomes that mean
// reading is still under way (not_read, pending_second_read,
// arbitration_pending) are absent - the episode stays in `reading`.
//
// Assessment isn't modelled yet, so recall_for_assessment closes the episode
// rather than moving it on.
const EPISODE_STAGE_BY_READING_OUTCOME = {
  normal: { stage: 'closed', outcome: 'routine_recall' },
  recall_for_assessment: { stage: 'closed', outcome: 'recall_for_assessment' },
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

  return episodes.sort((a, b) => a.sequence - b.sequence)
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
 * Called from writeReading once a read has been saved: a concluded reading
 * is what closes an episode (or sends it back for a technical recall).
 *
 * @param {object} data - Session data
 * @param {object} event - The event that was just read
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
  EPISODE_STAGE_BY_EVENT_STATUS,
  EPISODE_STAGE_BY_READING_OUTCOME,
  getEpisode,
  getEpisodesForParticipant,
  getCurrentEpisode,
  getEpisodeEvents,
  getEpisodeReadingStatus,
  isEpisodeClosed,
  updateEpisode,
  updateEpisodeStage,
  advanceEpisodeForEventStatus,
  advanceEpisodeForReadingOutcome
}
