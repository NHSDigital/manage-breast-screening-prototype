// app/lib/generators/reading-generator.js

const dayjs = require('dayjs')
const weighted = require('weighted')
const { faker } = require('@faker-js/faker')
const { eligibleForReading } = require('../utils/status')
const { buildRead } = require('../utils/reading-cases')
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

// Normal opinion freetext reasons when participant has symptoms
const NORMAL_DETAILS_WITH_SYMPTOMS = [
  'Images reviewed carefully in the context of disclosed symptoms. No mammographic abnormality identified. Clinical follow-up recommended for symptoms.',
  'Thorough review of all views performed. No significant mammographic findings. Symptoms noted but no corresponding imaging abnormality detected.',
  'Normal mammographic appearance bilaterally. Symptoms have been considered in this assessment. No imaging correlate found.',
  'Careful assessment undertaken given disclosed symptoms. Mammographic appearances are within normal limits. Clinical assessment advised.',
  'No mammographic abnormality detected on careful review. Disclosed symptoms do not have a mammographic correlate. Recommend clinical follow-up.'
]

// Normal opinion freetext reasons without symptoms (used for a small proportion)
const NORMAL_DETAILS_WITHOUT_SYMPTOMS = [
  'Normal mammogram. No significant findings.',
  'Bilateral mammograms reviewed. No abnormality detected.',
  'Normal appearances. Good quality images.',
  'No abnormality identified on careful review of all images.',
  'Normal bilateral mammographic study.'
]

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
 * @param {object} appointment - The appointment being read
 * @param {string} readerId - The reader's user ID
 * @param {string} readerType - The reader's role
 * @param {string} timestamp - ISO timestamp for the read
 * @param {object} [options] - Generation options
 * @param {boolean} [options.forceAlignment] - Force alignment with set (ignore probability)
 * @param {string} [options.forceOpinion] - Force a specific opinion type
 * @returns {object} The generated read object
 */
const generateSingleRead = (
  appointment,
  readerId,
  readerType,
  timestamp,
  options = {}
) => {
  const setId = appointment.mammogramData?.selectedSetId
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

  // Build base read object. readNumber and readType are settled by buildRead,
  // from where the case had got to when the read was made
  const read = {
    opinion,
    readerId,
    readerType,
    timestamp
  }

  // Add opinion-specific data
  if (opinion === 'normal') {
    // Normal reads - per-breast assessment, plus optional freetext reasoning
    read.left = { breastAssessment: 'normal' }
    read.right = { breastAssessment: 'normal' }

    const hasSymptoms = appointment.medicalInformation?.symptoms?.length > 0
    if (hasSymptoms) {
      // Always provide a reason when participant has symptoms
      read.normalDetails = faker.helpers.arrayElement(
        NORMAL_DETAILS_WITH_SYMPTOMS
      )
    } else if (Math.random() < 0.1) {
      // 10% of non-symptom normal reads include optional freetext
      read.normalDetails = faker.helpers.arrayElement(
        NORMAL_DETAILS_WITHOUT_SYMPTOMS
      )
    }
  } else if (opinion === 'technical_recall') {
    // Technical recall - determine which views need retaking
    read.technicalRecall = generateTechnicalRecallData(appointment, set)
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
    const { left, right } = generateAbnormalData(appointment, set)
    read.left = left
    read.right = right
  }

  return read
}

/**
 * Generate technical recall data based on set metadata
 */
