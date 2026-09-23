// app/routes/review.js
//
// Review: lists of things needing someone's attention, scoped to the current
// user's BSU. Issues are the only list so far. The landing page, /review, is a
// plain template served by the kit.

const {
  getIssue,
  isIssueOpen,
  resolveIssue,
  ISSUE_OUTCOMES
} = require('../lib/utils/issues')
const {
  ISSUE_VIEWS,
  ISSUE_VIEW_LABELS,
  DEFAULT_ISSUE_VIEW,
  ISSUE_FILTER_GROUPS,
  getIssuePlace,
  getIssueRows
} = require('../lib/utils/issue-list')
const {
  parseFilterQuery,
  applyFilterGroups,
  getFilterCounts,
  describeSelectedFilters,
  buildFilterUrl,
  hasSelectedFilters
} = require('../lib/utils/filter-list')
const { getParticipant } = require('../lib/utils/participants')
const { getEpisode, getReadingCaseById } = require('../lib/utils/episodes')
const { getAppointment } = require('../lib/utils/appointment-data')
const { getClinic } = require('../lib/utils/clinics')
const { urlWithReferrer } = require('../lib/utils/referrers')

module.exports = (router) => {
  router.use('/review', (req, res, next) => {
    res.locals.navActive = 'review'
    next()
  })

  // The issue index. Open, resolved or all is a view - a tab - so open can be
  // the default without a filter that can never be unticked; type and where
  // the issue was raised are filters.
  router.get('/review/issues', (req, res) => {
    const data = req.session.data
    const breastScreeningUnitId = data.currentUser?.breastScreeningUnit

    const view = ISSUE_VIEWS.includes(req.query.view)
      ? req.query.view
      : DEFAULT_ISSUE_VIEW

    const groups = ISSUE_FILTER_GROUPS
    const selected = parseFilterQuery(req.query, groups)

    // Everything in the view, before the filter groups - what the faceted
    // counts are drawn from
    const baseRows = getIssueRows(data, { breastScreeningUnitId, view })
    const rows = applyFilterGroups(baseRows, groups, selected)

    // The default view stays out of the URL
    const carriedParams = { view: view === DEFAULT_ISSUE_VIEW ? '' : view }

    const viewCounts = Object.fromEntries(
      ISSUE_VIEWS.map((candidate) => [
        candidate,
        applyFilterGroups(
          getIssueRows(data, { breastScreeningUnitId, view: candidate }),
          groups,
          selected
        ).length
      ])
    )

    const viewUrls = Object.fromEntries(
      ISSUE_VIEWS.map((candidate) => [
        candidate,
        buildFilterUrl('/review/issues', selected, {
          view: candidate === DEFAULT_ISSUE_VIEW ? '' : candidate
        })
      ])
    )

    res.render('review/issues/index', {
      rows,
      view,
      views: ISSUE_VIEWS,
      viewLabels: ISSUE_VIEW_LABELS,
      viewCounts,
      viewUrls,
      groups,
      selected,
      counts: getFilterCounts(baseRows, groups, selected),
      selectedFilters: describeSelectedFilters(
        groups,
        selected,
        '/review/issues',
        carriedParams
      ),
      isFiltered: hasSelectedFilters(selected),
      // This list as it stands, so an issue opened from it can come back to it
      listUrl: buildFilterUrl('/review/issues', selected, carriedParams),
      hiddenFields: carriedParams
    })
  })

  // One issue, with each record it links to
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

    const linkIds = Object.fromEntries(
      (issue.links || []).map((link) => [link.type, link.id])
    )

    const readingCase = linkIds.readingCase
      ? getReadingCaseById(data, linkIds.readingCase)?.readingCase || null
      : null
    const appointment = getAppointment(data, linkIds.appointment)

    // Grouped under `linked` rather than set as `appointment`, `participant`
    // and so on, which the layouts read as the page's own context (an
    // appointment in progress swaps the header nav for "Exit appointment")
    res.render('review/issues/show', {
      issue,
      resolutionAnswers,
      issuePlace: getIssuePlace(issue),
      linked: {
        participant: getParticipant(data, linkIds.participant),
        episode: getEpisode(data, linkIds.episode),
        appointment,
        clinic: appointment ? getClinic(data, appointment.clinicId) : null,
        readingCase
      }
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

    const issue = resolveIssue(data, issueId, {
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
        ? `Issue ${issue.reference} closed as raised in error`
        : `Issue ${issue.reference} resolved`
    )

    res.redirect(issueUrl)
  })
}
