// app/lib/generators/issue-generator.js
//
// Seeds a small set of issues so the issues index, issue pages and the
// history on episode and participant pages have content: a handful open,
// mostly image problems on cases in reading plus one raised during an
// appointment today, and a few already resolved.

const dayjs = require('dayjs')
const {
  buildIssue,
  getBreastScreeningUnitIdForEpisode,
  ISSUE_LINK_TYPES
} = require('../utils/issues')
const { isCompleted } = require('../utils/status')
const { awaitingPriors } = require('../utils/prior-mammograms')

// Open issues raised during reading: the first two on cases in arbitration,
// the rest on cases waiting for their first read
const OPEN_READING_ISSUES = [
  {
    type: 'transposed_images',
    description: 'LCC and RCC images look swapped. Needs correcting on PACS.'
  },
  {
    type: 'wrong_participant_images',
    description:
      'Breast tissue and a clip on the LMLO do not match previous images. Possibly another participant’s images.'
  },
  {
    type: 'missing_images',
    description: 'RMLO will not open in the viewer. Tried reloading twice.'
  },
  {
    type: 'record_does_not_match_images',
    description:
      'Medical history records breast implants but none are visible on the images.'
  }
]

const OPEN_APPOINTMENT_ISSUE = {
  type: 'missing_images',
  description: 'Only 3 of 4 images arrived from the machine. LMLO missing.'
}

const RESOLVED_ISSUES = [
  {
    type: 'missing_images',
    raisedFrom: 'reading',
    description: 'LCC shows as a blank image.',
    outcome: 'resolved',
    note: 'Image re-sent from the mammography machine. All views now open.'
  },
  {
    type: 'wrong_personal_details',
    raisedFrom: 'episode',
    description: 'Date of birth on the images does not match the record.',
    outcome: 'resolved',
    note: 'Date of birth corrected on the national record and images relabelled.',
    // Verified by the person resolving it rather than a second person
    verifiedByResolver: true
  },
  {
    type: 'transposed_images',
    raisedFrom: 'reading',
    description: 'RCC and LCC may be the wrong way round.',
    outcome: 'raised_in_error',
    note: 'Checked with the mammographer. Markers are correct.'
  }
]

/**
 * A time some hours after a start point, but never later than an hour ago
 *
 * @param {string} start - ISO timestamp
 * @param {number} hours - Hours to add
 * @returns {string} ISO timestamp
 */
const hoursAfter = (start, hours) => {
  const latest = dayjs().subtract(1, 'hour')
  const candidate = dayjs(start).add(hours, 'hour')
  return (candidate.isAfter(latest) ? latest : candidate).toISOString()
}

/**
 * A time some minutes after a start point, but never later than a minute ago
 *
 * @param {string} start - ISO timestamp
 * @param {number} minutes - Minutes to add
 * @returns {string} ISO timestamp
 */
const minutesAfter = (start, minutes) => {
  const latest = dayjs().subtract(1, 'minute')
  const candidate = dayjs(start).add(minutes, 'minute')
  return (candidate.isAfter(latest) ? latest : candidate).toISOString()
}

/**
 * Links for an issue, most specific first, matching what createIssue builds
 *
 * @param {object} records - `{ readingCase, appointment, episode }`, any may be missing
 * @returns {Array} `{ type, id }` links
 */
const buildLinks = ({ readingCase, appointment, episode }) =>
  [
    readingCase && { type: 'readingCase', id: readingCase.id },
    appointment && { type: 'appointment', id: appointment.id },
    episode && { type: 'episode', id: episode.id },
    episode && { type: 'participant', id: episode.participantId }
  ].filter(Boolean)

/**
 * Generate the seed issues.
 *
 * Runs after reading data and episode stages are settled. The open reading
 * issues go on two cases already released into arbitration and two waiting
 * for their first read, so the reading backlog has blocked rows at both
 * stages.
 *
 * @param {object} options - Generated data
 * @param {Array} options.episodes - Current (non-historic) episodes
 * @param {Array} options.appointments - All appointments
 * @param {Array} options.clinics - All clinics
 * @param {Array} options.participants - All participants
 * @param {Array} options.users - Users
 * @returns {Array} Issues
 */
