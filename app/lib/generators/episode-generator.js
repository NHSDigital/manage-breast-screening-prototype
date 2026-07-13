// app/lib/generators/episode-generator.js
//
// An episode is one screening round for a participant - the container the
// appointment(s), and later the reading, hang off. See
// docs/data-conventions.md.
//
// Episodes are generated *first*, in the clinic-day loop: an episode is
// created, then the event that sits inside it. Its stage and outcome can't be
// settled there, because they depend on reading data - which is attached to
// events by generateReadingData, the very last generation pass. So
// finaliseEpisodeStage runs afterwards.

const dayjs = require('dayjs')
const weighted = require('weighted')
const { faker } = require('@faker-js/faker')
const generateId = require('../utils/id-generator')
const riskLevels = require('../../data/risk-levels')
const { getOutcome } = require('../utils/reading')
const { eligibleForReading, isCompleted } = require('../utils/status')
const {
  EPISODE_OUTCOMES,
  EPISODE_STAGE_BY_EVENT_STATUS,
  EPISODE_STAGE_BY_READING_OUTCOME
} = require('../utils/episodes')

// How long before the appointment the episode is considered to have opened
// (roughly when an invitation would have gone out)
const INVITATION_LEAD_DAYS = 28

// Outcomes for historic (summary-level) rounds. Chosen outcome-first: we say
// what the round found and don't model how it got there. Mostly clear; a few
// found something and went into treatment (they return to screening
// afterwards, which is why they are here at all); a few never produced a
// result because the participant didn't attend.
//
// Overridable per seed profile via `episodes.historicOutcomeWeights`, though
// most testing needs vary reading and assessment rather than history.
const HISTORIC_OUTCOME_WEIGHTS = {
  routine_recall: 0.9,
  refer_for_treatment: 0.03,
  no_result: 0.07
}

// What an assessment concluded, for rounds old enough to have had one. Not
// every recall finds cancer - most turn out clear.
const ASSESSMENT_OUTCOME_WEIGHTS = {
  routine_recall: 0.8,
  refer_for_treatment: 0.2
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
      moveTo({ stage: 'closed', outcome: 'routine_recall' }, concludedAt)
    }
  }

  // An episode recalled for assessment sits in assessment until the assessment
  // concludes. Recent ones genuinely haven't concluded yet, so they stay open.
  // Older ones would have by now, and assessment is what produces the result.
  if (episode.stage === 'assessment' && !eligibleForReading(latestEvent)) {
    moveTo(
      {
        stage: 'closed',
        outcome: weighted.select(ASSESSMENT_OUTCOME_WEIGHTS)
      },
      appointmentEnded
    )
  }

  return episode
}

/**
 * How many past rounds a participant plausibly has, from their age and their
 * screening interval.
 *
 * Screening starts at the risk level's lower age bound, so someone only just
 * old enough has no history at all, and someone near the upper bound has a
 * round for each interval since. A routine participant aged 51 has none; at
 * 54, one; at 68, six.
 *
 * @param {object} participant - The participant
 * @param {object} riskLevel - Their risk level from data/risk-levels
 * @param {string|Date} firstEpisodeDate - When their earliest real round opened
 * @param {number} max - Cap, to bound how much history we hold
 * @returns {number} Number of historic episodes to generate
 */
const countHistoricEpisodes = (
  participant,
  riskLevel,
  firstEpisodeDate,
  max
) => {
  const ageAtFirstEpisode = dayjs(firstEpisodeDate).diff(
    dayjs(participant.demographicInformation.dateOfBirth),
    'year'
  )

  const yearsScreening = ageAtFirstEpisode - riskLevel.ageRange.lower
  if (yearsScreening <= 0) return 0

  const intervalYears = riskLevel.frequency / 12
  const rounds = Math.floor(yearsScreening / intervalYears)

  return Math.min(rounds, max)
}

/**
 * Generate summary-level episodes for a participant's past screening rounds.
 *
 * Outcome-first: each round says what it found, and we don't model how it got
 * there - no appointments, no reads, no assessment detail. That is enough for
 * every "what happened before" view, and cheap to hold. If we later model the
 * steps, the outcome can be computed from them instead.
 *
 * Spacing follows the risk level's own screening interval (routine every 3
 * years, family history / high risk yearly).
 *
 * @param {object} options
 * @param {object} options.participant - The participant
 * @param {string} options.type - Risk level driving the interval
 * @param {string|Date} options.earliestOpenedDate - Opened date of their oldest real episode
 * @param {number} options.max - Cap on how many to generate
 * @param {object} [options.outcomeWeights] - Override the default outcome mix
 * @returns {Array} Historic episodes, oldest first
 */
const generateHistoricEpisodes = ({
  participant,
  type,
  earliestOpenedDate,
  max,
  outcomeWeights
}) => {
  const riskLevel = riskLevels[type] || riskLevels.routine
  const weights = outcomeWeights || HISTORIC_OUTCOME_WEIGHTS

  const count = countHistoricEpisodes(
    participant,
    riskLevel,
    earliestOpenedDate,
    max
  )

  const episodes = []

  for (let round = 1; round <= count; round++) {
    // Step back one interval per round, jittered so dates aren't uniform
    const openedDate = dayjs(earliestOpenedDate)
      .subtract(riskLevel.frequency * round, 'month')
      .add(faker.number.int({ min: -30, max: 30 }), 'day')

    // The round ran its course: appointment, images, reading, closed
    const screenedDate = openedDate.add(INVITATION_LEAD_DAYS, 'day')
    const closedDate = screenedDate.add(
      faker.number.int({ min: 7, max: 21 }),
      'day'
    )

    const outcome = weighted.select(weights)

    // A round with no result never produced images either
    const wasScreened = outcome !== 'no_result'

    episodes.push({
      id: generateId(),
      participantId: participant.id,
      type,
      stage: 'closed',

      // Just that it opened and closed. We seed the outcome, not the steps -
      // inventing timestamps for stages we never modelled would be fiction
      // dressed up as an audit trail.
      stageHistory: [
        { stage: 'scheduled', timestamp: openedDate.toISOString() },
        { stage: 'closed', timestamp: closedDate.toISOString() }
      ],
      outcome,
      openedDate: openedDate.toISOString(),
      closedDate: closedDate.toISOString(),
      eventIds: [],
      isHistoric: true,

      // Enough to list this round as a prior without holding a full image set
      mammogramSummary: wasScreened
        ? {
            takenDate: screenedDate.toISOString(),
            viewCount: 4,
            breastScreeningUnitId: participant.assignedBSU
          }
        : null
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

    // Open or closed, and each has its own rules
    if (episode.stage === 'closed') {
      if (!episode.closedDate) {
        problems.push(`closed episode ${episode.id} has no closedDate`)
      }
      if (!EPISODE_OUTCOMES.includes(episode.outcome)) {
        problems.push(
          `closed episode ${episode.id} has outcome "${episode.outcome}"`
        )
      }
    } else if (episode.outcome) {
      problems.push(`open episode ${episode.id} has an outcome`)
    }

    // A past round is over, by definition, and carries no detail of how it got
    // there - it is seeded outcome-first
    if (episode.isHistoric) {
      if (episode.stage !== 'closed') {
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
    // a completed mammogram appointment that is still within the reading window
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
    }

    // Assessment only follows a reading that recalled them
    if (episode.stage === 'assessment') {
      if (!events.some((event) => isCompleted(event.status))) {
        problems.push(
          `episode ${episode.id} is in assessment with no completed appointment`
        )
      }
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
