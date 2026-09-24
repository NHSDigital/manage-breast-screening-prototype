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
  updateIssue
} = require('../lib/utils/issues')
const {
  ISSUE_VIEWS,
  ISSUE_VIEW_LABELS,
  DEFAULT_ISSUE_VIEW,
  ISSUE_SORTS,
  DEFAULT_ISSUE_SORT,
  getIssuePlace,
  isIssueInUnit,
  getIssueFilterGroups,
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
const { getParticipant, getShortName } = require('../lib/utils/participants')
const { getEpisode, getReadingCaseById } = require('../lib/utils/episodes')
const { getAppointment } = require('../lib/utils/appointment-data')
const { getClinic } = require('../lib/utils/clinics')
const { urlWithReferrer, modalBreakout } = require('../lib/utils/referrers')
const { summariseMammogramImages } = require('../lib/utils/mammogram-images')

/**
 * The images an issue is about: the linked appointment's, or with no linked
 * appointment, the latest set taken in the linked episode. Null when there
 * are none - an appointment before its images, a round not yet screened.
 *
 * @param {object} data - Session data
 * @param {object | null} appointment - The appointment the issue links to
 * @param {object | null} episode - The episode the issue links to
 * @returns {object | null} { appointment, clinic, summary }
 */
const getIssueImages = (data, appointment, episode) => {
  const latestAppointmentId = (episode?.mammograms || []).at(-1)?.appointmentId
  const imagesAppointment =
    appointment ||
    (latestAppointmentId ? getAppointment(data, latestAppointmentId) : null)

  const summary = summariseMammogramImages(imagesAppointment, {
    viewOrder: data.settings?.mammogramViewOrder
  })
  if (!summary) return null

  return {
    appointment: imagesAppointment,
    clinic: getClinic(data, imagesAppointment.clinicId),
    summary
  }
}

/**
 * The participants an issue is about, each with the records the issue links
 * to that belong to them. Usually one participant; the model allows more, for
 * example images filed against the wrong person.
 *
 * @param {object} data - Session data
 * @param {object} issue - Issue
 * @returns {Array<object>} One entry per participant: participant, episode,
 *   appointment, clinic, readingCase, images (see getIssueImages) and
 *   otherOpenIssues
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
        appointments.find(
          (record) => record.participantId === participant.id
        ) || null
      const episode =
        episodes.find((record) => record.participantId === participant.id) ||
        null

      return {
        participant,
        episode,
        appointment,
        clinic: appointment ? getClinic(data, appointment.clinicId) : null,
        images: getIssueImages(data, appointment, episode),
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
  // the default without a filter that can never be unticked. The search, the
  // filter groups and the order ride along on every link, as on the reading
  // case list.
  router.get('/review/issues', (req, res) => {
    const data = req.session.data
    const breastScreeningUnitId = data.currentUser?.breastScreeningUnit

    const view = ISSUE_VIEWS.includes(req.query.view)
      ? req.query.view
      : DEFAULT_ISSUE_VIEW
    const query = req.query.q?.trim() || ''
    const sort = ISSUE_SORTS.some(
      (candidate) => candidate.value === req.query.sort
    )
      ? req.query.sort
      : DEFAULT_ISSUE_SORT

    const groups = getIssueFilterGroups(data)
    const selected = parseFilterQuery(req.query, groups)

    // Everything in the view matching the search, before the filter groups -
    // what the faceted counts are drawn from
    const listOptions = { breastScreeningUnitId, query, sort }
    const baseRows = getIssueRows(data, { ...listOptions, view })
    const rows = applyFilterGroups(baseRows, groups, selected)

    // The default view and order stay out of the URL, so a shared link only
    // carries what someone actually chose
    const carriedParams = {
      view: view === DEFAULT_ISSUE_VIEW ? '' : view,
      q: query,
      sort: sort === DEFAULT_ISSUE_SORT ? '' : sort
    }

    // Each tab counts its issues under the current search and filters
    const viewCounts = Object.fromEntries(
      ISSUE_VIEWS.map((candidate) => [
        candidate,
        candidate === view
          ? rows.length
          : applyFilterGroups(
              getIssueRows(data, { ...listOptions, view: candidate }),
              groups,
              selected
            ).length
      ])
    )

    const viewUrls = Object.fromEntries(
      ISSUE_VIEWS.map((candidate) => [
        candidate,
        buildFilterUrl('/review/issues', selected, {
          ...carriedParams,
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
      query,
      sort,
      sorts: ISSUE_SORTS,
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
      // The search is a field in the filter form, so only the view and the
      // order ride along as hidden fields - and clearing keeps them
      hiddenFields: { view: carriedParams.view, sort: carriedParams.sort },
      // What the sort form has to carry to leave the rest of the list alone
      sortHiddenFields: { view: carriedParams.view, q: query },
      // This list as it stands, so an issue opened from it can come back to it
      listUrl: viewUrls[view]
    })
  })

  // Load the issue for a route under /review/issues/:issueId. An issue from
  // another BSU is not found, as the index does not list it either. The kit's
  // page not found is rendered here rather than by skipping the route, which
  // would let the kit's automatic routes render the issue templates without
  // an issue.
  const loadIssue = (req, res, next) => {
    const data = req.session.data
    const issue = getIssue(data, req.params.issueId)

    if (!isIssueInUnit(issue, data.currentUser?.breastScreeningUnit)) {
      return res.status(404).render('404', { path: req.path })
    }

    res.locals.issue = issue
    res.locals.issueUrl = urlWithReferrer(
      `/review/issues/${issue.id}`,
      req.query.referrerChain
    )
    next()
  }

  // One issue, with the participant it is about and their linked records
  router.get('/review/issues/:issueId', loadIssue, (req, res) => {
    const data = req.session.data
    const { issue } = res.locals

    // Named issueParticipants rather than set as `participant`, `appointment`
    // and so on, which the layouts read as the page's own context (an
    // appointment in progress swaps the header nav for "Exit appointment")
    const issueParticipants = getIssueParticipants(data, issue)

    res.render('review/issues/show', {
      issuePlace: getIssuePlace(issue),
      issueParticipants,
      // The PACS viewer shows one study per page, so the first set of images
      pacsEntry: issueParticipants.find((entry) => entry.images) || null
    })
  })

  // Change the description of an open issue. Opens in a modal where modal
  // forms are on.
  router.get('/review/issues/:issueId/description', loadIssue, (req, res) => {
    const data = req.session.data
    const { issue, issueUrl } = res.locals

    // Opened from a tab from before the issue was closed
    if (!isIssueOpen(issue)) {
      req.flash('info', 'This issue has already been closed')
      return res.redirect(modalBreakout(issueUrl))
    }

    // The Change link names the issue in the query string, so arriving from
    // it starts afresh from the description as it stands, as does arriving
    // with another issue's answers. Coming back after an error keeps what
    // was entered.
    const arrivedFromChangeLink =
      req.query.issueTemp?.edit?.issueId === issue.id
    const answersAreForThisIssue = data.issueTemp?.edit?.issueId === issue.id
    if (arrivedFromChangeLink || !answersAreForThisIssue) {
      data.issueTemp = {
        ...data.issueTemp,
        edit: {
          issueId: issue.id,
          description: issue.description
        }
      }
    }

    res.render('review/issues/description', {
      descriptionAnswers: data.issueTemp?.edit
    })
  })

  router.post(
    '/review/issues/:issueId/description-answer',
    loadIssue,
    (req, res) => {
      const data = req.session.data
      const { issue, issueUrl } = res.locals

      if (!isIssueOpen(issue)) {
        delete data.issueTemp?.edit
        req.flash('info', 'This issue has already been closed')
        return res.redirect(modalBreakout(issueUrl))
      }

      const description = (data.issueTemp?.edit?.description || '').trim()

      if (!description) {
        const error = {
          text: 'Enter a description of the issue',
          name: 'issueTemp[edit][description]',
          href: '#issueDescription'
        }

        // Inside a modal, show the error in place rather than redirecting,
        // which the modal would treat as a further step
        if (req.headers['x-requested-with'] === 'XMLHttpRequest') {
          return res.status(422).render('review/issues/description', {
            flash: { error: [error] },
            descriptionAnswers: data.issueTemp?.edit
          })
        }

        req.flash('error', error)
        return res.redirect(
          urlWithReferrer(
            `/review/issues/${issue.id}/description`,
            req.query.referrerChain
          )
        )
      }

      updateIssue(data, issue.id, { description })

      // The kit copies every posted field into the session, so the answer
      // would otherwise linger for the next edit
      delete data.issueTemp?.edit

      req.flash('success', 'Description changed')
      res.redirect(modalBreakout(issueUrl))
    }
  )

  // The two ways to close an issue, each a page of its own: resolved, with
  // who checked the fix, or raised in error, with why. Each form's answers
  // are keyed to the issue, as the description edit's are.
  const CLOSING_FORMS = {
    resolve: {
      path: 'resolve',
      template: 'review/issues/resolve',
      getErrors: (answers, data) => {
        const errors = []
        if (!(answers.note || '').trim()) {
          errors.push({
            text: 'Explain the solution',
            name: 'issueTemp[resolve][note]',
            href: '#issueResolutionNote'
          })
        }
        if (!['someone_else', 'me'].includes(answers.verifier)) {
          errors.push({
            text: 'Select who has verified this resolution',
            name: 'issueTemp[resolve][verifier]',
            href: '#issueResolutionVerifier'
          })
        } else if (
          answers.verifier === 'someone_else' &&
          !(data.users || []).some(
            (user) =>
              user.id === answers.verifiedBy && user.id !== data.currentUser?.id
          )
        ) {
          errors.push({
            text: 'Select the user who has verified this resolution',
            name: 'issueTemp[resolve][verifiedBy]',
            href: '#issueResolutionVerifiedBy'
          })
        }
        return errors
      },
      getResolution: (answers, data) => ({
        outcome: 'resolved',
        note: answers.note.trim(),
        verifiedBy:
          answers.verifier === 'me' ? data.currentUser?.id : answers.verifiedBy
      }),
      getSuccessHeading: (participantName) =>
        `Issue resolved for ${participantName}`
    },
    raisedInError: {
      path: 'raised-in-error',
      template: 'review/issues/raised-in-error',
      getErrors: (answers) =>
        (answers.note || '').trim()
          ? []
          : [
              {
                text: 'Explain why the issue was raised in error',
                name: 'issueTemp[raisedInError][note]',
                href: '#issueRaisedInErrorNote'
              }
            ],
      getResolution: (answers) => ({
        outcome: 'raised_in_error',
        note: answers.note.trim()
      }),
      getSuccessHeading: (participantName) =>
        `Issue for ${participantName} closed as raised in error`
    }
  }

  Object.entries(CLOSING_FORMS).forEach(([formKey, form]) => {
    const formUrl = (issue, referrerChain) =>
      urlWithReferrer(`/review/issues/${issue.id}/${form.path}`, referrerChain)

    router.get(
      `/review/issues/:issueId/${form.path}`,
      loadIssue,
      (req, res) => {
        const data = req.session.data
        const { issue, issueUrl } = res.locals

        // Opened from a tab from before the issue was closed
        if (!isIssueOpen(issue)) {
          req.flash('info', 'This issue has already been closed')
          return res.redirect(issueUrl)
        }

        // The issue page's link names the issue in the query string, so
        // arriving from it starts a fresh form, as does arriving with another
        // issue's answers. Coming back after an error keeps what was entered.
        const arrivedFromLink =
          req.query.issueTemp?.[formKey]?.issueId === issue.id
        const answersAreForThisIssue =
          data.issueTemp?.[formKey]?.issueId === issue.id
        if (arrivedFromLink || !answersAreForThisIssue) {
          data.issueTemp = {
            ...data.issueTemp,
            [formKey]: { issueId: issue.id }
          }
        }

        // Passed directly, as the template's `data` is a copy taken before
        // this route runs
        res.render(form.template, {
          closingAnswers: data.issueTemp[formKey],
          issueParticipants: getIssueParticipants(data, issue)
        })
      }
    )

    router.post(
      `/review/issues/:issueId/${form.path}-answer`,
      loadIssue,
      (req, res) => {
        const data = req.session.data
        const { issue, issueUrl } = res.locals

        if (!isIssueOpen(issue)) {
          delete data.issueTemp?.[formKey]
          req.flash('info', 'This issue has already been closed')
          return res.redirect(issueUrl)
        }

        const answers = data.issueTemp?.[formKey] || {}
        const errors = form.getErrors(answers, data)
        if (errors.length) {
          errors.forEach((error) => req.flash('error', error))
          return res.redirect(formUrl(issue, req.query.referrerChain))
        }

        resolveIssue(data, issue.id, {
          ...form.getResolution(answers, data),
          resolvedBy: data.currentUser?.id
        })

        // The kit copies every posted field into the session, so the answers
        // would otherwise linger for the next form
        delete data.issueTemp?.[formKey]

        const participantLink = (issue.links || []).find(
          (link) => link.type === 'participant'
        )
        const participant = getParticipant(data, participantLink?.id)
        const participantName = participant
          ? getShortName(participant)
          : 'this participant'

        req.flash('success', {
          html: `<p class="nhsuk-notification-banner__heading">${form.getSuccessHeading(participantName)}</p>`
        })

        res.redirect(issueUrl)
      }
    )
  })
}
