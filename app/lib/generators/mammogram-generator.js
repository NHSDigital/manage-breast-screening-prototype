// app/lib/generators/mammogram-generator.js

const { faker } = require('@faker-js/faker')
const dayjs = require('dayjs')
const weighted = require('weighted')
const REPEAT_REASONS = require('../../data/repeat-reasons')

// Reasons for incomplete mammography - matches the options in additional-image-details.njk
const INCOMPLETE_MAMMOGRAPHY_REASONS = [
  'Consent withdrawn',
  'Language or learning difficulties',
  'Unable to scan tissue',
  'Positioning difficulties due to wheelchair',
  'Positioning difficulties for other mobility reasons',
  'Technical issues',
  'Other'
]

// Follow-up appointment options
const INCOMPLETE_MAMMOGRAPHY_FOLLOW_UP_OPTIONS = [
  "Yes, record as 'to be recalled'",
  "No, record as 'partial mammography'"
]

const STANDARD_VIEWS = [
  { side: 'right', view: 'mediolateral oblique' },
  { side: 'right', view: 'craniocaudal' },
  { side: 'left', view: 'craniocaudal' },
  { side: 'left', view: 'mediolateral oblique' }
]

// Image scenarios - mutually exclusive categories
// - standard: 4 views, 1 image each (normal case)
// - extraImages: 2 images per view (large breasts - not a problem, just needed for coverage)
// - technicalRepeat: 1-2 views have a repeat due to technical issues
// - incomplete: 1 view is missing (participant couldn't complete)
// - incompleteImperfect: missing view + marked as imperfect
const IMAGE_SCENARIO_WEIGHTS = {
  standard: 0.7,
  extraImages: 0.1,
  technicalRepeat: 0.1,
  incomplete: 0.07,
  incompleteImperfect: 0.03
}

const generateViewKey = (side, view) => {
  const prefix = side === 'right' ? 'right' : 'left'
  const viewName =
    view === 'mediolateral oblique' ? 'MediolateralOblique' : 'Craniocaudal'
  return `${prefix}${viewName}`
}

const generateImageUrl = (side, view, accessionNumber) => {
  const sideCode = side === 'right' ? 'R' : 'L'
  const viewCode = view === 'mediolateral oblique' ? 'MLO' : 'CC'
  return `/images/mammograms/${sideCode}-${viewCode}-${accessionNumber.replace('/', '-')}.dcm`
}

/**
 * Generate images for a single view
 *
 * @param {object} params - Parameters for image generation
 * @param {string} params.side - Breast side ('right' or 'left')
 * @param {string} params.view - View type ('mediolateral oblique' or 'craniocaudal')
 * @param {string} params.accessionBase - Base accession number
 * @param {number} params.startIndex - Starting index for image numbering
 * @param {string} params.startTime - Start timestamp
 * @param {boolean} params.isSeedData - Whether generating seed data
 * @param {number} [params.extraCount] - Number of extra images needed (large breasts)
 * @param {boolean} [params.needsRepeat] - Whether this view needs a repeat (technical issue)
 * @returns {object} View data with images
 */
const generateViewImages = ({
  side,
  view,
  accessionBase,
  startIndex,
  startTime,
  isSeedData,
  extraCount = 0,
  needsRepeat = false
}) => {
  let currentIndex = startIndex
  let currentTime = dayjs(startTime)
  const images = []

  // Generate initial image
  images.push({
    timestamp: currentTime.toISOString(),
    accessionNumber: `${accessionBase}/${currentIndex}`,
    url: generateImageUrl(side, view, `${accessionBase}/${currentIndex}`)
  })

  // Generate extra images if needed (large breasts - not a problem)
  for (let i = 0; i < extraCount; i++) {
    currentIndex++
    currentTime = currentTime.add(
      faker.number.int({ min: 25, max: 50 }),
      'seconds'
    )
    images.push({
      timestamp: currentTime.toISOString(),
      accessionNumber: `${accessionBase}/${currentIndex}`,
      url: generateImageUrl(side, view, `${accessionBase}/${currentIndex}`)
    })
  }

  // Generate repeat if needed (technical issue)
  if (needsRepeat) {
    currentIndex++
    currentTime = currentTime.add(
      faker.number.int({ min: 25, max: 50 }),
      'seconds'
    )

    images.push({
      timestamp: currentTime.toISOString(),
      accessionNumber: `${accessionBase}/${currentIndex}`,
      url: generateImageUrl(side, view, `${accessionBase}/${currentIndex}`)
    })
  }

  // Calculate counts
  // repeatCount = number of images that were technical repeats
  // extraCount passed in = additional images for coverage (not a problem)
  const repeatCount = needsRepeat ? 1 : 0

  return {
    side,
    view,
    viewShort: view === 'mediolateral oblique' ? 'MLO' : 'CC',
    viewShortWithSide: `${side === 'right' ? 'R' : 'L'}${view === 'mediolateral oblique' ? 'MLO' : 'CC'}`,
    images,
    count: images.length,
    repeatCount,
    repeatReasons:
      needsRepeat && isSeedData
        ? [faker.helpers.arrayElement(REPEAT_REASONS)]
        : null
  }
}

