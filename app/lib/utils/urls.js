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

/**
 * Get the URL for the raise an issue form, raised on the most specific record
 * given: a reading case, else an appointment, else an episode.
 *
 * The record goes in the path so the form always knows what it is about. The
 * journey goes in the query string, where opening the form from a link starts
 * it afresh. A journey that already knows what is wrong, such as an image
 * capture failure, can pass the type so the form opens with it chosen.
 *
 * @param {object} records - Whatever the page has loaded
 * @param {object} [records.readingCase] - Reading case
 * @param {object} [records.appointment] - Appointment
 * @param {object} [records.episode] - Episode
 * @param {string} raisedFrom - Journey raised from, from ISSUE_RAISED_FROM in issues.js
 * @param {string} [type] - Issue type to preselect, from ISSUE_TYPES in issues.js
 * @returns {string | null} Raise form URL, or null if no record was given
 * @example
 * getRaiseIssueUrl({ readingCase, episode }, 'reading_case')
 * // '/issues/raise/reading-case/ruj64jdd?raiseIssue[raisedFrom]=reading_case'
 * getRaiseIssueUrl({ appointment }, 'appointment', 'missing_images')
 * // '/issues/raise/appointment/a1b2c3?raiseIssue[raisedFrom]=appointment&raiseIssue[type]=missing_images'
 */
const getRaiseIssueUrl = (
  { readingCase, appointment, episode } = {},
  raisedFrom,
  type
) => {
  const [recordType, record] = readingCase
    ? ['reading-case', readingCase]
    : appointment
      ? ['appointment', appointment]
      : ['episode', episode]

  if (!record?.id) return null

  const typeParam = type ? `&raiseIssue[type]=${type}` : ''
  return `/issues/raise/${recordType}/${record.id}?raiseIssue[raisedFrom]=${raisedFrom}${typeParam}`
}

module.exports = {
  getParticipantUrl,
  getEpisodeUrl,
  getClinicUrl,
  getAppointmentUrl,
  getReadingCaseUrl,
  getRaiseIssueUrl
}
