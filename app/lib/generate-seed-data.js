// app/lib/generate-seed-data.js

// to run: node app/lib/generate-seed-data.js
// can also be run from ui at localhost:3000/settings

const dayjs = require('dayjs')
const fs = require('fs')
const path = require('path')
const config = require('../config')
const weighted = require('weighted')

const { generateParticipant } = require('./generators/participant-generator')
const { generateClinicsForBSU } = require('./generators/clinic-generator')
const { generateEvent } = require('./generators/event-generator')
const {
  generateEpisode,
  generateHistoricEpisodes,
  finaliseEpisodeStage,
  checkEpisodes
} = require('./generators/episode-generator')
const { getCurrentRiskLevel } = require('./utils/participants')
const {
  generateReadingData,
  generateSingleRead
} = require('./generators/reading-generator')
const { getSeedDataProfile } = require('./generators/seed-profiles')
const { getOutcome } = require('./utils/reading')

const riskLevels = require('../data/risk-levels')

// Load existing data
const breastScreeningUnits = require('../data/breast-screening-units')
const ethnicities = require('../data/ethnicities')
const users = require('../data/users')

// Hardcoded scenarios for user research
const testScenarios = require('../data/test-scenarios')

// Index the age-eligible participants by risk level, so filling a clinic slot
// is a lookup rather than a scan
const createParticipantIndices = (participants, clinicDate) => {
  const riskLevelIndex = {}

  participants.forEach((participant) => {
    const riskLevel = getCurrentRiskLevel(participant, clinicDate.toDate())

    const age = dayjs(clinicDate).diff(
      dayjs(participant.demographicInformation.dateOfBirth),
      'year'
    )

    const ageRange = riskLevels[riskLevel].ageRange
    if (age >= ageRange.lower && age <= ageRange.upper) {
      riskLevelIndex[riskLevel] = riskLevelIndex[riskLevel] || []
      riskLevelIndex[riskLevel].push(participant)
    }
  })

  return { riskLevelIndex }
}

// Find nearest slot at or after the target time
// Used by test scenarios so we can populate a slot at a given time
const findNearestSlot = (slots, targetTime) => {
  if (!targetTime) return null

  const [targetHour, targetMinute] = targetTime.split(':').map(Number)
  const targetMinutes = targetHour * 60 + targetMinute

  // Filter to only slots at or after target time
  const eligibleSlots = slots.filter((slot) => {
    const slotTime = dayjs(slot.dateTime)
    const slotMinutes = slotTime.hour() * 60 + slotTime.minute()
    return slotMinutes >= targetMinutes
  })

  if (eligibleSlots.length === 0) return null

  // Find the nearest from eligible slots
  return eligibleSlots.reduce((nearest, slot) => {
    const slotTime = dayjs(slot.dateTime)
    const slotMinutes = slotTime.hour() * 60 + slotTime.minute()

    if (!nearest) return slot

    const currentDiff = Math.abs(targetMinutes - slotMinutes)
    const nearestDiff = Math.abs(
      targetMinutes -
        (dayjs(nearest.dateTime).hour() * 60 + dayjs(nearest.dateTime).minute())
    )

    return currentDiff < nearestDiff ? slot : nearest
  })
}

