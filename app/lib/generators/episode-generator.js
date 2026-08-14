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
const {
  generateMedicalInformation
} = require('./medical-information-generator')
const {
  buildReadingCase,
  getLatestReadingCase,
  getReadingCaseOutcome,
  getReadsAsArray
} = require('../utils/reading-cases')
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

// How often a past round that ended in routine recall got there via assessment
// rather than straight from a clear reading. Most clear rounds were simply read
// as normal; a minority were recalled and then found to be clear. Without this
// every historic recall would have ended in treatment, which is the opposite of
// how screening actually goes.
const HISTORIC_RECALLED_THEN_CLEAR_PROBABILITY = 0.06

// How often a past round's two readers disagreed and it went to arbitration.
// A few percent of cases is the right order for real screening - the point of
// seeding any is that arbitration work has past examples to look at, not only
// cases created by hand.
const HISTORIC_ARBITRATION_PROBABILITY = 0.04

/**
 * Build the stand-in appointment for a past round.
 *
 * A past round has no appointment record - reviving one in full is what the
 * episodes work deliberately dropped, because a whole historic clinic snapshot
 * cost far more than it was worth. This is the fidelity tier in between: enough
 * to show what an appointment that day looked like, held on the episode rather
 * than in `data.appointments`, so it can never drift into a clinic list, a
 * reading queue or a route that expects a real appointment.
 *
 * Where and when the round was screened already lives in `episode.mammograms`;
 * what this adds is the appointment's own detail - its status, and the medical
 * information recorded at it.
 *
 * Held as a list, like the episode's other per-appointment records, so a past
 * round is shaped the same as a live one. Only one is generated today; a past
 * technical recall would have had two.
 *
 * @param {object} options
 * @param {object} options.screenedDate - When the images were taken (dayjs)
 * @param {object} [options.seedProfile] - Active seed profile
 * @returns {object} The summary appointment
 */
const buildHistoricSummaryAppointment = ({ screenedDate, seedProfile }) => {
  const medicalInformation = generateMedicalInformation({
    ...(seedProfile?.medicalInformation || {})
  })

  return {
    id: generateId(),
    // A past round was screened - that is why it has images and a reading. The
    // status is carried explicitly so the episode page can show an appointments
    // list the same way a live round does.
    status: 'complete',
    type: 'screening',
    startTime: screenedDate.toISOString(),
    medicalInformation: stampRecordedDates(medicalInformation, screenedDate)
  }
}

/**
 * Re-date everything in a generated medical information record to when it was
 * actually recorded.
 *
 * The medical information generators stamp `dateAdded` with the current time,
 * which is right for a live appointment and wrong for a past round - it would
 * show a symptom from 2023 as having been recorded today. Rewriting them here
 * keeps that fix to historic generation, rather than threading a date through
 * every generator that the live flow also uses.
 *
 * Walks the whole structure rather than naming fields, so it keeps working as
 * the medical information shape grows.
 *
 * @param {*} value - Generated medical information, or part of it
 * @param {object} recordedDate - When the round was screened (dayjs)
 * @returns {*} The same shape, with recorded dates moved back
 */
const stampRecordedDates = (value, recordedDate) => {
  if (Array.isArray(value)) {
    return value.map((item) => stampRecordedDates(item, recordedDate))
  }

  if (!value || typeof value !== 'object') return value

  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      key === 'dateAdded'
        ? recordedDate.toISOString()
        : stampRecordedDates(item, recordedDate)
    ])
  )
}

/**
 * Build the summary reading case for a past round.
 *
 * Past rounds are seeded outcome-first, so the reads are chosen to be
 * consistent with the outcome already picked rather than the other way round:
 * a round that ended in treatment must have been recalled for assessment, and a
 * clear round was usually - though not always - read as normal.
 *
 * Deliberately lean. There is no appointment behind a past round, so no image
 * set for annotations to point at; what a past round can honestly say is who
 * read it, when, and what they concluded.
 *
 * @param {object} options
 * @param {string} options.outcome - The round's episode outcome
 * @param {object} options.screenedDate - When the images were taken (dayjs)
 * @param {object} options.closedDate - When the round closed (dayjs)
 * @param {Array} options.readers - Users available to have read it
 * @returns {object | null} The reading case, or null if the round wasn't screened
 */
