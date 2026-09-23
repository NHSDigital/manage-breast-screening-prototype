// app/lib/utils/issues.js
//
// An issue records that something is wrong with a participant's record or
// images, raised by a user and resolved by a user. Issues are a top-level
// collection (`data.issues`), not a field on another record, so one issue can
// name any mix of participant, episode, appointment and reading case.
//
// The act is recorded and the state derived from it: an issue is open until it
// has a `resolved` object. Nothing is ever deleted - a mistaken issue is
// resolved as `raised_in_error`.
//
// Issues are few, so finding the ones for a record is a plain filter over the
// array rather than a store index.

const dataStore = require('../data-store')
const generateId = require('./id-generator')
const { getAppointment } = require('./appointment-data.js')
const { getClinic } = require('./clinics.js')
const { getParticipant } = require('./participants.js')
const { getEpisode, getReadingCaseById } = require('./episodes.js')

// What can go wrong. `group` sets where the raise form lists the type (see
// getIssueTypes); within a group, types keep this order. `offeredFrom` lists
// the journeys (`raisedFrom` values) that offer the type; 'any' means every
// journey does.
const ISSUE_TYPES = [
  {
    value: 'wrong_participant_images',
    label: 'Images are for a different participant',
    group: 'images',
    offeredFrom: ['reading', 'reading_case', 'appointment', 'episode']
  },
  {
    value: 'missing_images',
    label: 'Images are missing or will not open',
    group: 'images',
    offeredFrom: ['reading', 'reading_case', 'appointment', 'episode']
  },
  {
    value: 'transposed_images',
    label: 'Images are labelled with the wrong side or view',
    group: 'images',
    offeredFrom: ['reading', 'reading_case', 'appointment', 'episode']
  },
  {
    value: 'record_does_not_match_images',
    label: 'Recorded information does not match the images',
    group: 'images',
    offeredFrom: ['reading', 'reading_case', 'episode']
  },
  {
    value: 'wrong_personal_details',
    label: 'Personal details are wrong and cannot be corrected here',
    group: 'record',
    offeredFrom: ['any']
  },
  {
    value: 'other',
    label: 'Something else',
    group: 'other',
    offeredFrom: ['any']
  }
]

// Journeys about the participant's record rather than their images, where the
// raise form lists record types before image types
const RECORD_LED_JOURNEYS = ['episode']

// Where an issue was raised from
const ISSUE_RAISED_FROM = ['reading', 'appointment', 'episode', 'reading_case']

// How an issue can be closed
const ISSUE_OUTCOMES = ['resolved', 'raised_in_error']

// The kinds of record an issue can link to, most specific first. createIssue
// orders an issue's links the same way.
const ISSUE_LINK_TYPES = [
  'readingCase',
  'appointment',
  'episode',
  'participant'
]

/**
 * Make a short human reference for an issue, for quoting to the service desk
 *
 * @returns {string} Reference such as 'ISS-4F2K9'
 */
const generateIssueReference = () => `ISS-${generateId(5).toUpperCase()}`

/**
 * Build an issue record from its parts, without touching session data.
 *
 * Shared by createIssue and the seed generator, which already has the linked
 * records to hand. Callers supply links most specific first.
 *
 * @param {object} details - Issue details
 * @param {string} details.type - Issue type, from ISSUE_TYPES
 * @param {string} [details.description] - Free text from the person raising it
 * @param {string} details.raisedBy - User ID of the person raising it
 * @param {string} [details.raisedAt] - ISO timestamp, defaults to now
 * @param {string} details.raisedFrom - Journey it was raised from, from ISSUE_RAISED_FROM
 * @param {string | null} [details.breastScreeningUnitId] - BSU the issue belongs to
 * @param {Array} details.links - `{ type, id }` for each linked record, most specific first
 * @returns {object} A new, open issue
 */
const buildIssue = ({
  type,
  description = '',
  raisedBy,
  raisedAt = new Date().toISOString(),
  raisedFrom,
  breastScreeningUnitId = null,
  links
}) => {
  return {
    id: generateId(),
    reference: generateIssueReference(),
    type,
    description,
    raisedAt,
    raisedBy,
    raisedFrom,
    breastScreeningUnitId,
    links
  }
}