const generateClinicsForDay = (
  date,
  allParticipants,
  unit,
  usedParticipantsInPeriod,
  indices,
  testScenarioParticipantIds = new Set(),
  seedDataProfile
) => {
  const clinics = []
  const events = []
  const episodes = []
  const participants = [...allParticipants]

  // Every event sits inside an episode - the screening round it belongs to.
  // Create the episode first, then the event, and link them both ways.
  const addEventToNewEpisode = (participant, eventOptions) => {
    const episode = generateEpisode({
      participant,
      type: getCurrentRiskLevel(participant, dayjs(date).toDate()),
      appointmentDate: eventOptions.slot.dateTime
    })

    const event = generateEvent({ ...eventOptions, episodeId: episode.id })
    episode.eventIds.push(event.id)

    episodes.push(episode)
    events.push(event)
    return event
  }

  // Check if this is today - we want one in-progress event for today only
  const isToday = dayjs(date).isSame(dayjs(), 'day')

  const testScenariosForDay = testScenarios.filter((scenario) => {
    const targetDate = dayjs()
      .startOf('day')
      .add(scenario.participant.config.scheduling.whenRelativeToToday, 'day')

    return targetDate.isSame(dayjs(date).startOf('day'), 'day')
  })

  // Pre-filter eligible participants once
  const clinicDate = dayjs(date)

  // Generate clinics for this day
  const newClinics = generateClinicsForBSU({
    date: date.toDate(),
    breastScreeningUnit: unit
  })

  // Track if we've created an in-progress event for today
  let hasCreatedInProgressEvent = false

  // For test scenarios, only use first clinic of the day
  if (testScenariosForDay.length > 0 && newClinics.length > 0) {
    const firstClinic = newClinics[0]

    testScenariosForDay.forEach((scenario) => {
      const participant = participants.find(
        (p) => p.id === scenario.participant.id
      )
      if (!participant) return

      const slot =
        scenario.participant.config.scheduling.slotIndex !== undefined
          ? firstClinic.slots[scenario.participant.config.scheduling.slotIndex]
          : findNearestSlot(
              firstClinic.slots,
              scenario.participant.config.scheduling.approximateTime
            )

      if (!slot) {
        console.log(
          `Warning: Could not find suitable slot for test participant ${participant.id}`
        )
        return
      }

      addEventToNewEpisode(participant, {
        slot,
        participant,
        clinic: firstClinic,
        id: scenario?.participant?.config?.eventId,
        outcomeWeights: config.screening.outcomes[firstClinic.clinicType],
        forceStatus: scenario.participant.config.scheduling.status,
        specialAppointmentOverride:
          scenario?.participant?.config?.specialAppointment,
        seedDataProfile
      })

      usedParticipantsInPeriod.add(participant.id)
    })
  }

  // Handle regular clinic slot allocation for all clinics
  newClinics.forEach((clinic) => {
    const remainingSlots = clinic.slots
      .filter(() => Math.random() < config.generation.bookingProbability)
      .filter((slot) => !events.some((e) => e.slotId === slot.id))

    remainingSlots.forEach((slot) => {
      // Pick risk level based on clinic's supported levels
      const availableRiskLevels = clinic.riskLevels

      const selectedRiskLevel = weighted.select(
        Object.fromEntries(
          availableRiskLevels.map((level) => [level, riskLevels[level].weight])
        )
      )

      // Get available participants of selected risk level
      // EXCLUDE test scenario participants from random selection
      const availableParticipants = indices.riskLevelIndex[
        selectedRiskLevel
      ].filter(
        (participant) =>
          !usedParticipantsInPeriod.has(participant.id) &&
          !testScenarioParticipantIds.has(participant.id)
      )

      if (availableParticipants.length === 0) {
        const newParticipant = generateParticipant({
          ethnicities,
          breastScreeningUnits: [unit],
          riskLevel: selectedRiskLevel
        })
        participants.push(newParticipant)
        availableParticipants.push(newParticipant)
      }

      for (let i = 0; i < slot.capacity; i++) {
        if (availableParticipants.length === 0) break
        const randomIndex = Math.floor(
          Math.random() * availableParticipants.length
        )
        const participant = availableParticipants[randomIndex]

        // For today, create one in-progress event (first participant in first available slot)
        const shouldBeInProgress =
          isToday && !hasCreatedInProgressEvent && i === 0

        addEventToNewEpisode(participant, {
          slot,
          participant,
          clinic,
          outcomeWeights: config.screening.outcomes[clinic.clinicType],
          forceInProgress: shouldBeInProgress,
          seedDataProfile
        })

        if (shouldBeInProgress) {
          hasCreatedInProgressEvent = true
          console.log(
            `Created in-progress event for participant ${participant.demographicInformation.firstName} ${participant.demographicInformation.lastName}`
          )
        }

        usedParticipantsInPeriod.add(participant.id)
        availableParticipants.splice(randomIndex, 1)
      }
    })

    clinics.push(clinic)
  })

  return {
    clinics,
    events,
    episodes,
    newParticipants: participants.slice(allParticipants.length)
  }
}
// Generate array of dates for a snapshot period
const generateSnapshotPeriod = (startDate, numberOfDays) => {
  return Array.from({ length: numberOfDays }, (_, i) =>
    dayjs(startDate).add(i, 'days')
  )
}

/**
 * Give participants who have a real episode their past screening rounds, as
 * summary-level records.
 *
 * How many they get follows from their age and screening interval, so someone
 * only just old enough has none. Only participants with events get history -
 * the rest are unreachable in the app, so history for them is payload nobody
 * sees.
 *
 * @param {Array} episodes - The generated (real) episodes
 * @param {Array} participants - All participants
 * @param {object} seedDataProfile - Active seed profile
 * @returns {Array} Historic episodes
 */
