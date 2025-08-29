// app/lib/generators/reading-generator.js

const dayjs = require('dayjs')
const weighted = require('weighted')

const { eligibleForReading } = require('../utils/status')

/**
 * Generate sample image reading data to simulate first and second reads
 *
 * @param {Array} events - Array of screening events
 * @param {Array} users - Array of system users
 * @returns {Array} Updated events with reading data
 */
const generateReadingData = (events, users) => {
  if (!events || !events.length || !users || users.length < 2) {
    console.log('No events or not enough users to generate reading data')
    return events
  }

  // Use the first, second, and third users as our readers
  const firstReader = users[0]
  const secondReader = users[1]
  const thirdReader = users[2]

  console.log(
    `Generating reading data using ${firstReader.firstName} ${firstReader.lastName}, ${secondReader.firstName} ${secondReader.lastName}, and ${thirdReader.firstName} ${thirdReader.lastName} as readers`
  )

  const recentEvents = events.filter((event) => eligibleForReading(event))

  // Sort by date (oldest first)
  const sortedEvents = [...recentEvents].sort(
    (a, b) => new Date(a.timing.startTime) - new Date(b.timing.startTime)
  )

  if (sortedEvents.length === 0) {
    console.log('No recent completed events to add reading data to')
    return events
  }

  // Group events by clinic
  const eventsByClinic = {}
  sortedEvents.forEach((event) => {
    if (!eventsByClinic[event.clinicId]) {
      eventsByClinic[event.clinicId] = []
    }
    eventsByClinic[event.clinicId].push(event)
  })

  // Get clinics sorted by date (oldest first)
  const clinics = Object.keys(eventsByClinic)
    .map((clinicId) => ({
      id: clinicId,
      events: eventsByClinic[clinicId],
      date: eventsByClinic[clinicId][0].timing.startTime
    }))
    .sort((a, b) => new Date(a.id) - new Date(b.id)) // Some clinics share the same date so sort first by a unique ID to keep consistent sort
    .sort((a, b) => new Date(a.date) - new Date(b.date))

  console.log(
    `Found ${clinics.length} clinics with completed events in the last 30 days`
  )

  // Define read results with appropriate weights
  const readResults = {
    normal: 0.7, // 70% normal
    technical_recall: 0.1, // 10% technical recall
    recall_for_assessment: 0.2 // 20% recall for assessment
  }

  // Clone the events array to avoid modifying the original
  const updatedEvents = [...events]

  // Track which events are updated for efficient lookup later
  const updatedEventIds = new Set()

  // Function to generate a recent timestamp (within past 7 days)
  const generateRecentTimestamp = (baseDate, minHours = 2, maxHours = 36) => {
    const hoursAgo =
      Math.floor(Math.random() * (maxHours - minHours)) + minHours
    return dayjs().subtract(hoursAgo, 'hours').toISOString()
  }

  // TWO OLDEST CLINICS: Complete first and second reads
  if (clinics.length >= 2) {
    let count = 0
    for (let i = 0; i < 2 && i < clinics.length; i++) {
      const clinic = clinics[i]
      console.log(
        `Adding complete first and second reads to clinic ${clinic.id}`
      )

      // Use the same base time for all reads in this clinic, then advance by 1 minute for each event
      let baseReadTime = dayjs(generateRecentTimestamp(clinic.date, 48, 72))

      clinic.events.forEach((event) => {
        // Find the event in our array
        const eventIndex = updatedEvents.findIndex((e) => e.id === event.id)
        if (eventIndex === -1) return

        // Ensure the imageReading structure exists
        if (!updatedEvents[eventIndex].imageReading) {
          updatedEvents[eventIndex].imageReading = { reads: {} }
        }

        // Advance time by 1 minute for each read
        baseReadTime = baseReadTime.add(1, 'minute')

        // First read (by second user)
        const firstResult = weighted.select(readResults)
        const firstReadTime = baseReadTime.toISOString()

        updatedEvents[eventIndex].imageReading.reads[secondReader.id] = {
          result: firstResult,
          readerId: secondReader.id,
          readerType: secondReader.role,
          timestamp: firstReadTime
        }

        // Second read (by first user) - 80% chance of agreement
        let secondResult = firstResult
        if (Math.random() > 0.8) {
          // Different result for disagreement
          const otherResults = Object.keys(readResults).filter(
            (r) => r !== firstResult
          )
          secondResult =
            otherResults[Math.floor(Math.random() * otherResults.length)]
        }

        // Add 15-30 minutes for second read
        const secondReadTime = baseReadTime
          .add(Math.floor(Math.random() * 16) + 15, 'minutes')
          .toISOString()

        updatedEvents[eventIndex].imageReading.reads[firstReader.id] = {
          result: secondResult,
          readerId: firstReader.id,
          readerType: firstReader.role,
          timestamp: secondReadTime
        }

        updatedEventIds.add(event.id)
        count++
      })
    }
    console.log(
      `Added first and second reads to ${count} events in the 2 oldest clinics`
    )
  }

  // NEW: Add clinic where both reads are completed, but neither by the current user
  if (clinics.length >= 3) {
    // Use the next clinic for this scenario
    const clinic = clinics[2]
    console.log(
      `Adding a clinic with both reads completed by users other than current user to clinic ${clinic.id}`
    )

    // Use the same base time for all reads in this clinic, then advance by 1 minute for each event
    let baseReadTime = dayjs(generateRecentTimestamp(clinic.date, 30, 48))

    // Add full first reads by third user
    clinic.events.forEach((event) => {
      // Skip if already updated
      if (updatedEventIds.has(event.id)) return

      // Find the event in our array
      const eventIndex = updatedEvents.findIndex((e) => e.id === event.id)
      if (eventIndex === -1) return

      // Ensure the imageReading structure exists
      if (!updatedEvents[eventIndex].imageReading) {
        updatedEvents[eventIndex].imageReading = { reads: {} }
      }

      // Advance time by 1 minute for each read
      baseReadTime = baseReadTime.add(1, 'minute')

      // First read (by third user)
      const firstResult = weighted.select(readResults)
      const firstReadTime = baseReadTime.toISOString()

      updatedEvents[eventIndex].imageReading.reads[thirdReader.id] = {
        result: firstResult,
        readerId: thirdReader.id,
        readerType: thirdReader.role,
        timestamp: firstReadTime
      }

      updatedEventIds.add(event.id)
    })

    // Add second reads by second user to 60% of events
    const eventsForSecondRead = clinic.events
      .filter((event) => updatedEventIds.has(event.id))
      .slice(0, Math.ceil(clinic.events.length * 0.6)) // Take 60% of events for second read

    baseReadTime = dayjs(generateRecentTimestamp(clinic.date, 12, 24)) // More recent timestamp for second reads

    eventsForSecondRead.forEach((event) => {
      const eventIndex = updatedEvents.findIndex((e) => e.id === event.id)
      if (eventIndex === -1) return

      // Get the first read result
      const firstRead =
        updatedEvents[eventIndex].imageReading.reads[thirdReader.id]
      if (!firstRead) return

      // Second read (by second user) - 80% chance of agreement
      let secondResult = firstRead.result
      if (Math.random() > 0.8) {
        // Different result for disagreement
        const otherResults = Object.keys(readResults).filter(
          (r) => r !== firstRead.result
        )
        secondResult =
          otherResults[Math.floor(Math.random() * otherResults.length)]
      }

      // Advance time by 1-2 minutes for each read
      baseReadTime = baseReadTime.add(
        1 + Math.floor(Math.random() * 2),
        'minute'
      )
      const secondReadTime = baseReadTime.toISOString()

      updatedEvents[eventIndex].imageReading.reads[secondReader.id] = {
        result: secondResult,
        readerId: secondReader.id,
        readerType: secondReader.role,
        timestamp: secondReadTime
      }
    })

    console.log(
      `Added a clinic with ${clinic.events.length} first reads and ${eventsForSecondRead.length} second reads, both done by users other than current user`
    )
  }

  // NEXT TWO CLINICS: First user (current user) reads all first, but no second reads
  if (clinics.length >= 5) {
    let count = 0
    for (let i = 3; i < 5 && i < clinics.length; i++) {
      const clinic = clinics[i]
      console.log(`Adding first reads by current user to clinic ${clinic.id}`)

      // Use the same base time for all reads in this clinic, then advance by 1 minute for each event
      let baseReadTime = dayjs(generateRecentTimestamp(clinic.date, 12, 36))

      clinic.events.forEach((event) => {
        // Skip if already updated
        if (updatedEventIds.has(event.id)) return

        // Find the event in our array
        const eventIndex = updatedEvents.findIndex((e) => e.id === event.id)
        if (eventIndex === -1) return

        // Ensure the imageReading structure exists
        if (!updatedEvents[eventIndex].imageReading) {
          updatedEvents[eventIndex].imageReading = { reads: {} }
        }

        // Advance time by 1 minute for each read
        baseReadTime = baseReadTime.add(1, 'minute')

        // First read (by first user/current user)
        const firstResult = weighted.select(readResults)
        const firstReadTime = baseReadTime.toISOString()

        updatedEvents[eventIndex].imageReading.reads[firstReader.id] = {
          result: firstResult,
          readerId: firstReader.id,
          readerType: firstReader.role,
          timestamp: firstReadTime
        }

        updatedEventIds.add(event.id)
        count++
      })
    }
    console.log(
      `Added first reads by current user to ${count} events in the next 2 clinics`
    )
  }

  // NEXT TWO CLINICS: Second user reads all first, waiting for first user (current user) to do second reads
  if (clinics.length >= 7) {
    let count = 0
    for (let i = 5; i < 7 && i < clinics.length; i++) {
      const clinic = clinics[i]
      console.log(`Adding first reads by second user to clinic ${clinic.id}`)

      // Use the same base time for all reads in this clinic, then advance by 1 minute for each event
      let baseReadTime = dayjs(generateRecentTimestamp(clinic.date, 4, 24))

      clinic.events.forEach((event) => {
        // Skip if already updated
        if (updatedEventIds.has(event.id)) return

        // Find the event in our array
        const eventIndex = updatedEvents.findIndex((e) => e.id === event.id)
        if (eventIndex === -1) return

        // Ensure the imageReading structure exists
        if (!updatedEvents[eventIndex].imageReading) {
          updatedEvents[eventIndex].imageReading = { reads: {} }
        }

        // Advance time by 1 minute for each read
        baseReadTime = baseReadTime.add(1, 'minute')

        // First read (by second user)
        const firstResult = weighted.select(readResults)
        const firstReadTime = baseReadTime.toISOString()

        updatedEvents[eventIndex].imageReading.reads[secondReader.id] = {
          result: firstResult,
          readerId: secondReader.id,
          readerType: secondReader.role,
          timestamp: firstReadTime
        }

        updatedEventIds.add(event.id)
        count++
      })
    }
    console.log(
      `Added first reads by second user to ${count} events in the next 2 clinics`
    )
  }

  // NEXT TWO OLDEST CLINICS: 75% first read by third user
  if (clinics.length >= 9) {
    let count = 0
    for (let i = 7; i < 9 && i < clinics.length; i++) {
      const clinic = clinics[i]
      console.log(`Adding partial first reads to clinic ${clinic.id}`)

      // Use the same base time for all reads in this clinic, then advance by 1 minute for each event
      let baseReadTime = dayjs(generateRecentTimestamp(clinic.date, 1, 12))

      // Only read 75% of events in these clinics
      const eventsToRead = clinic.events
        .filter((event) => !updatedEventIds.has(event.id))
        .slice(0, Math.ceil(clinic.events.length * 0.75)) // Take first 75%

      eventsToRead.forEach((event) => {
        // Find the event in our array
        const eventIndex = updatedEvents.findIndex((e) => e.id === event.id)
        if (eventIndex === -1) return

        // Ensure the imageReading structure exists
        if (!updatedEvents[eventIndex].imageReading) {
          updatedEvents[eventIndex].imageReading = { reads: {} }
        }

        // Advance time by 1 minute for each read
        baseReadTime = baseReadTime.add(1, 'minute')

        // First read (by third user)
        const firstResult = weighted.select(readResults)
        const firstReadTime = baseReadTime.toISOString()

        updatedEvents[eventIndex].imageReading.reads[thirdReader.id] = {
          result: firstResult,
          readerId: thirdReader.id,
          readerType: thirdReader.role,
          timestamp: firstReadTime
        }

        updatedEventIds.add(event.id)
        count++
      })
    }
    console.log(
      `Added partial first reads to ${count} events in the next 2 clinics`
    )
  }

  console.log(`Total events with reading data: ${updatedEventIds.size}`)
  return updatedEvents
}

module.exports = {
  generateReadingData
}
