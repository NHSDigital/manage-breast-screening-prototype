// app/lib/utils/expected-views.js

const { formatList } = require('./arrays')
const { isMedicalHistoryItemRemoved } = require('./medical-information')
const {
  MASTECTOMY_HISTORY_TYPES,
  getMastectomyHeading
} = require('./mastectomy')

// The 4 views in a standard set, using the viewShortWithSide codes
const STANDARD_VIEW_CODES = ['RCC', 'RMLO', 'LCC', 'LMLO']

// Breasts each mastectomy imaging answer allows images of
const IMAGED_SIDES = {
  Right: ['right'],
  Left: ['left'],
  Both: ['right', 'left'],
  None: []
}

const getViewSide = (code) => (code.startsWith('R') ? 'right' : 'left')

const getViewsForSides = (sides) =>
  STANDARD_VIEW_CODES.filter((code) => sides.includes(getViewSide(code)))

/**
 * Describe a mammogram view code in words
 *
 * @param {string} code - A view code such as RCC or LMLO
 * @returns {string} For example 'right CC' or 'left MLO'
 * @example
 * {{ "RMLO" | describeViewCode }}
 */
const describeViewCode = (code) =>
  `${getViewSide(code)} ${String(code).slice(1)}`

/**
 * Summarise a list of expected views for an inset or hint
 *
 * @param {Array<string>} views - View codes
 * @returns {string} For example 'Left breast images only' or 'Right MLO images only'
 */
const summariseViews = (views) => {
  if (views.length === STANDARD_VIEW_CODES.length) return 'Both breasts'
  if (views.length === 0) return 'No images'

  for (const side of ['right', 'left']) {
    const sideViews = getViewsForSides([side])
    if (
      views.length === sideViews.length &&
      sideViews.every((code) => views.includes(code))
    ) {
      return `${side === 'right' ? 'Right' : 'Left'} breast images only`
    }
  }

  const text = formatList(views.map(describeViewCode))
  return `${capitalise(text)} images only`
}

const capitalise = (text) => `${text.charAt(0).toUpperCase()}${text.slice(1)}`

// Heading for a reason, focused on the procedure
const describeReasonHeading = (reason) =>
  reason.type === 'technicalRecall'
    ? 'Technical recall'
    : getMastectomyHeading(capitalise(reason.side))

const describeReason = (reason) => {
  if (reason.type === 'technicalRecall') return 'technical recall'
  return reason.side === 'both'
    ? 'bilateral mastectomy'
    : `${reason.side} breast mastectomy`
}

// Mastectomy items that record which breasts to image, ignoring any removed
const getMastectomyImagingItems = (medicalHistory) =>
  MASTECTOMY_HISTORY_TYPES.flatMap((type) => medicalHistory?.[type] || [])
    .filter((item) => !isMedicalHistoryItemRemoved(item))
    .filter(
      (item) =>
        ['Right', 'Left', 'Both'].includes(item.mastectomyImagingFor) &&
        Object.keys(IMAGED_SIDES).includes(item.mastectomyImagingSide)
    )

/**
 * Work out which mammogram views an appointment is expected to produce, and why
 *
 * Expected views are derived, not stored. In order:
 * 1. `appointment.requestedViews`, for a technical recall
 * 2. The mastectomy imaging answers in the appointment's medical history.
 *    Several combine to the breasts all of them allow
 * 3. Otherwise all 4 standard views
 *
 * The views actually taken are always the record. A mammographer can take a
 * view that isn't expected.
 *
 * @param {object} appointment - The appointment (or its working copy)
 * @returns {{views: Array<string>, isStandardSet: boolean, reasons: Array<object>, summary: string, heading: string, viewsText: string, reasonText: string, description: string, shortReason: string}}
 * `views` are codes in standard order. `reasons` are `{ type: 'mastectomy', side }`
 * or `{ type: 'technicalRecall' }`. `summary` is for example 'Left breast images only',
 * `viewsText` 'LCC and LMLO', `heading` 'Unilateral mastectomy (right)', `reasonText` 'right breast mastectomy',
 * `description` 'Left breast images only (right breast mastectomy)' and
 * `shortReason` 'Mastectomy'. Text fields are '' for a standard set.
 * @example
 * {% set expectedViews = appointment | getExpectedViews %}
 * {% if not expectedViews.isStandardSet %}{{ expectedViews.summary }}{% endif %}
 */
const getExpectedViews = (appointment) => {
  let views
  let reasons = []

  const requestedViews = [].concat(appointment?.requestedViews || [])
  if (requestedViews.length) {
    views = STANDARD_VIEW_CODES.filter((code) => requestedViews.includes(code))
    reasons = [{ type: 'technicalRecall' }]
  } else {
    const items = getMastectomyImagingItems(
      appointment?.medicalInformation?.medicalHistory
    )
    let sides = ['right', 'left']
    items.forEach((item) => {
      const imagedSides = IMAGED_SIDES[item.mastectomyImagingSide]
      if (imagedSides.length < 2) {
        sides = sides.filter((side) => imagedSides.includes(side))
        reasons.push({
          type: 'mastectomy',
          side: item.mastectomyImagingFor.toLowerCase()
        })
      }
    })
    views = getViewsForSides(sides)
  }

  const isStandardSet = views.length === STANDARD_VIEW_CODES.length
  // A bilateral mastectomy covers any one-sided mastectomy
  const hasBilateralMastectomy = reasons.some(
    (reason) => reason.type === 'mastectomy' && reason.side === 'both'
  )
  const reasonsToDescribe = reasons.filter(
    (reason) =>
      !hasBilateralMastectomy ||
      reason.type !== 'mastectomy' ||
      reason.side === 'both'
  )
  const reasonTexts = [...new Set(reasonsToDescribe.map(describeReason))]
  const reasonHeadings = [
    ...new Set(reasonsToDescribe.map(describeReasonHeading))
  ]

  return {
    views,
    isStandardSet,
    reasons,
    summary: isStandardSet ? '' : summariseViews(views),
    viewsText: isStandardSet ? '' : formatList(views),
    heading: isStandardSet ? '' : formatList(reasonHeadings),
    reasonText: isStandardSet ? '' : formatList(reasonTexts),
    description: isStandardSet
      ? ''
      : `${summariseViews(views)} (${formatList(reasonTexts)})`,
    shortReason:
      isStandardSet || !reasons.length
        ? ''
        : reasons[0].type === 'technicalRecall'
          ? 'Technical recall'
          : 'Mastectomy'
  }
}

