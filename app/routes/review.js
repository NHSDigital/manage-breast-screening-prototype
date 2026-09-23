// app/routes/review.js
//
// Review: lists of things needing someone's attention, scoped to the current
// user's BSU. Issues are the only list so far. The landing page, /review, is a
// plain template served by the kit.

const {
  getIssue,
  getOpenIssuesFor,
  isIssueOpen,
  resolveIssue,
  ISSUE_OUTCOMES
} = require('../lib/utils/issues')
const {
  ISSUE_VIEWS,
  ISSUE_VIEW_LABELS,
  DEFAULT_ISSUE_VIEW,
  getIssuePlace,
  getIssueRows
} = require('../lib/utils/issue-list')
const { getParticipant } = require('../lib/utils/participants')
const { getEpisode, getReadingCaseById } = require('../lib/utils/episodes')
const { getAppointment } = require('../lib/utils/appointment-data')
const { getClinic } = require('../lib/utils/clinics')
const { urlWithReferrer } = require('../lib/utils/referrers')

// The index URL for a view; the default view stays out of the URL
const getIssueViewUrl = (view) =>
  view === DEFAULT_ISSUE_VIEW ? '/review/issues' : `/review/issues?view=${view}`

/**
 * The participants an issue is about, each with the records the issue links
 * to that belong to them. Usually one participant; the model allows more, for
 * example images filed against the wrong person.
 *
 * @param {object} data - Session data
 * @param {object} issue - Issue
 * @returns {Array<object>} One entry per participant: participant, episode,
 *   appointment, clinic, readingCase and otherOpenIssues
 */
const getIssueParticipants = (data, issue) => {
  const links = issue.links || []
  const idsOfType = (type) =>
    links.filter((link) => link.type === type).map((link) => link.id)

  const episodes = idsOfType('episode')
    .map((id) => getEpisode(data, id))
    .filter(Boolean)
  const appointments = idsOfType('appointment')
    .map((id) => getAppointment(data, id))
    .filter(Boolean)
  const readingCases = idsOfType('readingCase')
    .map((id) => getReadingCaseById(data, id))
    .filter((found) => found?.readingCase)

  return idsOfType('participant')
    .map((id) => getParticipant(data, id))
    .filter(Boolean)
    .map((participant) => {
      const appointment =
        appointments.find((record) => record.participantId === participant.id) ||
        null

      return {
        participant,
        episode:
          episodes.find((record) => record.participantId === participant.id) ||
          null,
        appointment,
        clinic: appointment ? getClinic(data, appointment.clinicId) : null,
        readingCase:
          readingCases.find(
            (found) => found.episode?.participantId === participant.id
          )?.readingCase || null,
        otherOpenIssues: getOpenIssuesFor(data, participant).filter(
          (candidate) => candidate.id !== issue.id
        )
      }
    })
}

module.exports = (router) => {
  router.use('/review', (req, res, next) => {
    res.locals.navActive = 'review'
    next()
  })

  // The issue index. Open, resolved or all is a view - a tab - so open can be
  // the default without a filter that can never be unticked.
  router.get('/review/issues', (req, res) => {
    const data = req.session.data
    const breastScreeningUnitId = data.currentUser?.breastScreeningUnit

    const view = ISSUE_VIEWS.includes(req.query.view)
      ? req.query.view
      : DEFAULT_ISSUE_VIEW

    const viewCounts = Object.fromEntries(
      ISSUE_VIEWS.map((candidate) => [
        candidate,
        getIssueRows(data, { breastScreeningUnitId, view: candidate }).length
      ])
    )

    const viewUrls = Object.fromEntries(
      ISSUE_VIEWS.map((candidate) => [candidate, getIssueViewUrl(candidate)])
    )

    res.render('review/issues/index', {
      rows: getIssueRows(data, { breastScreeningUnitId, view }),
      view,
      views: ISSUE_VIEWS,
      viewLabels: ISSUE_VIEW_LABELS,
      viewCounts,
      viewUrls,
      // This list as it stands, so an issue opened from it can come back to it
      listUrl: viewUrls[view]
    })
  })

  // One issue, with the participant it is about and their linked records
  router.get('/review/issues/:issueId', (req, res) => {
    const data = req.session.data
    const issue = getIssue(data, req.params.issueId)

    if (!issue) {
      return res.redirect('/review/issues')
    }

    // The resolve form's answers carry the issue they were given for, and
    // only prefill that issue's form. Passed to the template directly, as its
    // `data` is a copy taken before this route runs.
    if (data.issueResolution?.issueId !== issue.id) {
      delete data.issueResolution
    }
    const resolutionAnswers = data.issueResolution || {}

    // Named issueParticipants rather than set as `participant`, `appointment`
    // and so on, which the layouts read as the page's own context (an
    // appointment in progress swaps the header nav for "Exit appointment")
    res.render('review/issues/show', {
      issue,
      resolutionAnswers,
      issuePlace: getIssuePlace(issue),
      issueParticipants: getIssueParticipants(data, issue)
    })
  })

  router.post('/review/issues/:issueId/resolve', (req, res) => {
    const data = req.session.data
    const { issueId } = req.params
    const issueUrl = urlWithReferrer(
      `/review/issues/${issueId}`,
      req.query.referrerChain
    )

    // Opened in a tab from before the issue was closed
    if (!isIssueOpen(getIssue(data, issueId))) {
      delete data.issueResolution
      req.flash('info', 'This issue has already been closed')
      return res.redirect(issueUrl)
    }

    const outcome = data.issueResolution?.outcome
    const note = (data.issueResolution?.note || '').trim()

    // The outcome is what closing the issue records, so it cannot be skipped
    if (!ISSUE_OUTCOMES.includes(outcome)) {
      req.flash('error', {
        text: 'Select how the issue was resolved',
        name: 'issueResolution[outcome]',
        href: '#issueResolutionOutcome'
      })
      return res.redirect(issueUrl)
    }

    resolveIssue(data, issueId, {
      outcome,
      resolvedBy: data.currentUser?.id,
      note
    })

    // The kit copies every posted field into the session, so the answers would
    // otherwise prefill the next issue's form
    delete data.issueResolution

    req.flash(
      'success',
      outcome === 'raised_in_error'
        ? 'Issue closed as raised in error'
        : 'Issue resolved'
    )

    res.redirect(issueUrl)
  })
}
