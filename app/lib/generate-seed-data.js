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
const { getCurrentRiskLevel } = require('./utils/participants')
const { generateReadingData } = require('./generators/reading-generator')

const riskLevels = require('../data/risk-levels')

// Load existing data
const breastScreeningUnits = require('../data/breast-screening-units')
const ethnicities = require('../data/ethnicities')

// Hardcoded scenarios for user research
const testScenarios = require('../data/test-scenarios')


// Create an index of participants by risk level for efficient lookup
// Create an index of participants by risk level for efficient lookup
const createParticipantIndices = (participants, clinicDate, events = []) => {
  // console.time('Creating participant indices')

  const riskLevelIndex = {}
  const screeningHistoryIndex = new Map()

  // Single pass through participants
  participants.forEach(participant => {
    const riskLevel = getCurrentRiskLevel(participant, clinicDate.toDate())

    const age = dayjs(clinicDate).diff(dayjs(participant.demographicInformation.dateOfBirth), 'year')

    // Check if they're age-eligible for their risk level
    const ageRange = riskLevels[riskLevel].ageRange
    if (age >= ageRange.lower && age <= ageRange.upper) {
      // Initialize array for this risk level if needed
      riskLevelIndex[riskLevel] = riskLevelIndex[riskLevel] || []

      // Add participant to their risk level index
      riskLevelIndex[riskLevel].push(participant)
    }

    // Track all screening events for this participant
    const participantEvents = events.filter(event =>
      event.participantId === participant.id
    )
    screeningHistoryIndex.set(participant.id, participantEvents)
  })

  return {
    riskLevelIndex,
    screeningHistoryIndex,
  }
}