const buildHistoricReadingCase = ({
  outcome,
  screenedDate,
  closedDate,
  readers
}) => {
  if (outcome === 'no_result' || readers.length < 2) return null

  // A round ending in treatment was recalled for assessment; a clear round
  // usually wasn't, but sometimes was and the assessment found nothing
  const wasRecalled =
    outcome === 'refer_for_treatment' ||
    Math.random() < HISTORIC_RECALLED_THEN_CLEAR_PROBABILITY

  // What the round concluded at reading - the arbitration read where there was
  // one, otherwise what both readers agreed
  const opinion = wasRecalled ? 'recall_for_assessment' : 'normal'

  // Sometimes the two readers disagreed and a third settled it. Needs three
  // readers: nobody reads the same case twice, arbitration included
  const wentToArbitration =
    readers.length >= 3 && Math.random() < HISTORIC_ARBITRATION_PROBABILITY

  const [firstReader, secondReader, arbitrationReader] =
    faker.helpers.arrayElements(readers, wentToArbitration ? 3 : 2)

  // Read in the window between the images being taken and the round closing
  const firstReadAt = screenedDate.add(
    faker.number.int({ min: 1, max: 4 }),
    'day'
  )
  const secondReadAt = firstReadAt.add(
    faker.number.int({ min: 0, max: 2 }),
    'day'
  )
  const cappedSecondReadAt = secondReadAt.isAfter(closedDate)
    ? closedDate
    : secondReadAt

  const buildSummaryRead = (reader, readType, readNumber, timestamp, readOpinion) => ({
    opinion: readOpinion,
    readerId: reader.id,
    readerType: reader.role,
    readType,
    readNumber,
    timestamp: timestamp.toISOString(),
    // A settled past round's reads were finalised at the time
    finalisedAt: timestamp.add(30, 'minute').toISOString(),
    finalisedBy: reader.id
  })

  // When it went to arbitration the two readers disagreed, so one of them said
  // the opposite of what the round concluded. Which one is arbitrary - either
  // reader could have been the one who saw something
  const disagreeingOpinion =
    opinion === 'normal' ? 'recall_for_assessment' : 'normal'
  const firstReaderDisagreed = wentToArbitration && Math.random() < 0.5

  const reads = [
    buildSummaryRead(
      firstReader,
      'first',
      1,
      firstReadAt,
      firstReaderDisagreed ? disagreeingOpinion : opinion
    ),
    buildSummaryRead(
      secondReader,
      'second',
      2,
      cappedSecondReadAt,
      wentToArbitration && !firstReaderDisagreed ? disagreeingOpinion : opinion
    )
  ]

  if (wentToArbitration) {
    // The arbitration read is what settled it, so it carries the round's
    // conclusion - and dates after the two it was called in to resolve
    const arbitratedAt = cappedSecondReadAt.add(
      faker.number.int({ min: 1, max: 3 }),
      'day'
    )
    reads.push(
      buildSummaryRead(
        arbitrationReader,
        'arbitration',
        3,
        arbitratedAt.isAfter(closedDate) ? closedDate : arbitratedAt,
        opinion
      )
    )
  }

  return {
    id: generateId(),
    // A past round has no appointment record for the case to hang off - the
    // same reason its mammogram entry carries no appointmentId
    appointmentId: null,
    openedDate: screenedDate.toISOString(),
    reads
  }
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
    readingCases: [],
    isHistoric: false
  }
}

/**
 * Open a reading case for each set of images the episode's appointments
 * produced, keeping any case that already exists.
 *
 * Runs before reading data is generated, because reads are written onto cases -
 * there has to be a case to write to. Existing cases are kept rather than
 * rebuilt so re-running never throws away reads.
 *
 * @param {object} episode - Episode to sync (mutated - generation only)
 * @param {Array} appointments - The episode's appointments, oldest first
 * @returns {object} The same episode
 */
