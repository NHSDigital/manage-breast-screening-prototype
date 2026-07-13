// app/lib/generators/episode-generator.js
//
// An episode is one screening round for a participant - the container the
// appointment(s), and later the reading, hang off. See
// docs/data-conventions.md.
//
// Episodes are generated *first*, in the clinic-day loop: an episode is
// created, then the event that sits inside it. Two things can't be known at
// that point and are filled in by later passes in generate-seed-data.js:
//
// - sequence: snapshots are generated newest-first, so a participant's
//   episodes are only orderable once every snapshot has run.
// - stage / outcome: these depend on reading data, which is attached to
//   events by generateReadingData - the very last generation pass.

const dayjs = require('dayjs')
const weighted = require('weighted')
const { faker } = require('@faker-js/faker')
const generateId = require('../utils/id-generator')
const riskLevels = require('../../data/risk-levels')
const { getOutcome } = require('../utils/reading')
const { eligibleForReading, isCompleted } = require('../utils/status')
const {
  EPISODE_STAGE_BY_EVENT_STATUS,
  EPISODE_STAGE_BY_READING_OUTCOME
} = require('../utils/episodes')

// How long before the appointment the episode is considered to have opened
// (roughly when an invitation would have gone out)
const INVITATION_LEAD_DAYS = 28

// Outcomes for historic (summary-level) episodes. Most past rounds were
// clear; a few were recalled for assessment.
const HISTORIC_OUTCOME_WEIGHTS = {
  routine_recall: 0.94,
  recall_for_assessment: 0.06
}

/**
 * Record a stage change, keeping stageHistory in step
 *
 * @param {object} episode - Episode to advance (mutated - generation only)
 * @param {string} stage - New stage
 * @param {string} timestamp - ISO timestamp for the change
 */
const setStage = (episode, stage, timestamp) => {
  episode.stage = stage
  episode.stageHistory = [...episode.stageHistory, { stage, timestamp }]
}

/**
 * Create an episode for one screening round.
 *
 * Starts at the `scheduled` stage with no events - the caller pushes the
 * event id on as it generates the event.
 *
 * @param {object} options
 * @param {object} options.participant - The participant being screened
 * @param {string} options.type - Risk level driving this round's interval
 * @param {string|Date} options.appointmentDate - When the round's first appointment is
 * @returns {object} Episode record
 */
const generateEpisode = ({ participant, type, appointmentDate }) => {
  const openedDate = dayjs(appointmentDate)
    .subtract(INVITATION_LEAD_DAYS, 'day')
    .toISOString()

  return {
    id: generateId(),
    participantId: participant.id,
    sequence: null, // assigned once all snapshots are generated
    type,
    stage: 'scheduled',
    stageHistory: [{ stage: 'scheduled', timestamp: openedDate }],
    outcome: null,
    openedDate,
    closedDate: null,
    eventIds: [],
    isHistoric: false
  }
}

/**
 * Work out an episode's stage and outcome from the state of its events.
 *
 * Run after reading data has been attached to events. Uses the same maps the
 * app uses at runtime, so seeded episodes sit exactly where a real one would
 * have ended up after the same sequence of events.
 *
 * Derives the whole stage history from scratch each time, so it is safe to
 * call again after an event's reading data changes.
 *
 * @param {object} episode - Episode to finalise (mutated - generation only)
 * @param {Array} events - The episode's events, oldest first
 * @returns {object} The same episode
 */
const finaliseEpisodeStage = (episode, events) => {
  // Back to a freshly opened episode, keeping only the stage it opened at
  episode.stage = 'scheduled'
  episode.stageHistory = episode.stageHistory.slice(0, 1)
  episode.outcome = null
  episode.closedDate = null

  const latestEvent = events[events.length - 1]
  if (!latestEvent) return episode

  const appointmentStarted = latestEvent.timing?.actualStartTime
  const appointmentEnded =
    latestEvent.timing?.actualEndTime || latestEvent.timing?.startTime

  const moveTo = (destination, timestamp) => {
    if (!destination || destination.stage === episode.stage) return

    setStage(episode, destination.stage, timestamp)

    if (destination.stage === 'closed') {
      episode.outcome = destination.outcome ?? null
      episode.closedDate = timestamp
    }
  }

  const destination = EPISODE_STAGE_BY_EVENT_STATUS[latestEvent.status]

  // A screened appointment went through mammograms on its way to reading, so
  // put that stage in the history rather than jumping straight to reading
  if (destination?.stage === 'reading' && appointmentStarted) {
    moveTo({ stage: 'mammograms' }, appointmentStarted)
  }

  moveTo(destination, appointmentEnded)

  // Once the images are taken, it's the reading that decides what happens
  // next - close the episode, or send it back for a technical recall
  if (episode.stage === 'reading') {
    const reads = Object.values(latestEvent.imageReading?.reads || {})
    const lastReadAt = reads
      .map((read) => read.timestamp)
      .sort()
      .pop()

    // Some seed profiles date their reads before the appointment they belong
    // to, so keep the episode's own history moving forwards regardless
    const concludedAt =
      lastReadAt && lastReadAt > appointmentEnded
        ? lastReadAt
        : appointmentEnded

    const destinationAfterReading =
      EPISODE_STAGE_BY_READING_OUTCOME[getOutcome(latestEvent, {})]

    if (destinationAfterReading) {
      moveTo(destinationAfterReading, concludedAt)
    } else if (!eligibleForReading(latestEvent)) {
      // Screened too long ago to still be in the reading queue. That round was
      // read at the time - we just don't seed reads going back that far - so
      // close it rather than leave it sitting in reading forever.
      moveTo(
        { stage: 'closed', outcome: weighted.select(HISTORIC_OUTCOME_WEIGHTS) },
        concludedAt
      )
    }
  }

  return episode
}

