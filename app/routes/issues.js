// app/routes/issues.js
//
// Raising an issue from any page outside the reading workflow. Links to the
// form come from _includes/issues/raise-link.njk, which puts the record in the
// path and the journey in the query string; the form returns the user to where
// they came from.

const {
  createIssue,
  getIssueTypes,
  ISSUE_RAISED_FROM
} = require('../lib/utils/issues')
const { getEpisode, getReadingCaseById } = require('../lib/utils/episodes')
const { getAppointment } = require('../lib/utils/appointment-data')
const { getParticipant } = require('../lib/utils/participants')
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
    // Coming back after a validation error keeps what was entered.
    const linkedRaisedFrom = req.query.raiseIssue?.raisedFrom
    const answersAreForThisRecord = data.raiseIssue?.recordId === recordId
    const startsFreshForm = linkedRaisedFrom || !answersAreForThisRecord
    if (req.method === 'GET' && startsFreshForm) {
      data.raiseIssue = { recordId, raisedFrom: linkedRaisedFrom }
    }

    const raisedFrom = ISSUE_RAISED_FROM.includes(data.raiseIssue?.raisedFrom)
      ? data.raiseIssue.raisedFrom
      : recordTypeConfig.defaultRaisedFrom

    // The template's `data` is a copy taken before this runs, so the answers
    // are passed directly
    Object.assign(res.locals, {
      answers: data.raiseIssue || {},
      participant: getParticipant(data, record.participantId),
      raisedFrom,
      issueTypes: getIssueTypes(raisedFrom),
      recordId,
      raiseUrl: `/issues/raise/${recordType}/${recordId}`,
      returnFallbackUrl: record.returnUrl,
      recordIdField: recordTypeConfig.idField
    })

    next()
  }

  router.get(RAISE_PATH, loadRaiseContext, (req, res) => {
    res.render('issues/raise')
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

    req.flash('success', {
      html: `<p class="nhsuk-notification-banner__heading">Issue raised</p>
        <p class="nhsuk-body"><a class="nhsuk-notification-banner__link" href="${issueUrl}">View issue ${issue.reference}</a></p>`
    })

    res.redirect(modalBreakout(returnUrl))
  })
}