const generateTechnicalRecallData = (appointment, set) => {
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
const generateAbnormalData = (appointment, set) => {
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
          abnormalityTypes: Array.isArray(annotation.abnormalityType)
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
  const abnormalityTypes = require('../../data/abnormality-types').filter(
    (t) => t !== 'Other'
  )

  // Use finding from set if available
  let abnormalityType = faker.helpers.arrayElement(abnormalityTypes)
  if (breastData?.finding) {
    const findingMap = {
      'mass': 'Mass well-defined',
      'calcification': 'Microcalcification',
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
    abnormalityTypes: [abnormalityType],
    levelOfConcern: faker.helpers.arrayElement(['3', '4', '5']),
    positions,
    comment: ''
  }
}

/**
 * Add a generated read to a case.
 *
 * Mutates the case: episodes are ordinary objects during generation, and only
 * become shared read-only data once they're loaded into the store.
 *
 * @param {object} readingCase - The case being read
 * @param {object} appointment - The appointment whose images these are
 * @param {object} reader - The reader (a user record)
 * @param {string} timestamp - ISO timestamp for the read
 * @param {object} [options] - Options passed through to generateSingleRead
 * @returns {object} The read that was added
 */
const addRead = (readingCase, appointment, reader, timestamp, options = {}) => {
  const generated = generateSingleRead(
    appointment,
    reader.id,
    reader.role,
    timestamp,
    options
  )

  // buildRead settles readNumber and readType from where the case had got to
  const read = buildRead(readingCase, reader.id, reader.role, generated, {
    timestamp
  })

  const existingIndex = readingCase.reads.findIndex(
    (candidate) => candidate.readerId === reader.id
  )
  if (existingIndex >= 0) {
    readingCase.reads[existingIndex] = read
  } else {
    readingCase.reads.push(read)
  }

  return read
}

/**
 * Pick an opinion for a second read: usually agreeing with the first, sometimes
 * not, so some cases land in arbitration.
 *
 * @param {object} firstRead - The first read
 * @param {number} [agreementProbability] - Chance of agreeing
 * @returns {string} The opinion to force
 */
const pickSecondOpinion = (firstRead, agreementProbability = 0.8) => {
  if (Math.random() <= agreementProbability) return firstRead.opinion

  const otherOpinions = [...new Set(Object.values(TAG_TO_RESULT))].filter(
    (opinion) => opinion !== firstRead.opinion
  )

  return faker.helpers.arrayElement(otherOpinions)
}

/**
 * Apply reads when a backlogLimit is set.
 *
 * All eligible cases except the last `backlogLimit` are fully read (2 reads
 * by non-current users). Of the remaining `backlogLimit` cases:
 *   - The first `floor(backlogLimit × partialReadRatio)` get 1 read by the
 *     current user (so the second read is still available to someone else)
 *   - The rest get no reads (first read available to the current user)
 *
 * @param {Array} eligibleAppointments - Appointments eligible for reading
 * @param {Map} casesByAppointmentId - Reading cases, keyed by appointment id
 * @param {object} readers - { firstReader, secondReader, thirdReader }
 * @param {object} options - { backlogLimit, backlogPartialReadRatio, alignmentProbability }
 */
const generateReadingDataWithBacklogLimit = (
  eligibleAppointments,
  casesByAppointmentId,
  { firstReader, secondReader, thirdReader },
  { backlogLimit, backlogPartialReadRatio, alignmentProbability }
) => {
  // Sort oldest first so the oldest cases become fully read (they appear in history)
  const sorted = [...eligibleAppointments].sort(
    (a, b) => new Date(a.timing.startTime) - new Date(b.timing.startTime)
  )

  // Appointments with pending or requested priors cannot realistically have been read —
  // they must remain unread regardless of the backlog limit. Exclude them from
  // the fully-read and partially-read groups so that resolving the priors later
  // actually makes them available to read.
  const hasBlockingPriors = (appointment) =>
    Array.isArray(appointment.previousMammograms) &&
    appointment.previousMammograms.some(
      (m) => m.requestStatus === 'pending' || m.requestStatus === 'requested'
    )

  const sortedReadable = sorted.filter((e) => !hasBlockingPriors(e))
  const blockedByPriorsAppointments = sorted.filter(hasBlockingPriors)

  const clampedLimit = Math.min(backlogLimit, sortedReadable.length)
  const fullyReadAppointments = sortedReadable.slice(0, sortedReadable.length - clampedLimit)
  const backlogAppointments = sortedReadable.slice(sortedReadable.length - clampedLimit)
  const partialCount = Math.floor(
    backlogAppointments.length * backlogPartialReadRatio
  )
  const partialAppointments = backlogAppointments.slice(0, partialCount)
  const unreadAppointments = backlogAppointments.slice(partialCount)

  console.log(
    `Backlog limit: ${backlogLimit} cases — ` +
      `${fullyReadAppointments.length} fully read, ` +
      `${partialAppointments.length} partially read, ` +
      `${unreadAppointments.length} unread, ` +
      `${blockedByPriorsAppointments.length} unread (awaiting priors)`
  )

  let baseTime = dayjs().subtract(72, 'hours')

  // Fully read: 2 reads by secondReader and thirdReader
  fullyReadAppointments.forEach((appointment) => {
    const readingCase = casesByAppointmentId.get(appointment.id)
    if (!readingCase) return

    baseTime = baseTime.add(1, 'minute')

    const firstRead = addRead(
      readingCase,
      appointment,
      secondReader,
      baseTime.toISOString(),
      { alignmentProbability }
    )

    addRead(
      readingCase,
      appointment,
      thirdReader,
      baseTime.add(15, 'minutes').toISOString(),
      { forceOpinion: firstRead.opinion, alignmentProbability }
    )
  })

  baseTime = dayjs().subtract(24, 'hours')

  // Partially read: 1 read by firstReader (the current user) — so the current
  // user has already read these and cannot read them again
  partialAppointments.forEach((appointment) => {
    const readingCase = casesByAppointmentId.get(appointment.id)
    if (!readingCase) return

    baseTime = baseTime.add(1, 'minute')
    addRead(readingCase, appointment, firstReader, baseTime.toISOString(), {
      alignmentProbability
    })
  })

  // Unread appointments: no reads added
}

/**
 * Generate sample reading data to simulate first and second reads.
 *
 * Reads are written onto the episode's reading cases, so the cases must already
 * exist — syncEpisodeReadingCases runs over the episodes before this does.
 *
 * @param {Array} appointments - Array of screening appointments
 * @param {Array} users - Array of system users
 * @param {Array} episodes - Array of episodes, holding the reading cases
 * @param {object} [seedProfile] - Active seed profile
 */
const generateReadingData = (appointments, users, episodes, seedProfile = {}) => {
  const alignmentProbability =
    seedProfile?.imageReading?.probabilityFirstReaderOpinionMatchesImages ??
    DEFAULT_ALIGNMENT_PROBABILITY
  if (!appointments || !appointments.length || !users || users.length < 2) {
    console.log('No appointments or not enough users to generate reading data')
    return
  }

  // Every case, keyed by the appointment whose images it covers
  const casesByAppointmentId = new Map()
  episodes.forEach((episode) => {
    ;(episode.readingCases || []).forEach((readingCase) => {
      casesByAppointmentId.set(readingCase.appointmentId, readingCase)
    })
  })

  // Use the first, second, and third users as our readers
  const firstReader = users[0]
  const secondReader = users[1]
  const thirdReader = users[2]

  console.log(
    `Generating reading data using ${firstReader.firstName} ${firstReader.lastName}, ${secondReader.firstName} ${secondReader.lastName}, and ${thirdReader.firstName} ${thirdReader.lastName} as readers`
  )

  const recentAppointments = appointments.filter((appointment) => eligibleForReading(appointment))

  // If a backlog limit is set, use a simplified reading pattern instead of the
  // default clinic-by-clinic pattern. backlogLimit=0 means empty backlog.
  const backlogLimit = seedProfile?.reading?.backlogLimit ?? null
  if (backlogLimit !== null) {
    generateReadingDataWithBacklogLimit(
      recentAppointments,
      casesByAppointmentId,
      { firstReader, secondReader, thirdReader },
      {
        backlogLimit,
        backlogPartialReadRatio:
          seedProfile?.reading?.backlogPartialReadRatio ?? 0.5,
        alignmentProbability
      }
    )
    return
  }

  // Sort by date (oldest first)
  const sortedAppointments = [...recentAppointments].sort(
    (a, b) => new Date(a.timing.startTime) - new Date(b.timing.startTime)
  )

  if (sortedAppointments.length === 0) {
    console.log('No recent completed appointments to add reading data to')
    return
  }

  // Group appointments by clinic
  const appointmentsByClinic = {}
  sortedAppointments.forEach((appointment) => {
    if (!appointmentsByClinic[appointment.clinicId]) {
      appointmentsByClinic[appointment.clinicId] = []
    }
    appointmentsByClinic[appointment.clinicId].push(appointment)
  })

  // Get clinics sorted by date (oldest first)
  const clinics = Object.keys(appointmentsByClinic)
    .map((clinicId) => ({
      id: clinicId,
      appointments: appointmentsByClinic[clinicId],
      date: appointmentsByClinic[clinicId][0].timing.startTime
    }))
    .sort((a, b) => new Date(a.id) - new Date(b.id)) // Some clinics share the same date so sort first by a unique ID to keep consistent sort
    .sort((a, b) => new Date(a.date) - new Date(b.date))

  console.log(
    `Found ${clinics.length} clinics with completed appointments in the last 30 days`
  )

  // Track which appointments have been dealt with, so later passes skip them
  const readAppointmentIds = new Set()

  // Function to generate a recent timestamp (within past 7 days)
  const generateRecentTimestamp = (minHours = 2, maxHours = 36) => {
    const hoursAgo =
      Math.floor(Math.random() * (maxHours - minHours)) + minHours
    return dayjs().subtract(hoursAgo, 'hours').toISOString()
  }

  /**
   * Walk a clinic's appointments, giving each one a read, and note them as done
   *
   * @param {object} clinic - Clinic with its appointments
   * @param {object} reader - Who is reading
   * @param {object} [options] - Options
   * @param {dayjs.Dayjs} options.startTime - Time of the first read
   * @param {Array} [options.only] - Restrict to these appointments
   * @param {boolean} [options.skipAlreadyRead] - Leave dealt-with appointments alone
   * @returns {number} How many reads were added
   */
  const readClinic = (clinic, reader, options = {}) => {
    const { startTime, only = null, skipAlreadyRead = true } = options
    let baseReadTime = startTime
    let count = 0

    const candidates = only || clinic.appointments

    candidates.forEach((appointment) => {
      if (skipAlreadyRead && readAppointmentIds.has(appointment.id)) return

      const readingCase = casesByAppointmentId.get(appointment.id)
      if (!readingCase) return

      baseReadTime = baseReadTime.add(1, 'minute')
      addRead(readingCase, appointment, reader, baseReadTime.toISOString(), {
        alignmentProbability
      })

      readAppointmentIds.add(appointment.id)
      count++
    })

    return count
  }

  // TWO OLDEST CLINICS: complete first and second reads
  if (clinics.length >= 2) {
    let count = 0

    for (let i = 0; i < 2 && i < clinics.length; i++) {
      const clinic = clinics[i]
      console.log(
        `Adding complete first and second reads to clinic ${clinic.id}`
      )

      // Use the same base time for all reads in this clinic, then advance by 1 minute for each appointment
      let baseReadTime = dayjs(generateRecentTimestamp(48, 72))

      clinic.appointments.forEach((appointment) => {
        const readingCase = casesByAppointmentId.get(appointment.id)
        if (!readingCase) return

        baseReadTime = baseReadTime.add(1, 'minute')

        // First read by the second user, aligned with the image set
        const firstRead = addRead(
          readingCase,
          appointment,
          secondReader,
          baseReadTime.toISOString(),
          { alignmentProbability }
        )

        // Second read by the current user, usually agreeing with the first
        const secondReadTime = baseReadTime
          .add(Math.floor(Math.random() * 16) + 15, 'minutes')
          .toISOString()

        addRead(readingCase, appointment, firstReader, secondReadTime, {
          forceOpinion: pickSecondOpinion(firstRead),
          alignmentProbability
        })

        readAppointmentIds.add(appointment.id)
        count++
      })
    }

    console.log(
      `Added first and second reads to ${count} appointments in the 2 oldest clinics`
    )
  }

  // NEXT CLINIC: both reads completed, but neither by the current user
  if (clinics.length >= 3) {
    const clinic = clinics[2]
    console.log(
      `Adding a clinic with both reads completed by users other than current user to clinic ${clinic.id}`
    )

    const count = readClinic(clinic, thirdReader, {
      startTime: dayjs(generateRecentTimestamp(30, 48))
    })

    // Second reads by the second user on 60% of them
    const appointmentsForSecondRead = clinic.appointments
      .filter((appointment) => readAppointmentIds.has(appointment.id))
      .slice(0, Math.ceil(clinic.appointments.length * 0.6))

    let baseReadTime = dayjs(generateRecentTimestamp(12, 24)) // More recent than the first reads

    appointmentsForSecondRead.forEach((appointment) => {
      const readingCase = casesByAppointmentId.get(appointment.id)
      const firstRead = readingCase?.reads?.[0]
      if (!firstRead) return

      baseReadTime = baseReadTime.add(
        1 + Math.floor(Math.random() * 2),
        'minute'
      )

      addRead(
        readingCase,
        appointment,
        secondReader,
        baseReadTime.toISOString(),
        { forceOpinion: pickSecondOpinion(firstRead), alignmentProbability }
      )
    })

    console.log(
      `Added a clinic with ${count} first reads and ${appointmentsForSecondRead.length} second reads, both done by users other than current user`
    )
  }

  // NEXT TWO CLINICS: current user reads all first, but no second reads
  if (clinics.length >= 5) {
    let count = 0
    for (let i = 3; i < 5 && i < clinics.length; i++) {
      const clinic = clinics[i]
      console.log(`Adding first reads by current user to clinic ${clinic.id}`)
      count += readClinic(clinic, firstReader, {
        startTime: dayjs(generateRecentTimestamp(12, 36))
      })
    }
    console.log(
      `Added first reads by current user to ${count} appointments in the next 2 clinics`
    )
  }

  // NEXT TWO CLINICS: second user reads all first, waiting on the current user
  if (clinics.length >= 7) {
    let count = 0
    for (let i = 5; i < 7 && i < clinics.length; i++) {
      const clinic = clinics[i]
      console.log(`Adding first reads by second user to clinic ${clinic.id}`)
      count += readClinic(clinic, secondReader, {
        startTime: dayjs(generateRecentTimestamp(4, 24))
      })
    }
    console.log(
      `Added first reads by second user to ${count} appointments in the next 2 clinics`
    )
  }

  // NEXT TWO CLINICS: 75% first read by the third user
  if (clinics.length >= 9) {
    let count = 0
    for (let i = 7; i < 9 && i < clinics.length; i++) {
      const clinic = clinics[i]
      console.log(`Adding partial first reads to clinic ${clinic.id}`)

      // Only read 75% of the appointments in these clinics
      const appointmentsToRead = clinic.appointments
        .filter((appointment) => !readAppointmentIds.has(appointment.id))
        .slice(0, Math.ceil(clinic.appointments.length * 0.75))

      count += readClinic(clinic, thirdReader, {
        startTime: dayjs(generateRecentTimestamp(1, 12)),
        only: appointmentsToRead
      })
    }
    console.log(
      `Added partial first reads to ${count} appointments in the next 2 clinics`
    )
  }

  console.log(`Total appointments with reading data: ${readAppointmentIds.size}`)
}

module.exports = {
  generateReadingData,
  generateSingleRead
}
