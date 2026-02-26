// app/lib/generators/reading-generator.js

const dayjs = require('dayjs')
const weighted = require('weighted')
const { faker } = require('@faker-js/faker')
const { eligibleForReading } = require('../utils/status')
const {
  getSetById,
  getResolvedAnnotations
} = require('../utils/mammogram-images')
const generateId = require('../utils/id-generator')

// Default alignment probability - how often reads match the image set's tag
// This can be overridden by seed data profile settings
const DEFAULT_ALIGNMENT_PROBABILITY = 0.95

// Default read result weights when no set or misaligned
const DEFAULT_READ_WEIGHTS = {
  normal: 0.7,
  technical_recall: 0.1,
  recall_for_assessment: 0.2
}

// Technical recall reasons (matches the form options)
const TECHNICAL_RECALL_REASONS = [
  'Breast positioning',
  'Image blurred',
  'Exposure incorrect',
  'Movement artefact',
  'Foreign body artefact',
  'Processing error',
  'Equipment malfunction',
  'Other'
]

/**
 * Map from set tag to read result
 */
const TAG_TO_RESULT = {
  normal: 'normal',
  abnormal: 'recall_for_assessment',
  technical: 'technical_recall',
  indeterminate: 'recall_for_assessment' // Treat indeterminate as needing further assessment
}

/**
 * Generate a single read result aligned with the image set metadata
 *
 * @param {object} event - The event being read
 * @param {string} readerId - The reader's user ID
 * @param {string} readerType - The reader's role
 * @param {string} timestamp - ISO timestamp for the read
 * @param {object} [options] - Generation options
 * @param {boolean} [options.forceAlignment] - Force alignment with set (ignore probability)
 * @param {string} [options.forceOpinion] - Force a specific opinion type
 * @param {number} [options.readNumber] - The read number (1 = first, 2 = second)
 * @returns {object} The generated read object
 */
const generateSingleRead = (
  event,
  readerId,
  readerType,
  timestamp,
  options = {}
) => {
  const setId = event.mammogramData?.selectedSetId
  const set = setId ? getSetById(setId, 'diagrams') : null

  // Determine the opinion
  let opinion

  if (options.forceOpinion) {
    opinion = options.forceOpinion
  } else if (set) {
    // Decide if this read aligns with the set
    const shouldAlign =
      options.forceAlignment ||
      Math.random() <
        (options.alignmentProbability ?? DEFAULT_ALIGNMENT_PROBABILITY)

    if (shouldAlign) {
      opinion = TAG_TO_RESULT[set.tag] || 'normal'
    } else {
      // Pick a different opinion
      const alignedOpinion = TAG_TO_RESULT[set.tag] || 'normal'
      const otherOpinions = Object.keys(DEFAULT_READ_WEIGHTS).filter(
        (r) => r !== alignedOpinion
      )
      opinion = faker.helpers.arrayElement(otherOpinions)
    }
  } else {
    // No set - use default weights
    opinion = weighted.select(DEFAULT_READ_WEIGHTS)
  }

  // Build base read object
  const read = {
    opinion,
    readerId,
    readerType,
    timestamp,
    readNumber: options.readNumber || 1
  }

  // Add opinion-specific data
  if (opinion === 'normal') {
    // Normal reads are simple - just per-breast assessment
    read.left = { breastAssessment: 'normal' }
    read.right = { breastAssessment: 'normal' }
  } else if (opinion === 'technical_recall') {
    // Technical recall - determine which views need retaking
    read.technicalRecall = generateTechnicalRecallData(event, set)
    read.left = {
      breastAssessment:
        set?.left?.status === 'technical' ? 'technical' : 'normal'
    }
    read.right = {
      breastAssessment:
        set?.right?.status === 'technical' ? 'technical' : 'normal'
    }
  } else if (opinion === 'recall_for_assessment') {
    // Abnormal - generate per-breast assessments and annotations
    const { left, right } = generateAbnormalData(event, set)
    read.left = left
    read.right = right
  }

  return read
}

/**
 * Generate technical recall data based on set metadata
 */
