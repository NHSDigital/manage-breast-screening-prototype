// app/lib/utils/urls.js
//
// Canonical URLs for the app's main pages. Templates and routes should build
// links through these rather than concatenating paths, so cross-links stay
// consistent and a route change only lands in one place.

/**
 * Get the URL for a participant's record
 *
 * @param {object | string} participantOrId - Participant object or id
 * @returns {string} Participant URL
 * @example
 * getParticipantUrl(participant) // '/participants/bc724e9f'
 */
const getParticipantUrl = (participantOrId) => {
  const id = participantOrId?.id || participantOrId
  return `/participants/${id}`
}

/**
 * Get the URL for an episode page
 *
 * @param {object} episode - Episode object (needs id and participantId)
 * @returns {string} Episode URL
 * @example
 * getEpisodeUrl(episode) // '/participants/bc724e9f/episodes/ep1234'
 */
const getEpisodeUrl = (episode) => {
  return `${getParticipantUrl(episode.participantId)}/episodes/${episode.id}`
}

/**
 * Get the URL for a clinic page
 *
 * @param {object | string} clinicOrId - Clinic object or id
 * @returns {string} Clinic URL
 * @example
 * getClinicUrl(clinic) // '/clinics/a9ovz0oj'
 */
const getClinicUrl = (clinicOrId) => {
  const id = clinicOrId?.id || clinicOrId
  return `/clinics/${id}`
}

/**
 * Get the URL for an appointment page
 *
 * @param {object} appointment - Appointment object (needs id and clinicId)
 * @returns {string} Appointment URL
 * @example
 * getAppointmentUrl(appointment) // '/clinics/a9ovz0oj/appointments/9vqig4uc'
 */
const getAppointmentUrl = (appointment) => {
  return `${getClinicUrl(appointment.clinicId)}/appointments/${appointment.id}`
}

/**
 * Get the URL for a reading case page
 *
 * @param {object | string} readingCaseOrId - Reading case object or id
 * @returns {string} Reading case URL
 * @example
 * getReadingCaseUrl(readingCase) // '/reading/cases/ruj64jdd'
 */
const getReadingCaseUrl = (readingCaseOrId) => {
  const id = readingCaseOrId?.id || readingCaseOrId
  return `/reading/cases/${id}`
}

module.exports = {
  getParticipantUrl,
  getEpisodeUrl,
  getClinicUrl,
  getAppointmentUrl,
  getReadingCaseUrl
}