/**
 * Work out which BSU an episode belongs to: where its latest images were
 * taken, else where its latest appointment is booked, else the participant's
 * assigned unit.
 *
 * Takes lookups rather than session data so the seed generator can use it on
 * the records it is building.
 *
 * @param {object | null} episode - Episode object
 * @param {object} lookups - How to find the related records
 * @param {Function} lookups.findAppointment - Returns the appointment for an id, or null
 * @param {Function} lookups.findClinic - Returns the clinic for an id, or null
 * @param {object | null} [lookups.participant] - Participant, for their assigned unit
 * @returns {string | null} BSU ID
 * @example
 * getBreastScreeningUnitIdForEpisode(episode, {
 *   findAppointment: (id) => getAppointment(data, id),
 *   findClinic: (id) => getClinic(data, id),
 *   participant
 * })
 */
const getBreastScreeningUnitIdForEpisode = (
  episode,
  { findAppointment, findClinic, participant = null }
) => {
  const latestMammogram = episode?.mammograms?.[episode.mammograms.length - 1]
  if (latestMammogram?.breastScreeningUnitId) {
    return latestMammogram.breastScreeningUnitId
  }

  const latestAppointmentId =
    episode?.appointmentIds?.[episode.appointmentIds.length - 1]
  const appointment = latestAppointmentId
    ? findAppointment(latestAppointmentId)
    : null
  const clinic = appointment ? findClinic(appointment.clinicId) : null
  if (clinic?.breastScreeningUnitId) {
    return clinic.breastScreeningUnitId
  }

  return participant?.assignedBSU || null
}

/**
 * Raise an issue and save it to the session.
 *
 * Pass the id of the record the issue is raised on; the most specific one
 * given wins. The records that contain it are filled in as further links, so
 * an issue raised on a reading case also links to that case's appointment,
 * episode and participant, and one raised on an episode links to the episode
 * and participant only. The BSU is taken from the episode.
 *
 * @param {object} data - Session data
 * @param {object} details - Issue details
 * @param {string} details.type - Issue type, from ISSUE_TYPES
 * @param {string} [details.description] - Free text from the person raising it
 * @param {string} details.raisedBy - User ID of the person raising it
 * @param {string} [details.raisedAt] - ISO timestamp, defaults to now
 * @param {string} details.raisedFrom - Journey it was raised from, from ISSUE_RAISED_FROM
 * @param {string} [details.readingCaseId] - Reading case the issue is raised on
 * @param {string} [details.appointmentId] - Appointment the issue is raised on
 * @param {string} [details.episodeId] - Episode the issue is raised on
 * @param {string} [details.participantId] - Participant the issue is raised on
 * @returns {object | null} The new issue, or null if no linked record was found
 * @example
 * createIssue(data, {
 *   type: 'missing_images',
 *   description: 'Right MLO will not open',
 *   raisedBy: data.currentUser.id,
 *   raisedFrom: 'reading',
 *   readingCaseId: readingCase.id
 * })
 */
const createIssue = (data, details) => {
  const {
    readingCaseId,
    appointmentId,
    episodeId,
    participantId,
    ...issueDetails
  } = details

  let readingCase = null
  let appointment = null
  let episode = null

  if (readingCaseId) {
    const found = getReadingCaseById(data, readingCaseId)
    readingCase = found?.readingCase || null
    episode = found?.episode || null
    appointment = getAppointment(data, readingCase?.appointmentId)
  } else if (appointmentId) {
    appointment = getAppointment(data, appointmentId)
    episode = getEpisode(data, appointment?.episodeId)
  } else if (episodeId) {
    episode = getEpisode(data, episodeId)
  }

  const participant = getParticipant(
    data,
    episode?.participantId || appointment?.participantId || participantId
  )

  const links = [
    readingCase && { type: 'readingCase', id: readingCase.id },
    appointment && { type: 'appointment', id: appointment.id },
    episode && { type: 'episode', id: episode.id },
    participant && { type: 'participant', id: participant.id }
  ].filter(Boolean)

  if (!links.length) return null

  const issue = buildIssue({
    ...issueDetails,
    breastScreeningUnitId: getBreastScreeningUnitIdForEpisode(episode, {
      findAppointment: (id) => getAppointment(data, id),
      findClinic: (id) => getClinic(data, id),
      participant
    }),
    links
  })

  recordIssueChange(data, issue)
  return issue
}