const syncEpisodeReadingCases = (episode, appointments) => {
  const existingByAppointmentId = new Map(
    (episode.readingCases || []).map((readingCase) => [
      readingCase.appointmentId,
      readingCase
    ])
  )

  episode.readingCases = appointments
    .filter(appointmentProducedImages)
    .map(
      (appointment) =>
        existingByAppointmentId.get(appointment.id) ||
        buildReadingCase(appointment)
    )

  return episode
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
  // the stage, so a re-run refreshes both together. Its reading cases follow the
  // same image sets, and keep any reads already written to them
  episode.mammograms = appointments
    .filter(appointmentProducedImages)
    .map((appointment) =>
      buildMammogramEntry(appointment, clinicsById.get(appointment.clinicId))
    )
  syncEpisodeReadingCases(episode, appointments)

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
  // next - close the episode, or send it back for a technical recall. The
  // *latest* case decides: a technical recall's re-screen supersedes the
  // reading that asked for it
  if (episode.stage === 'reading') {
    const latestCase = getLatestReadingCase(episode)
    const lastReadAt = getReadsAsArray(latestCase)
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
      EPISODE_STAGE_BY_READING_OUTCOME[getReadingCaseOutcome(latestCase, {})]

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
 * Outcome-first: each round says what it found, and the detail beneath it is
 * chosen to be consistent with that - not the other way round. A past round
 * holds no appointment and no assessment detail, but it does carry a summary
 * reading case, so "who read this and what did they say" is answerable for
 * every round rather than only the current one.
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
 * @param {Array} [options.readers] - Users who could have read these rounds
 * @param {object} [options.seedProfile] - Active seed profile
 * @returns {Array} Historic episodes, oldest first
 */
const generateHistoricEpisodes = ({
  participant,
  type,
  earliestOpenedDate,
  max,
  outcomeWeights,
  readers = [],
  seedProfile
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

    const readingCase = buildHistoricReadingCase({
      outcome,
      screenedDate,
      closedDate,
      readers
    })

    // A round that produced no images had no screening appointment worth
    // standing in for either
    const summaryAppointments = wasScreened
      ? [buildHistoricSummaryAppointment({ screenedDate, seedProfile })]
      : []

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
      readingCases: readingCase ? [readingCase] : [],
      summaryAppointments,
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
      // A screened past round has a stand-in appointment; one that produced no
      // images was never screened, so has none
      const summaryAppointments = episode.summaryAppointments || []
      if (wasScreened !== (summaryAppointments.length > 0)) {
        problems.push(
          `historic episode ${episode.id} summary appointments and outcome disagree`
        )
      }

      // A screened past round carries exactly one summary reading case, and a
      // round that produced no images has nothing to read
      const historicCases = episode.readingCases || []
      if (wasScreened !== (historicCases.length === 1)) {
        problems.push(
          `historic episode ${episode.id} should have exactly one reading case when screened`
        )
      }

      historicCases.forEach((readingCase) => {
        // No appointment record exists behind a past round
        if (readingCase.appointmentId) {
          problems.push(
            `historic reading case ${readingCase.id} references an appointment`
          )
        }
        // The reads have to agree with the outcome the round was seeded with:
        // a round ending in treatment must have been recalled for assessment
        const readingOutcome = getReadingCaseOutcome(readingCase, {})
        if (
          episode.outcome === 'refer_for_treatment' &&
          readingOutcome !== 'recall_for_assessment'
        ) {
          problems.push(
            `historic episode ${episode.id} ended in treatment but was read as "${readingOutcome}"`
          )
        }
        // A settled past round's reads were all finalised at the time
        getReadsAsArray(readingCase).forEach((read) => {
          if (!read.finalisedAt) {
            problems.push(
              `historic reading case ${readingCase.id} has an unfinalised read`
            )
          }
        })
        // Two readers, or three where they disagreed and one arbitrated
        const historicReadCount = getReadsAsArray(readingCase).length
        if (historicReadCount !== 2 && historicReadCount !== 3) {
          problems.push(
            `historic reading case ${readingCase.id} has ${historicReadCount} reads`
          )
        }
      })
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

    // One reading case per image set, and none without images to read: the two
    // records answer the same question from different sides, so they must agree
    const caseAppointmentIds = (episode.readingCases || []).map(
      (readingCase) => readingCase.appointmentId
    )
    if (
      screenedAppointmentIds.length !== caseAppointmentIds.length ||
      screenedAppointmentIds.some(
        (appointmentId) => !caseAppointmentIds.includes(appointmentId)
      )
    ) {
      problems.push(
        `episode ${episode.id} reading cases don't match its screened appointments`
      )
    }

    // A case is read at most twice until arbitration, and an arbitration read
    // only makes sense once two reads have disagreed
    ;(episode.readingCases || []).forEach((readingCase) => {
      const reads = getReadsAsArray(readingCase)
      const arbitrationReads = reads.filter(
        (read) => read.readType === 'arbitration'
      )

      if (reads.length > 3) {
        problems.push(
          `reading case ${readingCase.id} has ${reads.length} reads`
        )
      }
      if (arbitrationReads.length > 1) {
        problems.push(
          `reading case ${readingCase.id} has more than one arbitration read`
        )
      }
      if (arbitrationReads.length && reads.length < 3) {
        problems.push(
          `reading case ${readingCase.id} has an arbitration read without two prior reads`
        )
      }
      // Finalisation coherence: a finalisation is one act with two halves,
      // and nothing finalises a read before it was made
      reads.forEach((read) => {
        if (Boolean(read.finalisedAt) !== Boolean(read.finalisedBy)) {
          problems.push(
            `read by ${read.readerId} on case ${readingCase.id} has half a finalisation record`
          )
        }
        if (read.finalisedAt && read.finalisedAt < read.timestamp) {
          problems.push(
            `read by ${read.readerId} on case ${readingCase.id} was finalised before it was read`
          )
        }
      })
      // Nobody reads a case twice. An arbitration read is the group's rather
      // than one reader's, so it is exempt - its authors may include the
      // original readers.
      const readerIds = reads
        .filter((read) => read.readType !== 'arbitration')
        .map((read) => read.readerId)
      if (new Set(readerIds).size !== readerIds.length) {
        problems.push(
          `reading case ${readingCase.id} has the same reader twice`
        )
      }
    })

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
  syncEpisodeReadingCases,
  finaliseEpisodeStage,
  checkEpisodes
}
