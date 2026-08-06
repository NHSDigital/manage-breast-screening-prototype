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

    const deferred = req.query.deferred === 'true'
    const query = req.query.q || ''

    const filters = { scope, state, deferred, query }

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

  // One reading case, in tabs. Summary is the default; the tab is a path
  // segment so each is linkable, the same way the other reading views do views
  // and filters.
  //
  // Registered as two paths rather than an optional `:tab?` - Express 5's
  // path-to-regexp rejects that syntax.
  const CASE_TABS = ['summary', 'reads', 'annotations']

  const caseViewPaths = [
    '/reading/cases/:caseId',
    '/reading/cases/:caseId/:tab'
  ]

  router.get(caseViewPaths, (req, res) => {
    const data = req.session.data

    const tab = CASE_TABS.includes(req.params.tab) ? req.params.tab : 'summary'

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
    // the other reader said. Once they have read it - or it is no longer theirs
    // to read - the reads are theirs to see.
    const blindReading = data.settings?.reading?.blindReading === 'true'
    const readsHidden =
      blindReading && canUserReadCase(readingCase, data.currentUser?.id)

    const allReads = getReadsAsArray(readingCase)
    const caseOutcome = getReadingCaseOutcome(readingCase, data.settings)
    const caseStatus = getReadingCaseStatus(readingCase, data.settings)

    // The read the outcome came from - arbitration where there was one, else
    // either of the two agreeing reads. Its per-breast assessment is what the
    // summary reports, since that is what the case concluded.
    const decidingRead = caseOutcome
      ? getArbitrationRead(readingCase) || allReads[0]
      : null

    res.render('reading/case', {
      tab,
      // Not `tabs` - that name is taken by the NHS frontend tabs macro, which
      // is imported globally and silently shadows a template variable
      caseTabs: CASE_TABS,
      readingCase,
      episode,
      appointment,
      participant,
      clinic,
      clinicLocationName: getClinicLocationName(data, clinic),
      reads: readsHidden ? [] : allReads,
      readsHidden,
      readCount: allReads.length,
      caseState: caseStatus.state,
      caseStatus,
      caseStatusDisplay: describeReadingCaseStatus(caseStatus),
      caseOutcome,
      decidingRead: readsHidden ? null : decidingRead,
      readingMetadata: getReadingMetadata(readingCase, data.settings),
      isDeferred: isCaseDeferred(readingCase),
      caseAwaitingPriors: appointment ? awaitingPriors(appointment) : false,
      casePosition,
      caseTotal: casesOnEpisode.length
    })
  })
}