const generateHistoricEpisodesForParticipants = (
  episodes,
  participants,
  seedDataProfile
) => {
  const max = config.generation.maxHistoricEpisodesPerParticipant
  const outcomeWeights = seedDataProfile?.episodes?.historicOutcomeWeights
  const participantsById = new Map(
    participants.map((participant) => [participant.id, participant])
  )

  // The oldest real episode per participant - history is generated back from it
  const earliestEpisodes = new Map()
  episodes.forEach((episode) => {
    const earliest = earliestEpisodes.get(episode.participantId)
    if (!earliest || episode.openedDate < earliest.openedDate) {
      earliestEpisodes.set(episode.participantId, episode)
    }
  })

  const historic = []

  earliestEpisodes.forEach((earliest, participantId) => {
    const participant = participantsById.get(participantId)
    if (!participant) return

    historic.push(
      ...generateHistoricEpisodes({
        participant,
        type: earliest.type,
        earliestOpenedDate: earliest.openedDate,
        max,
        outcomeWeights
      })
    )
  })

  return historic
}

/**
 * Seed one multi-event episode, to prove the container holds more than one
 * appointment.
 *
 * A technical recall is the natural multi-event case: reading concludes the
 * images need retaking, so the episode goes back to mammograms and a re-screen
 * is booked - a second event in the same episode.
 *
 * Whether one arises naturally depends on the reading dice, and some profiles
 * (allNormals) can never produce one. So where this run didn't throw one up,
 * we make one: two readers agreeing the images need retaking is exactly what
 * sends an episode back for a re-screen.
 *
 * Either way the re-screen has to be bookable, so candidates are only
 * considered if their unit has a future clinic with a free slot.
 *
 * @param {object} options
 * @param {Array} options.episodes - All real episodes
 * @param {Array} options.events - All events, with reading data attached
 * @param {Array} options.clinics - All clinics
 * @param {Array} options.participants - All participants
 * @param {Array} options.users - Users who can read
 * @param {object} options.seedDataProfile - Active seed profile
 * @returns {object | null} The re-screen event, or null if no case was found
 */
const seedTechnicalRecallRescreen = ({
  episodes,
  events,
  clinics,
  participants,
  users,
  seedDataProfile
}) => {
  const participantsById = new Map(
    participants.map((participant) => [participant.id, participant])
  )
  const eventsById = new Map(events.map((event) => [event.id, event]))
  const clinicsById = new Map(clinics.map((clinic) => [clinic.id, clinic]))
  const usedSlotIds = new Set(events.map((event) => event.slotId))
  const today = dayjs().startOf('day')

  // Where the re-screen could be booked: a future screening clinic with a
  // free slot, by unit
  const clinicByUnit = new Map()
  clinics.forEach((clinic) => {
    if (
      clinic.clinicType !== 'screening' ||
      !dayjs(clinic.date).isAfter(today) ||
      clinicByUnit.has(clinic.breastScreeningUnitId)
    ) {
      return
    }
    const slot = clinic.slots.find(
      (candidate) => !usedSlotIds.has(candidate.id)
    )
    if (slot) clinicByUnit.set(clinic.breastScreeningUnitId, { clinic, slot })
  })

  // An episode already owed a re-screen, else one still in reading that we
  // can turn into a technical recall. Only ones we could actually book.
  const isBookable = (episode) => {
    const participant = participantsById.get(episode.participantId)
    return Boolean(participant && clinicByUnit.has(participant.assignedBSU))
  }

  // Owed a re-screen: its one appointment was read as a technical recall.
  // Asked of the reading itself, so it can't drift from the stage maps.
  const owedRescreen = (episode) => {
    if (episode.eventIds.length !== 1) return false

    const event = eventsById.get(episode.eventIds[0])
    return Boolean(event) && getOutcome(event, {}) === 'technical_recall'
  }

  const episode =
    episodes.find(
      (candidate) => owedRescreen(candidate) && isBookable(candidate)
    ) ||
    episodes.find(
      (candidate) =>
        candidate.stage === 'reading' &&
        candidate.eventIds.length === 1 &&
        isBookable(candidate)
    )

  if (!episode || users.length < 2) return null

  const firstEvent = eventsById.get(episode.eventIds[0])
  if (!firstEvent) return null

  // Force the technical recall if this one didn't already have it
  if (!owedRescreen(episode)) {
    const readAt = dayjs(
      firstEvent.timing.actualEndTime || firstEvent.timing.startTime
    )
    const [firstReader, secondReader] = users

    const firstRead = generateSingleRead(
      firstEvent,
      firstReader.id,
      firstReader.role,
      readAt.add(1, 'day').toISOString(),
      { forceOpinion: 'technical_recall', readNumber: 1 }
    )

    // The second read has to agree with the first, down to which views need
    // retaking - two technical recalls flagging different views count as
    // discordant, and would go to arbitration instead of back for a re-screen
    const secondRead = {
      ...structuredClone(firstRead),
      readerId: secondReader.id,
      readerType: secondReader.role,
      readNumber: 2,
      timestamp: readAt.add(2, 'day').toISOString()
    }

    firstEvent.imageReading = {
      ...firstEvent.imageReading,
      reads: {
        [firstReader.id]: firstRead,
        [secondReader.id]: secondRead
      }
    }
    finaliseEpisodeStage(episode, [firstEvent], clinicsById)

    if (!owedRescreen(episode)) return null
  }

  const participant = participantsById.get(episode.participantId)
  const { clinic, slot } = clinicByUnit.get(participant.assignedBSU)

  const rescreenEvent = generateEvent({
    slot,
    participant,
    clinic,
    episodeId: episode.id,
    outcomeWeights: config.screening.outcomes[clinic.clinicType],
    forceStatus: 'event_scheduled',
    seedDataProfile
  })

  episode.eventIds.push(rescreenEvent.id)

  console.log(
    `Seeded technical-recall re-screen for ${participant.demographicInformation.firstName} ` +
      `${participant.demographicInformation.lastName} (episode ${episode.id})`
  )

  return rescreenEvent
}