/**
 * Record a new or changed issue so it persists for this session, and show it
 * to the rest of this request.
 *
 * The issues array attached to `data` is rebuilt from the shared store every
 * request, so only records written into data._changes survive (see the attach
 * middleware in app/routes.js).
 *
 * @param {object} data - Session data
 * @param {object} issue - Whole replacement issue record
 */
const recordIssueChange = (data, issue) => {
  if (data._changes?.issues) {
    data._changes.issues[issue.id] = issue
  }

  if (Array.isArray(data.issues)) {
    const index = data.issues.findIndex(
      (candidate) => candidate.id === issue.id
    )
    if (index === -1) {
      data.issues.push(issue)
    } else {
      data.issues[index] = issue
    }
  }
}

/**
 * Get an issue by ID
 *
 * Session changes first (which holds every issue raised this session), then
 * the shared store's id index, then a scan of data.issues.
 *
 * @param {object} data - Session data
 * @param {string} issueId - Issue ID
 * @returns {object | null} Issue or null if not found
 */
const getIssue = (data, issueId) => {
  if (!issueId) return null

  return (
    data._changes?.issues?.[issueId] ??
    dataStore.state.issuesById.get(issueId) ??
    data.issues?.find((issue) => issue.id === issueId) ??
    null
  )
}

/**
 * Get every issue linked to a record, open or resolved, newest first.
 *
 * Matches on the record's id against each issue's links. Ids are unique across
 * collections in practice; pass linkType to match only one kind of link.
 *
 * @param {object} data - Session data
 * @param {object | string} record - Participant, episode, appointment or reading case, or its id
 * @param {string} [linkType] - Only match links of this type, from ISSUE_LINK_TYPES
 * @returns {Array} Issues linked to the record
 * @example
 * getIssuesFor(data, episode)
 * getIssuesFor(data, appointment.id, 'appointment')
 */
const getIssuesFor = (data, record, linkType = null) => {
  const recordId = typeof record === 'string' ? record : record?.id
  if (!recordId) return []

  return (data.issues || [])
    .filter((issue) =>
      (issue.links || []).some(
        (link) => link.id === recordId && (!linkType || link.type === linkType)
      )
    )
    .sort((a, b) => new Date(b.raisedAt) - new Date(a.raisedAt))
}

/**
 * Whether an issue is still open - true until it has been resolved
 *
 * @param {object} issue - Issue
 * @returns {boolean} True if open
 */
const isIssueOpen = (issue) => Boolean(issue) && !issue.resolved

/**
 * Whether any open issue links to a record.
 *
 * The one predicate for both showing and blocking: reading asks it of the
 * episode.
 *
 * @param {object} data - Session data
 * @param {object | string} record - Participant, episode, appointment or reading case, or its id
 * @returns {boolean} True if the record has an open issue
 * @example
 * hasOpenIssue(data, episode)
 */
const hasOpenIssue = (data, record) =>
  getIssuesFor(data, record).some(isIssueOpen)

/**
 * Every open issue linked to a record, newest first
 *
 * @param {object} data - Session data
 * @param {object | string} record - Participant, episode, appointment or reading case, or its id
 * @returns {Array} Open issues linked to the record
 * @example
 * getOpenIssuesFor(data, appointment.episodeId)
 */
const getOpenIssuesFor = (data, record) =>
  getIssuesFor(data, record).filter(isIssueOpen)

/**
 * The periods during which a record had an open issue, oldest first.
 *
 * Each issue linked to the record contributes the time from when it was
 * raised to when it was resolved; overlapping periods are merged, so two
 * issues open at once count once. A period that is still open has a null
 * end. Reading uses these to pause a read's finalisation window (see
 * getAutoFinaliseTime in reading-cases.js).
 *
 * @param {object} data - Session data
 * @param {object | string} record - Participant, episode, appointment or reading case, or its id
 * @returns {Array<{start: string, end: string | null}>} Merged periods, ISO timestamps
 * @example
 * getOpenIssuePeriods(data, episode)
 * // [{ start: '2026-09-23T10:00:00.000Z', end: '2026-09-23T11:30:00.000Z' }]
 */
