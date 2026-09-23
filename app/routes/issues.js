// app/routes/issues.js
//
// Raising an issue from any page outside the reading workflow. Links to the
// form come from _includes/issues/raise-link.njk, which puts the record in the
// path and the journey in the query string; the form returns the user to where
// they came from. If the episode already has an open issue, the user is asked
// first whether this one is about something else.

const {
  createIssue,
  getIssueTypes,
  getOpenIssuesFor,
  ISSUE_RAISED_FROM
} = require('../lib/utils/issues')
const { getEpisode, getReadingCaseById } = require('../lib/utils/episodes')
const { getAppointment } = require('../lib/utils/appointment-data')
const { getParticipant, getShortName } = require('../lib/utils/participants')
const {
  getReturnUrl,
  urlWithReferrer,
  modalBreakout
} = require('../lib/utils/referrers')
const {
  getAppointmentUrl,
  getEpisodeUrl,
  getReadingCaseUrl
} = require('../lib/utils/urls')

const RAISE_PATH = '/issues/raise/:recordType/:recordId'

// The records an issue can be raised on from this form. Each says which
// createIssue field its id goes in, the journey to assume if none was given,
// and where to go back to if there is no referrer chain.
const RAISE_RECORD_TYPES = {
  'reading-case': {
    idField: 'readingCaseId',
    defaultRaisedFrom: 'reading_case',
    find: (data, id) => {
      const found = getReadingCaseById(data, id)
      return (
        found && {
          episodeId: found.episode.id,
          participantId: found.episode.participantId,
          returnUrl: getReadingCaseUrl(found.readingCase)
        }
      )
    }
  },
  'appointment': {
    idField: 'appointmentId',
    defaultRaisedFrom: 'appointment',
    find: (data, id) => {
      const appointment = getAppointment(data, id)
      return (
        appointment && {
          episodeId: appointment.episodeId,
          participantId: appointment.participantId,
          returnUrl: getAppointmentUrl(appointment)
        }
      )
    }
  },
  'episode': {
    idField: 'episodeId',
    defaultRaisedFrom: 'episode',
    find: (data, id) => {
      const episode = getEpisode(data, id)
      return (
        episode && {
          episodeId: episode.id,
          participantId: episode.participantId,
          returnUrl: getEpisodeUrl(episode)
        }
      )
    }
  }
}