/**
 * Generate summary-level episodes for a participant's past screening rounds.
 *
 * These carry no events - just dates, an outcome and enough image metadata
 * to show as priors. Spacing follows the risk level's own screening interval
 * (routine every 3 years, family history / high risk yearly).
 *
 * @param {object} options
 * @param {object} options.participant - The participant
 * @param {string} options.type - Risk level driving the interval
 * @param {string|Date} options.earliestOpenedDate - Opened date of their oldest real episode
 * @param {number} options.count - How many historic episodes to generate
 * @returns {Array} Historic episodes, oldest first
 */
const generateHistoricEpisodes = ({
  participant,
  type,
  earliestOpenedDate,
  count
}) => {
  const riskLevel = riskLevels[type] || riskLevels.routine
  const episodes = []

  for (let round = 1; round <= count; round++) {
    // Step back one interval per round, jittered so dates aren't uniform
    const openedDate = dayjs(earliestOpenedDate)
      .subtract(riskLevel.frequency * round, 'month')
      .add(faker.number.int({ min: -30, max: 30 }), 'day')

    // Don't invent rounds from before the participant was screening age
    const ageAtEpisode = openedDate.diff(
      dayjs(participant.demographicInformation.dateOfBirth),
      'year'
    )
    if (ageAtEpisode < riskLevel.ageRange.lower) break

    // The round ran its course: appointment, images, reading, closed
    const screenedDate = openedDate.add(INVITATION_LEAD_DAYS, 'day')
    const closedDate = screenedDate.add(
      faker.number.int({ min: 7, max: 21 }),
      'day'
    )

    episodes.push({
      id: generateId(),
      participantId: participant.id,
      sequence: null, // assigned with the rest of the participant's episodes
      type,
      stage: 'closed',
      stageHistory: [
        { stage: 'scheduled', timestamp: openedDate.toISOString() },
        { stage: 'mammograms', timestamp: screenedDate.toISOString() },
        { stage: 'reading', timestamp: screenedDate.toISOString() },
        { stage: 'closed', timestamp: closedDate.toISOString() }
      ],
      outcome: weighted.select(HISTORIC_OUTCOME_WEIGHTS),
      openedDate: openedDate.toISOString(),
      closedDate: closedDate.toISOString(),
      eventIds: [],
      isHistoric: true,

      // Enough to list this round as a prior without holding a full image set
      mammogramSummary: {
        takenDate: screenedDate.toISOString(),
        viewCount: 4,
        breastScreeningUnitId: participant.assignedBSU
      }
    })
  }

  // Generated newest-first as we stepped back; return oldest-first
  return episodes.reverse()
}

/**
 * Sanity-check the generated episodes and warn loudly about anything
 * incoherent. Cheap insurance: these are the assumptions the rest of the app
 * is entitled to make about an episode, so a breach means seed data that
 * can't happen in real life.
 *
 * Warns rather than throws - never break a demo over seed data.
 *
 * @param {Array} episodes - All episodes
 * @param {Map} eventsById - All events, keyed by id
 * @returns {Array} The problems found, one string each
 */
const checkEpisodes = (episodes, eventsById) => {
  const problems = []

  episodes.forEach((episode) => {
    const events = episode.eventIds
      .map((eventId) => eventsById.get(eventId))
      .filter(Boolean)

    // A past round is over, by definition
    if (episode.isHistoric) {
      if (episode.stage !== 'closed' || !episode.outcome) {
        problems.push(`historic episode ${episode.id} is not closed`)
      }
      if (episode.eventIds.length) {
        problems.push(`historic episode ${episode.id} has events`)
      }
      return
    }

    if (!events.length) {
      problems.push(`episode ${episode.id} has no events`)
      return
    }

    // Reading needs images: an episode can only be in reading off the back of
    // a completed mammogram appointment, and only while it is still open
    if (episode.stage === 'reading') {
      if (!events.some((event) => isCompleted(event.status))) {
        problems.push(
          `episode ${episode.id} is in reading with no completed appointment`
        )
      }
      if (!events.some((event) => eligibleForReading(event))) {
        problems.push(
          `episode ${episode.id} is in reading but no appointment is eligible for reading`
        )
      }
      if (episode.outcome) {
        problems.push(`episode ${episode.id} is in reading but has an outcome`)
      }
    }

    if (episode.stage === 'closed' && !episode.closedDate) {
      problems.push(`episode ${episode.id} is closed with no closedDate`)
    }

    if (episode.stage !== 'closed' && episode.outcome) {
      problems.push(`open episode ${episode.id} has an outcome`)
    }
  })

  return problems
}

module.exports = {
  generateEpisode,
  generateHistoricEpisodes,
  finaliseEpisodeStage,
  checkEpisodes
}