const generateIssues = ({
  episodes,
  appointments,
  clinics,
  participants,
  users
}) => {
  const appointmentsById = new Map(
    appointments.map((appointment) => [appointment.id, appointment])
  )
  const clinicsById = new Map(clinics.map((clinic) => [clinic.id, clinic]))
  const participantsById = new Map(
    participants.map((participant) => [participant.id, participant])
  )

  // The same rule createIssue uses, over the records being generated
  const getEpisodeUnitId = (episode) =>
    getBreastScreeningUnitIdForEpisode(episode, {
      findAppointment: (id) => appointmentsById.get(id) || null,
      findClinic: (id) => clinicsById.get(id) || null,
      participant: participantsById.get(episode.participantId) || null
    })
  // Issues are raised, resolved and verified by a spread of people, so the
  // lists and filters show more than one name
  const administrators = users.filter((user) =>
    user.role?.includes('administrative')
  )
  const resolvers = administrators.length ? administrators : users

  const issues = []
  const usedEpisodeIds = new Set()

  const readers = users.filter((user) => user.role?.includes('clinician'))
  const latestCase = (episode) =>
    episode.readingCases?.[episode.readingCases.length - 1] || null

  // Two cases released into arbitration and not yet arbitrated, each raised
  // by a reader who had not read it - the arbitrator who opened it, a
  // different one for each. Cases awaiting priors are already held up, so
  // they are left for other rows.
  const arbitrationCases = episodes
    .map((episode) => ({ episode, readingCase: latestCase(episode) }))
    .filter(
      ({ readingCase }) =>
        readingCase?.arbitration?.releasedAt &&
        !readingCase.reads.some((read) => read.readType === 'arbitration') &&
        !awaitingPriors(appointmentsById.get(readingCase.appointmentId))
    )
    .sort(
      (a, b) =>
        new Date(a.readingCase.arbitration.releasedAt) -
        new Date(b.readingCase.arbitration.releasedAt)
    )
    .slice(0, 2)
    .map((found, index) => {
      const readerIds = found.readingCase.reads.map((read) => read.readerId)
      const arbitrators = readers.filter(
        (reader) => !readerIds.includes(reader.id)
      )
      const arbitrator = arbitrators[index % arbitrators.length] || readers[0]
      return {
        ...found,
        raisedBy: arbitrator?.id,
        raisedAt: minutesAfter(
          found.readingCase.arbitration.releasedAt,
          15 + index * 5
        )
      }
    })

  // Two cases waiting for their first read, from the middle of the backlog so
  // the oldest cases are still there to read
  const unreadCases = episodes
    .map((episode) => ({ episode, readingCase: latestCase(episode) }))
    .filter(
      ({ readingCase }) =>
        readingCase &&
        !readingCase.reads?.length &&
        !awaitingPriors(appointmentsById.get(readingCase.appointmentId))
    )
    .sort(
      (a, b) =>
        new Date(a.readingCase.openedDate) - new Date(b.readingCase.openedDate)
    )
  const middleIndex = Math.floor(unreadCases.length / 2)
  const firstReadCases = unreadCases
    .slice(middleIndex, middleIndex + 2)
    .map((found, index) => ({
      ...found,
      raisedBy: readers[(index + 2) % readers.length]?.id,
      raisedAt: hoursAfter(found.readingCase.openedDate, 20 + index * 2)
    }))

  ;[...arbitrationCases, ...firstReadCases].forEach(
    ({ episode, readingCase, raisedBy, raisedAt }, index) => {
      const template = OPEN_READING_ISSUES[index % OPEN_READING_ISSUES.length]
      issues.push(
        buildIssue({
          ...template,
          raisedBy,
          raisedAt,
          raisedFrom: 'reading',
          breastScreeningUnitId: getEpisodeUnitId(episode),
          links: buildLinks({
            readingCase,
            appointment: appointmentsById.get(readingCase.appointmentId),
            episode
          })
        })
      )
      usedEpisodeIds.add(episode.id)
    }
  )

  // One open issue raised by the mammographer during an appointment today,
  // falling back to the most recent screened appointment, on an episode with
  // no issue yet
  const screenedAppointments = appointments
    .filter(
      (appointment) =>
        isCompleted(appointment) &&
        appointment.sessionDetails?.startedBy &&
        !usedEpisodeIds.has(appointment.episodeId) &&
        dayjs(appointment.timing.startTime).isBefore(dayjs())
    )
    .sort((a, b) => new Date(b.timing.startTime) - new Date(a.timing.startTime))
  const appointmentToday =
    screenedAppointments.find((appointment) =>
      dayjs(appointment.timing.startTime).isSame(dayjs(), 'day')
    ) || screenedAppointments[0]
  const appointmentEpisode = episodes.find(
    (episode) => episode.id === appointmentToday?.episodeId
  )

  if (appointmentToday && appointmentEpisode) {
    const imagesTakenAt =
      appointmentToday.timing.actualEndTime || appointmentToday.timing.endTime

    issues.push(
      buildIssue({
        ...OPEN_APPOINTMENT_ISSUE,
        raisedBy: appointmentToday.sessionDetails.startedBy,
        raisedAt: dayjs(imagesTakenAt).subtract(1, 'minute').toISOString(),
        raisedFrom: 'appointment',
        breastScreeningUnitId: getEpisodeUnitId(appointmentEpisode),
        links: buildLinks({
          appointment: appointmentToday,
          episode: appointmentEpisode
        })
      })
    )
    usedEpisodeIds.add(appointmentEpisode.id)
  }

  // Resolved issues on cases that have since been read twice, so the history
  // sits alongside a case that carried on. Record issues are raised by admin
  // staff, image issues by the first reader.
  const readCases = episodes
    .filter((episode) => !usedEpisodeIds.has(episode.id))
    .map((episode) => ({ episode, readingCase: latestCase(episode) }))
    .filter(({ readingCase }) => readingCase?.reads?.length >= 2)
    .sort(
      (a, b) =>
        new Date(b.readingCase.openedDate) - new Date(a.readingCase.openedDate)
    )

  RESOLVED_ISSUES.forEach((template, index) => {
    // Spread across the backlog rather than taking neighbouring cases
    const found =
      readCases[Math.floor((index * readCases.length) / RESOLVED_ISSUES.length)]
    if (!found) return

    const { episode, readingCase } = found
    const { outcome, note, verifiedByResolver, ...issueDetails } = template
    const raisedAt = hoursAfter(readingCase.openedDate, 3)
    const raisedFromEpisode = template.raisedFrom === 'episode'
    const resolver = resolvers[index % resolvers.length]
    const otherUsers = users.filter((user) => user.id !== resolver.id)
    const verifier = verifiedByResolver
      ? resolver
      : otherUsers[index % otherUsers.length]

    const issue = buildIssue({
      ...issueDetails,
      raisedBy: raisedFromEpisode
        ? administrators[(index + 1) % administrators.length]?.id ||
          readingCase.reads[0].readerId
        : readingCase.reads[0].readerId,
      raisedAt,
      breastScreeningUnitId: getEpisodeUnitId(episode),
      links: buildLinks({
        readingCase: raisedFromEpisode ? null : readingCase,
        appointment: raisedFromEpisode
          ? null
          : appointmentsById.get(readingCase.appointmentId),
        episode
      })
    })

    issues.push({
      ...issue,
      resolved: {
        resolvedAt: hoursAfter(raisedAt, 20),
        resolvedBy: resolver.id,
        outcome,
        note,
        ...(outcome === 'resolved' ? { verifiedBy: verifier?.id } : {})
      }
    })
  })

  return issues
}