const generateTechnicalRecallData = (event, set) => {
  const views = {}

  // If we have a set with per-breast status, use that to determine which views
  if (set) {
    const viewCodes = ['RMLO', 'RCC', 'LCC', 'LMLO']

    // Check which side has technical issues
    const rightTech = set.right?.status === 'technical'
    const leftTech = set.left?.status === 'technical'

    if (rightTech) {
      // Pick one or both right views
      const rightViews = Math.random() < 0.5 ? ['RMLO'] : ['RMLO', 'RCC']
      rightViews.forEach((v) => {
        views[v] = {
          reason: faker.helpers.arrayElement(TECHNICAL_RECALL_REASONS),
          additionalDetails: Math.random() < 0.3 ? 'Repeat required' : ''
        }
      })
    }

    if (leftTech) {
      // Pick one or both left views
      const leftViews = Math.random() < 0.5 ? ['LMLO'] : ['LMLO', 'LCC']
      leftViews.forEach((v) => {
        views[v] = {
          reason: faker.helpers.arrayElement(TECHNICAL_RECALL_REASONS),
          additionalDetails: Math.random() < 0.3 ? 'Repeat required' : ''
        }
      })
    }

    // If neither side marked as technical, pick a random view
    if (!rightTech && !leftTech) {
      const randomView = faker.helpers.arrayElement(viewCodes)
      views[randomView] = {
        reason: faker.helpers.arrayElement(TECHNICAL_RECALL_REASONS),
        additionalDetails: ''
      }
    }
  } else {
    // No set - pick 1-2 random views
    const viewCodes = ['RMLO', 'RCC', 'LCC', 'LMLO']
    const count = Math.random() < 0.7 ? 1 : 2
    const selectedViews = faker.helpers.arrayElements(viewCodes, {
      min: count,
      max: count
    })

    selectedViews.forEach((v) => {
      views[v] = {
        reason: faker.helpers.arrayElement(TECHNICAL_RECALL_REASONS),
        additionalDetails: ''
      }
    })
  }

  return { views }
}

/**
 * Generate abnormal (recall for assessment) data based on set metadata
 */
const generateAbnormalData = (event, set) => {
  const left = { breastAssessment: 'normal', annotations: [] }
  const right = { breastAssessment: 'normal', annotations: [] }

  if (set) {
    // Use set's per-breast status
    if (set.left?.status === 'abnormal') {
      left.breastAssessment = 'abnormal'
    }
    if (set.right?.status === 'abnormal') {
      right.breastAssessment = 'abnormal'
    }

    // Get resolved annotations (follows 'from' references for composite sets)
    const annotations = getResolvedAnnotations(set)

    if (annotations.length > 0) {
      annotations.forEach((annotation) => {
        const targetBreast = annotation.side === 'left' ? left : right

        // Use positions directly from manifest (already in 0-1 format with view-name keys)
        targetBreast.annotations.push({
          id: generateId(),
          side: annotation.side,
          abnormalityType: Array.isArray(annotation.abnormalityType)
            ? annotation.abnormalityType
            : [annotation.abnormalityType],
          levelOfConcern: annotation.levelOfConcern || '4',
          positions: annotation.positions || {},
          comment: annotation.notes || ''
        })
      })
    } else if (
      left.breastAssessment === 'abnormal' ||
      right.breastAssessment === 'abnormal'
    ) {
      // Set marked as abnormal but no annotations - generate placeholder
      if (left.breastAssessment === 'abnormal') {
        left.annotations.push(generatePlaceholderAnnotation('left', set.left))
      }
      if (right.breastAssessment === 'abnormal') {
        right.annotations.push(
          generatePlaceholderAnnotation('right', set.right)
        )
      }
    }
  } else {
    // No set - generate random abnormal data
    const abnormalSide = Math.random() < 0.5 ? 'left' : 'right'
    const target = abnormalSide === 'left' ? left : right
    target.breastAssessment = 'abnormal'
    target.annotations.push(generatePlaceholderAnnotation(abnormalSide, null))
  }

  // Ensure at least one breast is abnormal for recall_for_assessment
  if (
    left.breastAssessment === 'normal' &&
    right.breastAssessment === 'normal'
  ) {
    const target = Math.random() < 0.5 ? left : right
    target.breastAssessment = 'abnormal'
    target.annotations.push(
      generatePlaceholderAnnotation(target === left ? 'left' : 'right', null)
    )
  }

  return { left, right }
}

/**
 * Generate a placeholder annotation when set doesn't have detailed annotations
 */
const generatePlaceholderAnnotation = (side, breastData) => {
  const abnormalityTypes = [
    'Mass well-defined',
    'Mass ill-defined',
    'Microcalcification outside a mass',
    'Microcalcification within a mass',
    'Architectural distortion',
    'Asymmetric density'
  ]

  // Use finding from set if available
  let abnormalityType = faker.helpers.arrayElement(abnormalityTypes)
  if (breastData?.finding) {
    const findingMap = {
      'mass': 'Mass well-defined',
      'calcification': 'Microcalcification outside a mass',
      'distortion': 'Architectural distortion',
      'lymph-nodes': 'Asymmetric density',
      'asymmetric-density': 'Asymmetric density'
    }
    abnormalityType = findingMap[breastData.finding] || abnormalityType
  }

  // Generate random positions for both views (0-1 format, 3 decimal places)
  // Keep positions in a realistic range (avoiding edges)
  const randomPos = () => Math.round((0.2 + Math.random() * 0.6) * 1000) / 1000

  const viewKeys = side === 'right' ? ['rmlo', 'rcc'] : ['lmlo', 'lcc']
  const positions = {}
  viewKeys.forEach((view) => {
    positions[view] = { x: randomPos(), y: randomPos() }
  })

  return {
    id: generateId(),
    side,
    abnormalityType: [abnormalityType],
    levelOfConcern: faker.helpers.arrayElement(['3', '4', '5']),
    positions,
    comment: ''
  }
}