/**
 * Get the codes of the views taken in a set of mammogram data
 *
 * @param {object} mammogramData - Appointment mammogram data
 * @returns {Array<string>} Standard view codes with at least one image
 */
const getTakenViews = (mammogramData) =>
  Object.values(mammogramData?.views || {})
    .filter((view) => (view.count ?? view.images?.length ?? 1) > 0)
    .map((view) => view.viewShortWithSide)
    .filter((code) => STANDARD_VIEW_CODES.includes(code))

/**
 * Compare the views taken with the views expected, for each of the 4 standard views
 *
 * States:
 * - `taken`: has images, whether expected or not
 * - `missing`: expected but has no images
 * - `notExpected`: not expected and has no images. Not a problem
 *
 * @param {object} appointment - The appointment (or its working copy)
 * @param {object} [mammogramData] - Mammogram data to compare, defaults to the appointment's
 * @returns {Object<string, {code: string, side: string, isExpected: boolean, isTaken: boolean, state: string}>}
 * Keyed by view code
 * @example
 * {% set viewStates = appointment | getExpectedViewStates %}
 * {% if viewStates.RCC.state == "notExpected" %}Not expected{% endif %}
 */
const getExpectedViewStates = (appointment, mammogramData) => {
  const { views } = getExpectedViews(appointment)
  const takenViews = getTakenViews(mammogramData ?? appointment?.mammogramData)

  return Object.fromEntries(
    STANDARD_VIEW_CODES.map((code) => {
      const isExpected = views.includes(code)
      const isTaken = takenViews.includes(code)
      const state = isTaken ? 'taken' : isExpected ? 'missing' : 'notExpected'
      return [
        code,
        { code, side: getViewSide(code), isExpected, isTaken, state }
      ]
    })
  )
}

/**
 * Get the views that weren't expected and weren't taken
 *
 * These show a "Not expected" placeholder rather than "No image".
 *
 * @param {object} appointment - The appointment (or its working copy)
 * @returns {Array<string>} View codes, in standard order
 * @example
 * {{ appointment | getNotExpectedViews | map("lower") | dump }}
 */
const getNotExpectedViews = (appointment) =>
  Object.values(getExpectedViewStates(appointment))
    .filter((view) => view.state === 'notExpected')
    .map((view) => view.code)

/**
 * Check whether any expected view has no images
 *
 * Views that were never expected don't count as missing.
 *
 * @param {object} appointment - The appointment (or its working copy)
 * @param {object} [mammogramData] - Mammogram data to check, defaults to the appointment's
 * @returns {boolean} Whether an expected view is missing
 */
const hasMissingExpectedViews = (appointment, mammogramData) =>
  Object.values(getExpectedViewStates(appointment, mammogramData)).some(
    (view) => view.state === 'missing'
  )

/**
 * Get the breasts that have at least one standard view taken
 *
 * @param {object} mammogramData - Appointment mammogram data
 * @returns {Array<string>} 'right' and/or 'left', in that order
 * @example
 * {% set imagedSides = appointment.mammogramData | getImagedSides %}
 * {% if "right" in imagedSides %}...{% endif %}
 */
const getImagedSides = (mammogramData) => {
  const takenViews = getTakenViews(mammogramData)
  return ['right', 'left'].filter((side) =>
    takenViews.some((code) => getViewSide(code) === side)
  )
}

/**
 * Get the breasts a reader can give an opinion on and annotate
 *
 * The breasts with images taken. With no image data to go on, both.
 *
 * @param {object} mammogramData - Appointment mammogram data
 * @returns {Array<string>} 'right' and/or 'left', in that order
 * @example
 * {% set readableSides = appointment.mammogramData | getReadableSides %}
 * {% if breastSide in readableSides %}...{% endif %}
 */
const getReadableSides = (mammogramData) => {
  const imagedSides = getImagedSides(mammogramData)
  return imagedSides.length ? imagedSides : ['right', 'left']
}

/**
 * Check whether an appointment's mammography was incomplete
 *
 * True when the mammographer recorded that not all mammograms were taken and
 * an expected view is missing. Views that were never expected, such as after
 * a mastectomy, don't make it incomplete.
 *
 * @param {object} appointment - The appointment
 * @returns {boolean} Whether the mammography was incomplete
 * @example
 * {% if appointment | hasIncompleteMammography %}Incomplete mammography{% endif %}
 */
const hasIncompleteMammography = (appointment) =>
  []
    .concat(appointment?.mammogramData?.isIncompleteMammography || [])
    .includes('yes') && hasMissingExpectedViews(appointment)

module.exports = {
  STANDARD_VIEW_CODES,
  describeViewCode,
  getExpectedViews,
  getTakenViews,
  getExpectedViewStates,
  getNotExpectedViews,
  hasMissingExpectedViews,
  getImagedSides,
  getReadableSides,
  hasIncompleteMammography
}
