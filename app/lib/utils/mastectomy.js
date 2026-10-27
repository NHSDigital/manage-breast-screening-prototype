// app/lib/utils/mastectomy.js

const OTHER_REASON = 'Other reason'
const BILATERAL_MASTECTOMY = 'Bilateral mastectomy'
const PERMANENT_EXCLUSION = 'permanent-exclusion'

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
  isBilateralMastectomyWithoutImages,
  getBilateralMastectomySuccessMessage
}