// Find nearest slot at or after the target time
// Used by test scenarios so we can populate a slot at a given time
const findNearestSlot = (slots, targetTime) => {
  if (!targetTime) return null

  const [targetHour, targetMinute] = targetTime.split(':').map(Number)
  const targetMinutes = targetHour * 60 + targetMinute

  // Filter to only slots at or after target time
  const eligibleSlots = slots.filter(slot => {
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

const generateClinicsForDay = (date, allParticipants, unit, usedParticipantsInSnapshot, indices) => {
  const clinics = []
  const events = []
  const participants = [...allParticipants]

  // Check if this snapshot date is for the recent period (not historical)
  const isRecentSnapshot = dayjs(date).isAfter(dayjs().subtract(1, 'month'))

  // Only look for test scenarios in recent snapshots
  const testScenariosForDay = isRecentSnapshot
    ? testScenarios.filter(scenario => {
        const targetDate = dayjs().startOf('day').add(scenario.participant.config.scheduling.whenRelativeToToday, 'day')
        return targetDate.isSame(dayjs(date).startOf('day'), 'day')
      })
    : []

  // Pre-filter eligible participants once
  const clinicDate = dayjs(date)

  // Generate clinics for this day
  const newClinics = generateClinicsForBSU({
    date: date.toDate(),
    breastScreeningUnit: unit,
  })

  // For test scenarios, only use first clinic of the day
  if (testScenariosForDay.length > 0 && newClinics.length > 0) {
    const firstClinic = newClinics[0]

    testScenariosForDay.forEach(scenario => {
      const participant = participants.find(p => p.id === scenario.participant.id)
      if (!participant) return

      const slot = scenario.participant.config.scheduling.slotIndex !== undefined
        ? firstClinic.slots[scenario.participant.config.scheduling.slotIndex]
        : findNearestSlot(firstClinic.slots, scenario.participant.config.scheduling.approximateTime)

      if (!slot) {
        console.log(`Warning: Could not find suitable slot for test participant ${participant.id}`)
        return
      }

      const event = generateEvent({
        slot,
        participant,
        clinic: firstClinic,
        id: scenario?.participant?.config?.eventId,
        outcomeWeights: config.screening.outcomes[firstClinic.clinicType],
        forceStatus: scenario.participant.config.scheduling.status,
        specialAppointmentOverride: scenario?.participant?.config?.specialAppointment,
      })

      events.push(event)
      usedParticipantsInSnapshot.add(participant.id)
    })
  }

  // Handle regular clinic slot allocation for all clinics
  newClinics.forEach(clinic => {
    const remainingSlots = clinic.slots
      .filter(() => Math.random() < config.generation.bookingProbability)
      .filter(slot => !events.some(e => e.slotId === slot.id))

    remainingSlots.forEach(slot => {
      // Pick risk level based on clinic's supported levels
      const availableRiskLevels = clinic.riskLevels

      const selectedRiskLevel = weighted.select(
        Object.fromEntries(
          availableRiskLevels.map(level => [
            level,
            riskLevels[level].weight
          ])
        )
      )

      // Get available participants of selected risk level
      const availableParticipants = indices.riskLevelIndex[selectedRiskLevel]
        .filter(p => !usedParticipantsInSnapshot.has(p.id))

      if (availableParticipants.length === 0) {

        const newParticipant = generateParticipant({
          ethnicities,
          breastScreeningUnits: [unit],
          riskLevel: selectedRiskLevel,
        })
        // console.log(`Not enough participants, creating a new one ${newParticipant.id}`)
        participants.push(newParticipant)
        availableParticipants.push(newParticipant)
      }

      for (let i = 0; i < slot.capacity; i++) {
        if (availableParticipants.length === 0) break
        const randomIndex = Math.floor(Math.random() * availableParticipants.length)
        const participant = availableParticipants[randomIndex]

        const event = generateEvent({
          slot,
          participant,
          clinic,
          outcomeWeights: config.screening.outcomes[clinic.clinicType],
        })

        events.push(event)
        usedParticipantsInSnapshot.add(participant.id)
        availableParticipants.splice(randomIndex, 1)
      }
    })

    clinics.push(clinic)
  })

  return {
    clinics,
    events,
    newParticipants: participants.slice(allParticipants.length),
  }
}

// Generate array of dates for a snapshot period
const generateSnapshotPeriod = (startDate, numberOfDays) => {
  return Array.from(
    { length: numberOfDays },
    (_, i) => dayjs(startDate).add(i, 'days')
  )
}

const generateData = async () => {
  if (!fs.existsSync(config.paths.generatedData)) {
    fs.mkdirSync(config.paths.generatedData, { recursive: true })
  }

  // Create test participants first, using generateParticipant but with overrides
  console.log('Generating test scenario participants...')
  const testParticipants = testScenarios.map(scenario => {
    return generateParticipant({
      ethnicities,
      breastScreeningUnits,
      overrides: scenario.participant,
    })
  })

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

  let snapshots = [
    // Current period
    generateSnapshotPeriod(
      today.subtract(config.clinics.daysBeforeToday, 'days'),
      config.clinics.daysToGenerate
    )
  ]

  // Generate historical periods
  const historicPeriods = config?.clinics?.historicPeriodCount || 0

  for (let index = 0; index < historicPeriods; index++) {
    snapshots.push(
      generateSnapshotPeriod(
        today.subtract(index + 3, 'year'),
        5
        )
      )
  }

  // Define snapshots from newest to oldest
  // const snapshots = [

  //   // Historical periods
  //   generateSnapshotPeriod(
  //     today.subtract(3, 'year').add(1, 'month'),
  //     config.clinics.daysToGenerate
  //   ),
  //   generateSnapshotPeriod(
  //     today.subtract(6, 'year').add(2, 'month'),
  //     config.clinics.daysToGenerate
  //   ),
  //   generateSnapshotPeriod(
  //     today.subtract(9, 'year').add(3, 'month'),
  //     config.clinics.daysToGenerate
  //   ),
  // ]

  // Generate all data in batches per BSU
  const allData = breastScreeningUnits.map(unit => {
    console.log(`Generating data for ${unit.name}...`)

    let unitEvents = [] // Track events for this unit across snapshots

    // Process each snapshot
    const unitData = snapshots.map(dates => {
      // Create a set to track used participants for this entire snapshot
      const usedParticipantsInSnapshot = new Set()

      // Create indices for this snapshot using the first date
      const indices = createParticipantIndices(participants, dates[0], unitEvents)
      // console.log(`Created indices for snapshot ${dates[0].format('YYYY-MM-DD')}:`)
      // console.log(`- ${Object.keys(indices.riskLevelIndex).length} risk levels`)
      // console.log(`- ${indices.screeningHistoryIndex.size} participants with history`)

      // Process each day in the snapshot
      const snapshotData = dates.map(date =>
        generateClinicsForDay(date, participants, unit, usedParticipantsInSnapshot, indices)
      )

      // Add newly generated events to our tracking array
      const newEvents = [].concat(...snapshotData.map(s => s.events))
      unitEvents = [...unitEvents, ...newEvents]

      return {
        clinics: [].concat(...snapshotData.map(s => s.clinics)),
        events: newEvents,
        newParticipants: [].concat(...snapshotData.map(s => s.newParticipants)),
      }
    })

    return {
      clinics: [].concat(...unitData.map(d => d.clinics)),
      events: [].concat(...unitData.map(d => d.events)),
      newParticipants: [].concat(...unitData.map(d => d.newParticipants)),
    }
  })

  // Combine all data
  const allClinics = [].concat(...allData.map(d => d.clinics))
  const allEvents = [].concat(...allData.map(d => d.events))
  const allNewParticipants = [].concat(...allData.map(d => d.newParticipants))

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
  const eventsWithReadingData = generateReadingData(sortedEvents, require('../data/users'))


  // breastScreeningUnits.forEach(unit => {
  //   snapshots.forEach(date => {
  //     const { clinics, events, newParticipants } = generateSnapshot(date, participants, unit);
  //     allClinics.push(...clinics);
  //     allEvents.push(...events);
  //     participants = [...participants, ...newParticipants];
  //   });
  // });

  const writeData = (filename, data) => {
    fs.writeFileSync(
      path.join(config.paths.generatedData, filename),
      JSON.stringify(data, null, 2)
    )
  }

  writeData('participants.json', { participants: finalParticipants })
  writeData('clinics.json', {
    clinics: allClinics.map(clinic => ({
      ...clinic,
      slots: clinic.slots.sort((a, b) => new Date(a.dateTime) - new Date(b.dateTime)),
    })),
  })
  writeData('events.json', { events: eventsWithReadingData })
  writeData('generation-info.json', {
    generatedAt: new Date().toISOString(),
    stats: {
      participants: finalParticipants.length,
      clinics: allClinics.length,
      events: allEvents.length,
    },
  })

  console.log('\nData generation complete!')
  console.log('Generated:')
  console.log(`- ${finalParticipants.length} participants`)
  console.log(`- ${allClinics.length} clinics`)
  console.log(`- ${allEvents.length} events`)
}

// Export the function instead of running it immediately
module.exports = generateData

// Only run if this file is being run directly
if (require.main === module) {
  generateData().catch(console.error)
}