/**
 * Generate sample image reading data to simulate first and second reads
 *
 * @param {Array} events - Array of screening events
 * @param {Array} users - Array of system users
 * @returns {Array} Updated events with reading data
 */
const generateReadingData = (events, users, seedProfile = {}) => {
  const alignmentProbability =
    seedProfile?.imageReading?.probabilityFirstReaderOpinionMatchesImages ??
    DEFAULT_ALIGNMENT_PROBABILITY
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
        const firstReadTime = baseReadTime.toISOString()

        // First read (by second user) - aligned with image set
        const firstRead = generateSingleRead(
          updatedEvents[eventIndex],
          secondReader.id,
          secondReader.role,
          firstReadTime,
          { readNumber: 1, alignmentProbability }
        )
        updatedEvents[eventIndex].imageReading.reads[secondReader.id] =
          firstRead

        // Second read (by first user) - 80% chance of agreement with first read
        const secondReadTime = baseReadTime
          .add(Math.floor(Math.random() * 16) + 15, 'minutes')
          .toISOString()

        // Determine second read opinion - 80% agree with first, 20% different
        const forceSecondOpinion =
          Math.random() > 0.8
            ? Object.keys(TAG_TO_RESULT)
                .map((t) => TAG_TO_RESULT[t])
                .filter((r) => r !== firstRead.opinion)[
                Math.floor(Math.random() * 2)
              ]
            : firstRead.opinion

        const secondRead = generateSingleRead(
          updatedEvents[eventIndex],
          firstReader.id,
          firstReader.role,
          secondReadTime,
          {
            forceOpinion: forceSecondOpinion,
            readNumber: 2,
            alignmentProbability
          }
        )
        updatedEvents[eventIndex].imageReading.reads[firstReader.id] =
          secondRead

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
    let count = 0
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
      const firstReadTime = baseReadTime.toISOString()

      // First read (by third user) - aligned with image set
      const firstRead = generateSingleRead(
        updatedEvents[eventIndex],
        thirdReader.id,
        thirdReader.role,
        firstReadTime,
        { readNumber: 1, alignmentProbability }
      )
      updatedEvents[eventIndex].imageReading.reads[thirdReader.id] = firstRead

      updatedEventIds.add(event.id)
      count++
    })

    // Add second reads by second user to 60% of events
    const eventsForSecondRead = clinic.events
      .filter((event) => updatedEventIds.has(event.id))
      .slice(0, Math.ceil(clinic.events.length * 0.6)) // Take 60% of events for second read

    baseReadTime = dayjs(generateRecentTimestamp(clinic.date, 12, 24)) // More recent timestamp for second reads

    eventsForSecondRead.forEach((event) => {
      const eventIndex = updatedEvents.findIndex((e) => e.id === event.id)
      if (eventIndex === -1) return

      // Get the first read
      const firstRead =
        updatedEvents[eventIndex].imageReading.reads[thirdReader.id]
      if (!firstRead) return

      // Second read (by second user) - 80% chance of agreement with first read
      // Determine second read opinion - 80% agree with first, 20% different
      const forceSecondOpinion =
        Math.random() > 0.8
          ? Object.keys(TAG_TO_RESULT)
              .map((t) => TAG_TO_RESULT[t])
              .filter((r) => r !== firstRead.opinion)[
              Math.floor(Math.random() * 2)
            ]
          : firstRead.opinion

      // Advance time by 1-2 minutes for each read
      baseReadTime = baseReadTime.add(
        1 + Math.floor(Math.random() * 2),
        'minute'
      )
      const secondReadTime = baseReadTime.toISOString()

      const secondRead = generateSingleRead(
        updatedEvents[eventIndex],
        secondReader.id,
        secondReader.role,
        secondReadTime,
        {
          forceOpinion: forceSecondOpinion,
          readNumber: 2,
          alignmentProbability
        }
      )
      updatedEvents[eventIndex].imageReading.reads[secondReader.id] = secondRead
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
        const firstReadTime = baseReadTime.toISOString()

        // First read (by first user/current user) - aligned with image set
        const firstRead = generateSingleRead(
          updatedEvents[eventIndex],
          firstReader.id,
          firstReader.role,
          firstReadTime,
          { readNumber: 1, alignmentProbability }
        )
        updatedEvents[eventIndex].imageReading.reads[firstReader.id] = firstRead

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
        const firstReadTime = baseReadTime.toISOString()

        // First read (by second user) - aligned with image set
        const firstRead = generateSingleRead(
          updatedEvents[eventIndex],
          secondReader.id,
          secondReader.role,
          firstReadTime,
          { readNumber: 1, alignmentProbability }
        )
        updatedEvents[eventIndex].imageReading.reads[secondReader.id] =
          firstRead

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
        const firstReadTime = baseReadTime.toISOString()

        // First read (by third user) - aligned with image set
        const firstRead = generateSingleRead(
          updatedEvents[eventIndex],
          thirdReader.id,
          thirdReader.role,
          firstReadTime,
          { readNumber: 1, alignmentProbability }
        )
        updatedEvents[eventIndex].imageReading.reads[thirdReader.id] = firstRead

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