module.exports = (router) => {
  // Load what the form is about, for both showing and answering it. The
  // form's answers live in data.raiseIssue until the issue is created.
  const loadRaiseContext = (req, res, next) => {
    const data = req.session.data
    const { recordType, recordId } = req.params

    const recordTypeConfig = RAISE_RECORD_TYPES[recordType]
    const record = recordTypeConfig?.find(data, recordId)
    if (!record) return next('route')

    // A raise link names the journey, so arriving from one starts a fresh
    // form, as does arriving with answers given for a different record.
    // Coming back after a validation error keeps what was entered. A link
    // can also choose the type, for journeys that already know what is wrong.
    const linkedRaisedFrom = req.query.raiseIssue?.raisedFrom
    const answersAreForThisRecord = data.raiseIssue?.recordId === recordId
    const startsFreshForm = linkedRaisedFrom || !answersAreForThisRecord
    if (req.method === 'GET' && startsFreshForm) {
      data.raiseIssue = {
        recordId,
        raisedFrom: linkedRaisedFrom,
        type: req.query.raiseIssue?.type
      }
    }

    const raisedFrom = ISSUE_RAISED_FROM.includes(data.raiseIssue?.raisedFrom)
      ? data.raiseIssue.raisedFrom
      : recordTypeConfig.defaultRaisedFrom

    // The template's `data` is a copy taken before this runs, so the answers
    // are passed directly
    Object.assign(res.locals, {
      answers: data.raiseIssue || {},
      participant: getParticipant(data, record.participantId),
      openIssues: getOpenIssuesFor(data, record.episodeId),
      raisedFrom,
      issueTypes: getIssueTypes(raisedFrom),
      recordId,
      raiseUrl: `/issues/raise/${recordType}/${recordId}`,
      returnFallbackUrl: record.returnUrl,
      recordIdField: recordTypeConfig.idField
    })

    next()
  }

  // An episode with an open issue asks first whether this is a new one, so
  // the same problem is not raised twice
  router.get(RAISE_PATH, loadRaiseContext, (req, res) => {
    const data = req.session.data
    const { openIssues } = res.locals

    if (openIssues.length && data.raiseIssue?.aboutSomethingElse !== 'yes') {
      return res.render('issues/raise-existing')
    }

    res.render('issues/raise')
  })

  router.post(`${RAISE_PATH}/existing-answer`, loadRaiseContext, (req, res) => {
    const data = req.session.data
    const referrerChain = req.query.referrerChain
    const { raiseUrl, returnFallbackUrl } = res.locals
    const answer = data.raiseIssue?.aboutSomethingElse

    if (answer === 'yes') {
      return res.redirect(urlWithReferrer(raiseUrl, referrerChain))
    }

    if (answer === 'no') {
      delete data.raiseIssue

      // Nothing new to raise, so go back to what they were doing. The check
      // page links to each open issue for anyone who wants to see it
      return res.redirect(
        modalBreakout(getReturnUrl(returnFallbackUrl, referrerChain))
      )
    }

    const error = {
      text: 'Select yes if the issue is about something else',
      name: 'raiseIssue[aboutSomethingElse]',
      href: '#raiseIssueAboutSomethingElse'
    }

    if (req.headers['x-requested-with'] === 'XMLHttpRequest') {
      return res.status(422).render('issues/raise-existing', {
        flash: { error: [error] }
      })
    }

    req.flash('error', error)
    res.redirect(urlWithReferrer(raiseUrl, referrerChain))
  })

  router.post(`${RAISE_PATH}/answer`, loadRaiseContext, (req, res) => {
    const data = req.session.data
    const { recordId } = req.params
    const referrerChain = req.query.referrerChain
    const {
      raisedFrom,
      issueTypes,
      raiseUrl,
      returnFallbackUrl,
      recordIdField
    } = res.locals

    const type = data.raiseIssue?.type
    const description = (data.raiseIssue?.description || '').trim()

    // Type is the one thing the issue cannot do without
    if (!issueTypes.some((issueType) => issueType.value === type)) {
      const error = {
        text: 'Select what the issue is',
        name: 'raiseIssue[type]',
        href: '#raiseIssueType'
      }

      // Inside a modal, show the error in place rather than redirecting,
      // which the modal would treat as a further step
      if (req.headers['x-requested-with'] === 'XMLHttpRequest') {
        return res.status(422).render('issues/raise', {
          flash: { error: [error] }
        })
      }

      req.flash('error', error)
      return res.redirect(urlWithReferrer(raiseUrl, referrerChain))
    }

    const issue = createIssue(data, {
      type,
      description,
      raisedBy: data.currentUser?.id,
      raisedFrom,
      [recordIdField]: recordId
    })

    // The kit's autoStoreData copies every posted field into the session, so
    // the answers would otherwise prefill the next raise form
    delete data.raiseIssue

    // The banner shows on the page the user returns to, so Back from the
    // issue leads there
    const returnUrl = getReturnUrl(returnFallbackUrl, referrerChain)
    const issueUrl = urlWithReferrer(`/review/issues/${issue.id}`, returnUrl)
    const participantName = getShortName(res.locals.participant)

    req.flash('success', {
      html: `<p class="nhsuk-notification-banner__heading">Issue raised for ${participantName}</p>
        <p class="nhsuk-body"><a class="nhsuk-notification-banner__link" href="${issueUrl}">View issue</a></p>`
    })

    res.redirect(modalBreakout(returnUrl))
  })
}
