// app/lib/generators/episode-generator.js
//
// An episode is one screening round for a participant - the container the
// appointment(s), and later the reading, hang off. See
// docs/data-conventions.md.
//
// Episodes are generated *first*, in the clinic-day loop: an episode is
// created, then the appointment that sits inside it. Its stage and outcome can't be
// settled there, because they depend on reading data - which is attached to
// appointments by generateReadingData, the very last generation pass. So
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
  EPISODE_STAGE_BY_APPOINTMENT_STATUS,
  EPISODE_STAGE_BY_READING_OUTCOME,
  appointmentProducedImages,
  buildMammogramEntry
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
 * Starts at the `scheduled` stage with no appointments - the caller pushes the
 * appointment id on as it generates the appointment.
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
    appointmentIds: [],
    mammograms: [],
    isHistoric: false
  }
}

/**
 * Work out an episode's stage and outcome from the state of its appointments.
 *
 * Run after reading data has been attached to appointments. Uses the same maps the
 * app uses at runtime, so seeded episodes sit exactly where a real one would
 * have ended up after the same sequence of appointments.
 *
 * Derives the whole stage history from scratch each time, so it is safe to
 * call again after an appointment's reading data changes.
 *
 * @param {object} episode - Episode to finalise (mutated - generation only)
 * @param {Array} appointments - The episode's appointments, oldest first
 * @param {Map} [clinicsById] - Clinics keyed by id, for where images were taken
 * @returns {object} The same episode
 */
const finaliseEpisodeStage = (episode, appointments, clinicsById = new Map()) => {
  // Back to a freshly opened episode, keeping only the stage it opened at
  episode.stage = 'scheduled'
  episode.stageHistory = episode.stageHistory.slice(0, 1)
  episode.outcome = null
  episode.closedDate = null

  // The round's record of images taken is derived from the appointments alongside
  // the stage, so a re-run refreshes both together
  episode.mammograms = appointments
    .filter(appointmentProducedImages)
    .map((appointment) =>
      buildMammogramEntry(appointment, clinicsById.get(appointment.clinicId))
    )

  const latestAppointment = appointments[appointments.length - 1]
  if (!latestAppointment) return episode

  const appointmentStarted = latestAppointment.timing?.actualStartTime
  const appointmentEnded =
    latestAppointment.timing?.actualEndTime || latestAppointment.timing?.startTime

  const moveTo = (destination, timestamp) => {
    if (!destination || destination.stage === episode.stage) return

    setStage(episode, destination.stage, timestamp)

    if (destination.stage === 'closed') {
      episode.outcome = destination.outcome ?? null
      episode.closedDate = timestamp
    }
  }

  const destination = EPISODE_STAGE_BY_APPOINTMENT_STATUS[latestAppointment.status]

  // A screened appointment went through mammograms on its way to reading, so
  // put that stage in the history rather than jumping straight to reading
  if (destination?.stage === 'reading' && appointmentStarted) {
    moveTo({ stage: 'mammograms' }, appointmentStarted)
  }

  moveTo(destination, appointmentEnded)

  // Once the images are taken, it's the reading that decides what happens
  // next - close the episode, or send it back for a technical recall
  if (episode.stage === 'reading') {
    const reads = Object.values(latestAppointment.imageReading?.reads || {})
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
      EPISODE_STAGE_BY_READING_OUTCOME[getOutcome(latestAppointment, {})]

    if (destinationAfterReading) {
      moveTo(destinationAfterReading, concludedAt)
    } else if (!eligibleForReading(latestAppointment)) {
      // Screened too long ago to still be in the reading queue. That round was
      // read at the time - we just don't seed reads going back that far - so
      // close it rather than leave it sitting in reading forever.
      moveTo({ stage: 'closed', outcome: 'routine_recall' }, concludedAt)
    }
  }

  // An episode recalled for assessment sits in assessment until the assessment
  // concludes. Recent ones genuinely haven't concluded yet, so they stay open.
  // Older ones would have by now, and assessment is what produces the result.
  if (episode.stage === 'assessment' && !eligibleForReading(latestAppointment)) {
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
      appointmentIds: [],
      isHistoric: true,

      // Enough to list this round as a prior without holding a full image
      // set. Same entry shape as a round screened here, minus the
      // appointment link and site detail a summary round doesn't hold
      mammograms: wasScreened
        ? [
            {
              takenDate: screenedDate.toISOString(),
              appointmentId: null,
              breastScreeningUnitId: participant.assignedBSU,
              locationId: null,
              viewCount: 4
            }
          ]
        : []
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
 * @param {Map} appointmentsById - All appointments, keyed by id
 * @returns {Array} The problems found, one string each
 */
const checkEpisodes = (episodes, appointmentsById) => {
  const problems = []

  episodes.forEach((episode) => {
    const appointments = episode.appointmentIds
      .map((appointmentId) => appointmentsById.get(appointmentId))
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
      if (episode.appointmentIds.length) {
        problems.push(`historic episode ${episode.id} has appointments`)
      }
      // A summary round has images exactly when it has a result
      const wasScreened = episode.outcome !== 'no_result'
      if (wasScreened !== Boolean(episode.mammograms?.length)) {
        problems.push(
          `historic episode ${episode.id} outcome and mammograms disagree`
        )
      }
      return
    }

    if (!appointments.length) {
      problems.push(`episode ${episode.id} has no appointments`)
      return
    }

    // The episode's own record of images must match what its appointments
    // say - one entry per appointment that reached a screened status
    const screenedAppointmentIds = appointments
      .filter(appointmentProducedImages)
      .map((appointment) => appointment.id)
    const recordedAppointmentIds = (episode.mammograms || []).map(
      (entry) => entry.appointmentId
    )
    if (
      screenedAppointmentIds.length !== recordedAppointmentIds.length ||
      screenedAppointmentIds.some((appointmentId) => !recordedAppointmentIds.includes(appointmentId))
    ) {
      problems.push(
        `episode ${episode.id} mammograms don't match its screened appointments`
      )
    }

    // Reading needs images: an episode can only be in reading off the back of
    // a completed mammogram appointment that is still within the reading window
    if (episode.stage === 'reading') {
      if (!appointments.some((appointment) => isCompleted(appointment.status))) {
        problems.push(
          `episode ${episode.id} is in reading with no completed appointment`
        )
      }
      if (!appointments.some((appointment) => eligibleForReading(appointment))) {
        problems.push(
          `episode ${episode.id} is in reading but no appointment is eligible for reading`
        )
      }
    }

    // Assessment only follows a reading that recalled them
    if (episode.stage === 'assessment') {
      if (!appointments.some((appointment) => isCompleted(appointment.status))) {
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