/**
 * Check every issue's links point at real records, and warn about any that
 * don't. Warns rather than throws - never break a demo over seed data.
 *
 * @param {Array} issues - Generated issues
 * @param {object} records - Generated records to check against
 * @param {Array} records.episodes - All episodes
 * @param {Array} records.appointments - All appointments
 * @param {Array} records.participants - All participants
 * @returns {Array} The problems found, one string each
 */
const checkIssues = (issues, { episodes, appointments, participants }) => {
  const idsByLinkType = {
    readingCase: new Set(
      episodes.flatMap((episode) =>
        (episode.readingCases || []).map((readingCase) => readingCase.id)
      )
    ),
    appointment: new Set(appointments.map((appointment) => appointment.id)),
    episode: new Set(episodes.map((episode) => episode.id)),
    participant: new Set(participants.map((participant) => participant.id))
  }

  const problems = []

  issues.forEach((issue) => {
    const links = issue.links || []

    if (!links.length) {
      problems.push(`issue ${issue.reference} has no links`)
    }

    links.forEach((link) => {
      if (!ISSUE_LINK_TYPES.includes(link.type)) {
        problems.push(
          `issue ${issue.reference} has a link of unknown type "${link.type}"`
        )
      } else if (!idsByLinkType[link.type].has(link.id)) {
        problems.push(
          `issue ${issue.reference} links to ${link.type} ${link.id}, which does not exist`
        )
      }
    })
  })

  return problems
}

module.exports = {
  generateIssues,
  checkIssues
}
