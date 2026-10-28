// app/lib/utils/mastectomy.js

const OTHER_REASON = 'Other reason'
const BILATERAL_MASTECTOMY = 'Bilateral mastectomy'
const PERMANENT_EXCLUSION = 'permanent-exclusion'

// Medical history types whose forms can record a mastectomy
const MASTECTOMY_HISTORY_TYPES = ['breastCancer', 'mastectomyLumpectomy']
const SIDES = ['Right', 'Left', 'Both']

const getOtherSide = (side) => (side === 'Right' ? 'Left' : 'Right')

/**
 * Get the mastectomy side ticked on a breast cancer or mastectomy form
 *
 * @param {object} formData - The medicalHistoryTemp object posted by the form
 * @returns {string|undefined} Right, Left or Both, or undefined if no mastectomy
 */
const getFormMastectomySide = (formData = {}) =>
  [].concat(formData.procedures || []).includes('Mastectomy') &&
  SIDES.includes(formData.mastectomySide)
    ? formData.mastectomySide
    : undefined

/**
 * Get the answers allowed for which breasts to image after a mastectomy
 *
 * @param {string} mastectomySide - Right, Left or Both
 * @returns {Array<string>} Allowed values for mastectomyImagingSide
 */
const getMastectomyImagingOptions = (mastectomySide) =>
  mastectomySide === 'Both'
    ? ['None', 'Right', 'Left', 'Both']
    : [getOtherSide(mastectomySide), 'Both']

/**
 * Work out whether a medical history form still needs the mastectomy imaging question
 *
 * The question is asked again only when the mastectomy side changes.
 *
 * @param {object} formData - The medicalHistoryTemp object posted by the form
 * @returns {string|null} 'ask' if not yet asked for this side, 'missing' if
 * asked but not validly answered, or null if nothing is needed
 */
const getMastectomyImagingStep = (formData = {}) => {
  const mastectomySide = getFormMastectomySide(formData)

  if (!mastectomySide) {
    return null
  }
  if (formData.mastectomyImagingFor !== mastectomySide) {
    return 'ask'
  }
  if (
    !getMastectomyImagingOptions(mastectomySide).includes(
      formData.mastectomyImagingSide
    )
  ) {
    return 'missing'
  }
  return null
}

/**
 * Tidy the mastectomy imaging answers on a medical history form before saving
 *
 * Keeps only the details typed for the chosen imaging option, and removes the
 * imaging answers if there is no longer a mastectomy.
 *
 * @param {object} formData - The medicalHistoryTemp object posted by the form
 * @returns {object} Copy of formData with tidied imaging answers
 */
const tidyMastectomyImagingAnswers = (formData = {}) => {
  const tidied = { ...formData }

  if (!getFormMastectomySide(formData)) {
    delete tidied.mastectomyImagingFor
    delete tidied.mastectomyImagingSide
    delete tidied.mastectomyImagingDetails
  }
  // Each imaging option has its own details box, so only posted from the imaging page
  else if (formData.mastectomyImagingDetailsTemp) {
    const details =
      formData.mastectomyImagingDetailsTemp[formData.mastectomyImagingSide]
    if (details) {
      tidied.mastectomyImagingDetails = details
    } else {
      delete tidied.mastectomyImagingDetails
    }
  }

  delete tidied.mastectomyImagingDetailsTemp
  return tidied
}

/**
 * Get the heading for a mastectomy on one or both sides
 *
 * @param {string} side - Right, Left or Both
 * @returns {string} For example 'Bilateral mastectomy' or 'Unilateral mastectomy (right)'
 * @example
 * {{ "Right" | getMastectomyHeading }}
 */
const getMastectomyHeading = (side) =>
  side === 'Both'
    ? BILATERAL_MASTECTOMY
    : `Unilateral mastectomy (${String(side).toLowerCase()})`

/**
 * Describe the imaging recorded for a mastectomy in a medical history item
 *
 * @param {object} item - A stored medical history item
 * @returns {{heading: string, imagedText: string|undefined, details: string|undefined}|null}
 * Heading, which breasts were imaged (undefined if no images), and any details,
 * or null if the item has no mastectomy imaging answer
 */
const describeMastectomyImaging = (item) => {
  if (!SIDES.includes(item?.mastectomyImagingFor)) {
    return null
  }

  const imagedSide = item.mastectomyImagingSide
  let imagedText
  if (imagedSide === 'Both') {
    imagedText = 'Images taken of both breasts'
  } else if (imagedSide === 'Right' || imagedSide === 'Left') {
    imagedText = `Images taken of the ${imagedSide.toLowerCase()} breast only`
  }

  return {
    heading: getMastectomyHeading(item.mastectomyImagingFor),
    imagedText,
    details: imagedText ? item.mastectomyImagingDetails : undefined
  }
}

/**
 * Describe the mastectomies where images were taken, for readers
 *
 * Bilateral mastectomies with no images are left out.
 *
 * @param {object} medicalHistory - Appointment medical history, keyed by type
 * @returns {Array<object>} One describeMastectomyImaging result per mastectomy
 * @example
 * {% for note in appointment.medicalInformation.medicalHistory | getMastectomyImagingNotes %}
 */
const getMastectomyImagingNotes = (medicalHistory) =>
  MASTECTOMY_HISTORY_TYPES.flatMap((type) => medicalHistory?.[type] || [])
    .map(describeMastectomyImaging)
    .filter((note) => note?.imagedText)

/**
 * Check whether a medical history item records a bilateral mastectomy with no images needed
 *
 * @param {object} item - A stored medical history item
 * @returns {boolean} Whether both breasts had a mastectomy and no images are needed
 */
const isBilateralMastectomyWithoutImages = (item) =>
  Boolean(
    item?.proceduresRightBreast?.includes('Mastectomy') &&
    item?.proceduresLeftBreast?.includes('Mastectomy') &&
    item?.mastectomyImagingFor === 'Both' &&
    item?.mastectomyImagingSide === 'None'
  )

/**
 * Check whether an appointment's medical history has a bilateral mastectomy with no images needed
 *
 * @param {object} medicalHistory - Appointment medical history, keyed by type
 * @returns {boolean} Whether any mastectomy item needs no images
 */
const hasBilateralMastectomyWithoutImages = (medicalHistory) =>
  MASTECTOMY_HISTORY_TYPES.some((type) =>
    (medicalHistory?.[type] || []).some(isBilateralMastectomyWithoutImages)
  )

/**
 * Build the success message for ending an appointment after bilateral mastectomy
 *
 * @param {string} participantName - The participant's full name
 * @param {string} appointmentUrl - The appointment URL
 * @returns {string} Success message containing a link to the appointment
 */
const getBilateralMastectomySuccessMessage = (
  participantName,
  appointmentUrl
) =>
  `Appointment ended. ${participantName} does not need any images because of their bilateral mastectomy. <a href="${appointmentUrl}" class="app-nowrap">View their appointment</a>`

module.exports = {
  OTHER_REASON,
  BILATERAL_MASTECTOMY,
  PERMANENT_EXCLUSION,
  getMastectomyImagingStep,
  tidyMastectomyImagingAnswers,
  getMastectomyHeading,
  describeMastectomyImaging,
  getMastectomyImagingNotes,
  isBilateralMastectomyWithoutImages,
  hasBilateralMastectomyWithoutImages,
  getBilateralMastectomySuccessMessage
}