/**
 * Generate a complete set of mammogram images
 *
 * @param {object} [options] - Generation options
 * @param {Date|string} [options.startTime] - Starting timestamp (defaults to now)
 * @param {boolean} [options.isSeedData] - Whether generating seed data
 * @param {object} [options.config] - Optional configuration for specific scenarios
 * @param {string} [options.config.scenario] - Force a specific scenario ('standard', 'extraImages', 'technicalRepeat', 'incomplete', 'incompleteImperfect')
 * @param {string[]} [options.config.repeatViews] - Array of views to repeat (e.g. ['RMLO', 'LCC'])
 * @param {string[]} [options.config.missingViews] - Array of views to omit (e.g. ['RMLO'])
 * @param {boolean} [options.config.allViewsExtra] - If true, all views get extra images
 * @returns {object} Complete mammogram data
 */
const generateMammogramImages = ({
  startTime = new Date(),
  isSeedData = false,
  config = {}
} = {}) => {
  const accessionBase = faker.number
    .int({ min: 100000000, max: 999999999 })
    .toString()
  let currentIndex = 1
  let currentTime = dayjs(startTime)
  const views = {}

  // Select scenario (use config override or random weighted selection)
  const scenario = config.scenario || weighted.select(IMAGE_SCENARIO_WEIGHTS)

  // Determine view configuration based on scenario
  let viewsToRepeat = config.repeatViews || []
  let viewsMissing = config.missingViews || []
  let allViewsExtra = config.allViewsExtra || false

  switch (scenario) {
    case 'extraImages':
      // All views get 2 images (large breasts)
      allViewsExtra = true
      break

    case 'technicalRepeat':
      // 1-2 views get a repeat
      if (!config.repeatViews) {
        const repeatCount = faker.number.int({ min: 1, max: 2 })
        viewsToRepeat = faker.helpers.arrayElements(
          ['RMLO', 'RCC', 'LCC', 'LMLO'],
          { min: repeatCount, max: repeatCount }
        )
      }
      break

    case 'incomplete':
    case 'incompleteImperfect':
      // 1 view is missing
      if (!config.missingViews) {
        viewsMissing = [
          faker.helpers.arrayElement(['RMLO', 'RCC', 'LCC', 'LMLO'])
        ]
      }
      break

    case 'standard':
    default:
      // Standard 4 views, 1 image each - no special configuration needed
      break
  }

  // Generate each standard view
  STANDARD_VIEWS.forEach(({ side, view }) => {
    const viewKey = generateViewKey(side, view)
    const viewShortWithSide = `${side === 'right' ? 'R' : 'L'}${view === 'mediolateral oblique' ? 'MLO' : 'CC'}`

    // Skip if this view is in missingViews
    if (viewsMissing.includes(viewShortWithSide)) {
      return
    }

    const viewData = generateViewImages({
      side,
      view,
      accessionBase,
      startIndex: currentIndex,
      startTime: currentTime.toISOString(),
      isSeedData,
      extraCount: allViewsExtra ? 1 : 0,
      needsRepeat: viewsToRepeat.includes(viewShortWithSide)
    })

    views[viewKey] = viewData

    // Update counters for next view
    currentIndex += viewData.images.length
    currentTime = currentTime.add(
      faker.number.int({ min: 45, max: 70 }),
      'seconds'
    )
  })

  // Calculate metadata
  const totalImages = Object.values(views).reduce(
    (sum, view) => sum + view.images.length,
    0
  )

  // Calculate images per breast
  const rightBreastImages = Object.values(views)
    .filter((view) => view.side === 'right')
    .reduce((sum, view) => sum + view.images.length, 0)

  const leftBreastImages = Object.values(views)
    .filter((view) => view.side === 'left')
    .reduce((sum, view) => sum + view.images.length, 0)

  const allTimestamps = Object.values(views)
    .flatMap((view) => view.images.map((img) => img.timestamp))
    .sort()

  // Calculate boolean flags for metadata
  // hasAdditionalImages: true if any view has count > 1
  const hasAdditionalImages = Object.values(views).some(
    (view) => view.count > 1
  )

  // hasRepeat: true if any view has repeatCount > 0 (technical issue)
  const hasRepeat = Object.values(views).some((view) => view.repeatCount > 0)

  // hasExtraImages: true if additional images exist that are NOT repeats (large breasts)
  // This is true when we have additional images but they're not all repeats
  const hasExtraImages = Object.values(views).some((view) => {
    const additionalCount = view.count - 1
    const extraCount = additionalCount - (view.repeatCount || 0)
    return extraCount > 0
  })

  // Check if any views are missing
  const hasMissingViews = Object.keys(views).length < 4

  // Generate incomplete mammography data if views are missing and this is seed data
  let incompleteMammographyData = {}
  if (isSeedData && hasMissingViews) {
    const reason = faker.helpers.arrayElement(INCOMPLETE_MAMMOGRAPHY_REASONS)
    const followUp = weighted.select({
      "Yes, record as 'to be recalled'": 0.4,
      "No, record as 'partial mammography'": 0.6
    })

    incompleteMammographyData = {
      isIncompleteMammography: ['yes'],
      incompleteMammographyReasons: [reason],
      incompleteMammographyFollowUpAppointment: followUp
    }

    // Add optional details for 'Other' reason or randomly for some cases
    if (reason === 'Other' || Math.random() < 0.3) {
      incompleteMammographyData.incompleteMammographyReasonDetails =
        faker.helpers.arrayElement([
          'Participant became unwell during the appointment',
          'Equipment malfunction prevented completion',
          'Participant had to leave urgently',
          'Severe pain prevented further imaging',
          'Implants made positioning very difficult'
        ])
    }

    // Add details if follow-up is YES
    if (followUp === "Yes, record as 'to be recalled'") {
      incompleteMammographyData.incompleteMammographyFollowUpAppointmentDetails =
        faker.helpers.arrayElement([
          'Participant has a shoulder injury that should heal in 4-6 weeks.',
          'Recent surgery - needs 3 months recovery before rebooking',
          'Mobility issues - suggest booking at hospital site with better accessibility',
          'Chest infection - rebook when recovered',
          'Arm in a cast - expected to be removed in 2 weeks'
        ])
    }
  }

  // Generate imperfect but best possible data
  // Only for incompleteImperfect scenario, or randomly for technicalRepeat/incomplete
  // Never for extraImages (large breasts) or standard
  let imperfectData = {}
  if (isSeedData) {
    if (scenario === 'incompleteImperfect') {
      imperfectData.isImperfectButBestPossible = ['yes']
    } else if (
      (scenario === 'technicalRepeat' || scenario === 'incomplete') &&
      Math.random() < 0.15
    ) {
      imperfectData.isImperfectButBestPossible = ['yes']
    }
  }

  // Generate notes for reader
  // Used for imperfect images to explain why, or occasionally for other reasons
  let notesData = {}
  if (isSeedData) {
    if (imperfectData.isImperfectButBestPossible) {
      notesData.notesForReader = faker.helpers.arrayElement([
        'Patient found positioning difficult due to shoulder pain',
        'Kyphosis made positioning challenging',
        'Ideally would have got more tissue but patient unable to tolerate',
        'Skin folds present due to weight loss',
        'Best possible images achieved'
      ])
    } else if (Math.random() < 0.05) {
      notesData.notesForReader = faker.helpers.arrayElement([
        'Mole on right breast',
        'Pacemaker present',
        'Previous surgery scars noted',
        'Patient anxious but compliant'
      ])
    }
  }

  return {
    accessionBase,
    views,
    ...incompleteMammographyData,
    ...imperfectData,
    ...notesData,
    metadata: {
      totalImages,
      standardViewsCompleted: Object.keys(views).length === 4,
      startTime: allTimestamps[0],
      endTime: allTimestamps[allTimestamps.length - 1],
      hasAdditionalImages,
      hasRepeat,
      hasExtraImages,
      imagesByBreast: {
        right: rightBreastImages,
        left: leftBreastImages
      }
    }
  }
}

module.exports = {
  generateMammogramImages,
  STANDARD_VIEWS,
  REPEAT_REASONS,
  IMAGE_SCENARIO_WEIGHTS
}