const generateData = async (options = {}) => {
  const selectedSeedDataProfile =
    options.seedDataProfileObject || getSeedDataProfile(options.seedDataProfile)

  if (!fs.existsSync(config.paths.generatedData)) {
    fs.mkdirSync(config.paths.generatedData, { recursive: true })
  }

  console.log(
    `Using seed data profile: ${selectedSeedDataProfile.label.toLowerCase()}`
  )

  // Create test participants first, using generateParticipant but with overrides
  console.log('Generating test scenario participants...')
  const testParticipants = testScenarios.map((scenario) => {
    return generateParticipant({
      ethnicities,
      breastScreeningUnits,
      overrides: scenario.participant
    })
  })

  // Create set of test scenario participant IDs
  const testScenarioParticipantIds = new Set(
    testScenarios.map((s) => s.participant.id)
  )

  console.log('Generating random participants...')
  const randomParticipants = Array.from(
    { length: config.generation.numberOfParticipants },
    () => generateParticipant({ ethnicities, breastScreeningUnits })
  )

  // Combine test and random participants
  const participants = [...testParticipants, ...randomParticipants]

  console.log(`Made ${participants.length} participants`)

  console.log('Generating clinics and events...')
  const today = dayjs().startOf('day')

  // Only the current period is generated in full. Past screening rounds are
  // summary-level historic episodes instead of whole clinics and appointments -
  // full fidelity for the round being worked on, a summary for the rest.
  const dates = generateSnapshotPeriod(
    today.subtract(config.clinics.daysBeforeToday, 'days'),
    config.clinics.daysToGenerate
  )

  // Generate all data in batches per BSU
  const allData = breastScreeningUnits.map((unit) => {
    console.log(`Generating data for ${unit.name}...`)

    // One appointment per participant across the period
    const usedParticipantsInPeriod = new Set()

    const indices = createParticipantIndices(participants, dates[0])

    const daysData = dates.map((date) =>
      generateClinicsForDay(
        date,
        participants,
        unit,
        usedParticipantsInPeriod,
        indices,
        testScenarioParticipantIds,
        selectedSeedDataProfile
      )
    )

    return {
      clinics: [].concat(...daysData.map((day) => day.clinics)),
      events: [].concat(...daysData.map((day) => day.events)),
      episodes: [].concat(...daysData.map((day) => day.episodes)),
      newParticipants: [].concat(...daysData.map((day) => day.newParticipants))
    }
  })

  // Combine all data
  const allClinics = [].concat(...allData.map((d) => d.clinics))
  const allEvents = [].concat(...allData.map((d) => d.events))
  const allEpisodes = [].concat(...allData.map((d) => d.episodes))
  const allNewParticipants = [].concat(...allData.map((d) => d.newParticipants))

  // Combine initial and new participants
  const finalParticipants = [...participants, ...allNewParticipants]

  // Sort events by start time within each clinic
  const sortedEvents = allEvents.sort((a, b) => {
    // First sort by clinic ID to group events together
    if (a.clinicId !== b.clinicId) {
      return a.clinicId.localeCompare(b.clinicId)
    }
    // Then by start time within each clinic
    return new Date(a.timing.startTime) - new Date(b.timing.startTime)
  })

  console.log('Generating sample reading data...')
  const eventsWithReadingData = generateReadingData(
    sortedEvents,
    users,
    selectedSeedDataProfile
  )

  // Episodes: settle the stage now that reading data exists, add the seeded
  // multi-event (technical recall) case, then the summary-level past rounds
  console.log('Finalising episodes...')

  const eventsById = new Map(
    eventsWithReadingData.map((event) => [event.id, event])
  )
  const clinicsById = new Map(allClinics.map((clinic) => [clinic.id, clinic]))

  allEpisodes.forEach((episode) => {
    const episodeEvents = episode.eventIds
      .map((eventId) => eventsById.get(eventId))
      .filter(Boolean)
    finaliseEpisodeStage(episode, episodeEvents, clinicsById)
  })

  const rescreenEvent = seedTechnicalRecallRescreen({
    episodes: allEpisodes,
    events: eventsWithReadingData,
    clinics: allClinics,
    participants: finalParticipants,
    users,
    seedDataProfile: selectedSeedDataProfile
  })
  if (rescreenEvent) {
    eventsWithReadingData.push(rescreenEvent)
  }

  const historicEpisodes = generateHistoricEpisodesForParticipants(
    allEpisodes,
    finalParticipants,
    selectedSeedDataProfile
  )

  const episodesWithHistory = [...allEpisodes, ...historicEpisodes]

  // Group each participant's episodes together, oldest first. Snapshots are
  // generated newest-first, so without this the store's per-participant index
  // wouldn't be in date order.
  episodesWithHistory.sort(
    (a, b) =>
      a.participantId.localeCompare(b.participantId) ||
      new Date(a.openedDate) - new Date(b.openedDate)
  )

  // The re-screen event was added after the events map was built
  eventsWithReadingData.forEach((event) => eventsById.set(event.id, event))

  const episodeProblems = checkEpisodes(episodesWithHistory, eventsById)
  if (episodeProblems.length) {
    console.warn(
      `\nWarning: ${episodeProblems.length} incoherent episodes were generated:`
    )
    episodeProblems
      .slice(0, 10)
      .forEach((problem) => console.warn(`  - ${problem}`))
    if (episodeProblems.length > 10) {
      console.warn(`  ...and ${episodeProblems.length - 10} more`)
    }
  }

  const writeData = (filename, data) => {
    fs.writeFileSync(
      path.join(config.paths.generatedData, filename),
      JSON.stringify(data, null, 2)
    )
  }

  writeData('participants.json', { participants: finalParticipants })
  writeData('clinics.json', {
    clinics: allClinics.map((clinic) => ({
      ...clinic,
      slots: clinic.slots.sort(
        (a, b) => new Date(a.dateTime) - new Date(b.dateTime)
      )
    }))
  })
  writeData('events.json', { events: eventsWithReadingData })
  writeData('episodes.json', { episodes: episodesWithHistory })
  writeData('generation-info.json', {
    generatedAt: new Date().toISOString(),
    seedDataProfile: selectedSeedDataProfile.key,
    stats: {
      participants: finalParticipants.length,
      clinics: allClinics.length,
      events: eventsWithReadingData.length,
      episodes: episodesWithHistory.length
    }
  })

  console.log('\nData generation complete!')
  console.log('Generated:')
  console.log(`- ${finalParticipants.length} participants`)
  console.log(`- ${allClinics.length} clinics`)
  console.log(`- ${eventsWithReadingData.length} events`)
  console.log(
    `- ${episodesWithHistory.length} episodes ` +
      `(${allEpisodes.length} current, ${historicEpisodes.length} historic)`
  )
}

// Export the function instead of running it immediately
module.exports = generateData

// Only run if this file is being run directly
if (require.main === module) {
  generateData().catch(console.error)
}