const getOpenIssuePeriods = (data, record) => {
  const periods = getIssuesFor(data, record)
    .filter((issue) => issue.raisedAt)
    .map((issue) => ({
      start: issue.raisedAt,
      end: issue.resolved?.resolvedAt || null
    }))
    .sort((a, b) => new Date(a.start) - new Date(b.start))

  const endTime = (period) =>
    period.end === null ? Infinity : new Date(period.end).getTime()

  return periods.reduce((merged, period) => {
    const previous = merged[merged.length - 1]
    if (previous && new Date(period.start).getTime() <= endTime(previous)) {
      if (endTime(period) > endTime(previous)) {
        previous.end = period.end
      }
      return merged
    }
    return [...merged, { ...period }]
  }, [])
}

/**
 * Update an issue with the given fields and save it to the session
 *
 * @param {object} data - Session data
 * @param {string} issueId - Issue ID
 * @param {object} updates - Fields to merge into the issue
 * @returns {object | null} Updated issue, or null if not found
 */
const updateIssue = (data, issueId, updates) => {
  const issue = getIssue(data, issueId)
  if (!issue) return null

  const updatedIssue = { ...issue, ...updates }
  recordIssueChange(data, updatedIssue)
  return updatedIssue
}

/**
 * Close an issue, recording who closed it, when, how and why.
 *
 * @param {object} data - Session data
 * @param {string} issueId - Issue ID
 * @param {object} resolution - How it was closed
 * @param {string} resolution.outcome - 'resolved' or 'raised_in_error'
 * @param {string} resolution.resolvedBy - User ID of the person closing it
 * @param {string} [resolution.note] - What was done, or why it was raised in error
 * @param {string} [resolution.resolvedAt] - ISO timestamp, defaults to now
 * @returns {object | null} Updated issue, or null if not found, already closed or the outcome is unknown
 */
const resolveIssue = (
  data,
  issueId,
  { outcome, resolvedBy, note = '', resolvedAt = new Date().toISOString() }
) => {
  const issue = getIssue(data, issueId)
  if (!isIssueOpen(issue) || !ISSUE_OUTCOMES.includes(outcome)) return null

  return updateIssue(data, issueId, {
    resolved: { resolvedAt, resolvedBy, outcome, note }
  })
}

/**
 * The issue types a journey offers, in the order the raise form lists them.
 *
 * Image types lead in reading, on a reading case and at an appointment; record
 * types lead on an episode. 'Something else' is always last.
 *
 * @param {string} raisedFrom - Journey, from ISSUE_RAISED_FROM
 * @returns {Array} `{ value, label, group, offeredFrom }` for each type offered
 * @example
 * getIssueTypes('episode') // wrong_personal_details first, then the image types, then other
 */
const getIssueTypes = (raisedFrom) => {
  const groupOrder = RECORD_LED_JOURNEYS.includes(raisedFrom)
    ? ['record', 'images', 'other']
    : ['images', 'record', 'other']

  return ISSUE_TYPES.filter(
    (issueType) =>
      issueType.offeredFrom.includes('any') ||
      issueType.offeredFrom.includes(raisedFrom)
  ).sort((a, b) => groupOrder.indexOf(a.group) - groupOrder.indexOf(b.group))
}

/**
 * The display label for an issue type
 *
 * @param {string} type - Issue type value, from ISSUE_TYPES
 * @returns {string} Label, or empty string if unknown
 */
const getIssueTypeLabel = (type) =>
  ISSUE_TYPES.find((issueType) => issueType.value === type)?.label || ''

/**
 * An issue's status: open, or the outcome it was closed with. Renders as a tag
 * through the `issue` vocabulary in status.js.
 *
 * @param {object} issue - Issue
 * @returns {string} 'open', 'resolved' or 'raised_in_error'
 * @example
 * {{ issue | getIssueStatus | toTag({ vocabulary: "issue" }) }}
 */
const getIssueStatus = (issue) => issue?.resolved?.outcome || 'open'

module.exports = {
  ISSUE_TYPES,
  ISSUE_RAISED_FROM,
  ISSUE_OUTCOMES,
  ISSUE_LINK_TYPES,
  buildIssue,
  createIssue,
  getBreastScreeningUnitIdForEpisode,
  getIssue,
  getIssuesFor,
  isIssueOpen,
  hasOpenIssue,
  getOpenIssuesFor,
  getOpenIssuePeriods,
  updateIssue,
  resolveIssue,
  getIssueTypes,
  getIssueTypeLabel,
  getIssueStatus
}
