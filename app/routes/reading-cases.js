// app/routes/reading-cases.js
//
// The reading lens's "seeing" surface: a backlog of every reading case and a
// view of one case with its reads. Separate from routes/reading.js, which owns
// the "doing" surface - one reader working through a session.
//
// Registered after routes/reading.js so its `/reading` middleware (nav state)
// has already run.

const {
  getReadingCaseList,
  getReadingCaseStateCounts,
  CASE_SCOPES
} = require('../lib/utils/reading-case-list')
const { getReadingCaseById } = require('../lib/utils/episodes')
const { getAppointment } = require('../lib/utils/appointment-data')
const { getParticipant } = require('../lib/utils/participants')
const { getClinic, getClinicLocationName } = require('../lib/utils/clinics')
const {
  READING_CASE_STATES,
  getReadingCases,
  getReadsAsArray,
  getReadingCaseStatus,
  getReadingCaseOutcome,
  getReadingMetadata,
  getArbitrationRead,
  isCaseDeferred,
  isCaseInArbitration,
  canUserReadCase
} = require('../lib/utils/reading-cases')
const { describeReadingCaseStatus } = require('../lib/utils/status')
const { awaitingPriors } = require('../lib/utils/prior-mammograms')

module.exports = (router) => {
  // Reading case backlog. Filters are query params rather than path segments
  // because this list has several facets at once (state, scope, deferred,
  // search) where the other reading lists have one - and it keeps the URL
  // shareable.
  router.get('/reading/cases', (req, res) => {
    const data = req.session.data

    const scope = CASE_SCOPES.includes(req.query.scope)
      ? req.query.scope
      : 'open'

    const state = READING_CASE_STATES.includes(req.query.state)
      ? req.query.state
      : null

    // Blocking filters: the two individual reasons, plus a meta filter for
    // cases blocked by either
    const deferred = req.query.deferred === 'true'
    const awaitingPriors = req.query.priors === 'true'
    const blocked = req.query.blocked === 'true'
    const query = req.query.q || ''

    const filters = { scope, state, deferred, awaitingPriors, blocked, query }

    const { rows, totalCount, truncated } = getReadingCaseList(data, filters)
    const counts = getReadingCaseStateCounts(data, filters)

    res.render('reading/cases', {
      rows,
      totalCount,
      truncated,
      shownCount: rows.length,
      counts,
      filters,
      scopes: CASE_SCOPES,
      states: READING_CASE_STATES
    })
  })

  // The old tabbed views collapsed into the one page
  router.get('/reading/cases/:caseId/:tab', (req, res) => {
    res.redirect(`/reading/cases/${req.params.caseId}`)
  })

  // One reading case on a single page: state, blockers, reads, annotations
  router.get('/reading/cases/:caseId', (req, res) => {
    const data = req.session.data

    const found = getReadingCaseById(data, req.params.caseId)
    if (!found) {
      return res.redirect('/reading/cases')
    }

    const { readingCase, episode } = found

    const appointment = getAppointment(data, readingCase.appointmentId)
    const participant = getParticipant(data, episode.participantId)
    const clinic = appointment ? getClinic(data, appointment.clinicId) : null

    // Which set of images this is, when a round has more than one. A technical
    // recall produces a second case, so the earlier one is superseded rather
    // than wrong - worth saying which you are looking at.
    const casesOnEpisode = getReadingCases(episode)
    const casePosition =
      casesOnEpisode.findIndex((candidate) => candidate.id === readingCase.id) + 1

    // Blind reading: someone who could still read this case must not see what
    // the other reader said - the view shows a read happened, not its opinion.
    // Once they have read it - or it is no longer theirs to read - the reads
    // are theirs to see. Arbitration is the exception: the arbitrator's job is
    // to weigh the two reads, so they see them.
    const blindReading = data.settings?.reading?.blindReading === 'true'
    const readsHidden =
      blindReading &&
      !isCaseInArbitration(readingCase) &&
      canUserReadCase(readingCase, data.currentUser?.id)

    const caseAwaitingPriors = appointment ? awaitingPriors(appointment) : false

    // Whether the case is the viewer's to read right now - outstanding priors
    // hold reading up, so they block the offer too
    const canReadCase =
      !caseAwaitingPriors && canUserReadCase(readingCase, data.currentUser?.id)

    const allReads = getReadsAsArray(readingCase)
    const caseOutcome = getReadingCaseOutcome(readingCase, data.settings)
    const caseStatus = getReadingCaseStatus(readingCase, data.settings)

    // Until a case has its second read, the first opinion is only its
    // author's to see - anyone else could be the second reader. The view
    // still shows that the read happened, just not what it concluded.
    const hideFirstOpinion = allReads.length < 2 && !caseOutcome

    // The read the outcome comes from - arbitration where there was one, else
    // either of the two agreeing reads. Present as soon as the case's
    // direction is known, even before finalisation - the outcome card marks
    // an unfinalised decision as provisional.
    const decidingRead =
      caseOutcome || caseStatus.provisionalOutcome
        ? getArbitrationRead(readingCase) || allReads[0]
        : null

    res.render('reading/case', {
      readingCase,
      episode,
      appointment,
      participant,
      clinic,
      clinicLocationName: getClinicLocationName(data, clinic),
      reads: allReads,
      readsHidden,
      hideFirstOpinion,
      canReadCase,
      readCount: allReads.length,
      caseState: caseStatus.state,
      caseStatus,
      caseStatusDisplay: describeReadingCaseStatus(caseStatus),
      caseOutcome,
      decidingRead,
      readingMetadata: getReadingMetadata(readingCase, data.settings),
      isDeferred: isCaseDeferred(readingCase),
      caseAwaitingPriors,
      casePosition,
      caseTotal: casesOnEpisode.length
    })
  })
}
