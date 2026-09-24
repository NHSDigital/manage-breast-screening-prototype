// app/routes/issues.js
//
// Raising an issue from any page outside the reading workflow. Links to the
// form come from _includes/issues/raise-link.njk, which puts the record in the
// path and the journey in the query string; the form returns the user to where
// they came from. If the episode already has an open issue, the user is asked
// first whether this one is about something else.

const {
  createIssue,
  getOpenIssuesFor,
  getOfferedIssueType,
  getRaiseIssueErrors,
  ISSUE_RAISED_FROM
} = require('../lib/utils/issues')
const {
  getCurrentEpisode,
  getEpisode,
  getReadingCaseById
} = require('../lib/utils/episodes')
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
  getParticipantUrl,
  getReadingCaseUrl
} = require('../lib/utils/urls')

const RAISE_PATH = '/issues/raise/:recordType/:recordId'

// The records an issue can be raised on from this form. Each says the journey
// to assume if none was given, and finds the record: its episode and
// participant, the createIssue fields that raise the issue on it, and where to
// go back to if there is no referrer chain.
const RAISE_RECORD_TYPES = {
  'reading-case': {
    defaultRaisedFrom: 'reading_case',
    find: (data, id) => {
      const found = getReadingCaseById(data, id)
      return (
        found && {
          episodeId: found.episode.id,
          participantId: found.episode.participantId,
          issueRecordIds: { readingCaseId: id },
          returnUrl: getReadingCaseUrl(found.readingCase)
        }
      )
    }
  },
  'appointment': {
    defaultRaisedFrom: 'appointment',
    find: (data, id) => {
      const appointment = getAppointment(data, id)
      return (
        appointment && {
          episodeId: appointment.episodeId,
          participantId: appointment.participantId,
          issueRecordIds: { appointmentId: id },
          returnUrl: getAppointmentUrl(appointment)
        }
      )
    }
  },
  'episode': {
    defaultRaisedFrom: 'episode',
    find: (data, id) => {
      const episode = getEpisode(data, id)
      return (
        episode && {
          episodeId: episode.id,
          participantId: episode.participantId,
          issueRecordIds: { episodeId: id },
          returnUrl: getEpisodeUrl(episode)
        }
      )
    }
  },
  // Raised on their current episode, so it holds the round like any other
  // issue, or on the participant alone when they have no open round
  'participant': {
    defaultRaisedFrom: 'participant',
    find: (data, id) => {
      const participant = getParticipant(data, id)
      if (!participant) return null

      const currentEpisode = getCurrentEpisode(data, id)
      return {
        episodeId: currentEpisode?.id || null,
        participantId: id,
        issueRecordIds: currentEpisode
          ? { episodeId: currentEpisode.id }
          : { participantId: id },
        returnUrl: getParticipantUrl(participant)
      }
    }
  }
}

module.exports = (router) => {
  // Load what the form is about, for both showing and answering it. The
  // form's answers live in data.issueTemp.raise until the issue is created.
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
    const linkedRaisedFrom = req.query.issueTemp?.raise?.raisedFrom
    const answersAreForThisRecord = data.issueTemp?.raise?.recordId === recordId
    const startsFreshForm = linkedRaisedFrom || !answersAreForThisRecord
    if (req.method === 'GET' && startsFreshForm) {
      data.issueTemp = {
        ...data.issueTemp,
        raise: {
          recordId,
          raisedFrom: linkedRaisedFrom,
          type: req.query.issueTemp?.raise?.type
        }
      }
    }

    const raisedFrom = ISSUE_RAISED_FROM.includes(
      data.issueTemp?.raise?.raisedFrom
    )
      ? data.issueTemp.raise.raisedFrom
      : recordTypeConfig.defaultRaisedFrom

    // The template's `data` is a copy taken before this runs, so the answers
    // are passed directly
    Object.assign(res.locals, {
      answers: data.issueTemp?.raise || {},
      participant: getParticipant(data, record.participantId),
      openIssues: getOpenIssuesFor(
        data,
        record.episodeId || record.participantId
      ),
      raisedFrom,
      recordId,
      raiseUrl: `/issues/raise/${recordType}/${recordId}`,
      returnFallbackUrl: record.returnUrl,
      issueRecordIds: record.issueRecordIds
    })

    next()
  }

  // An episode with an open issue asks first whether this is a new one, so
  // the same problem is not raised twice
  router.get(RAISE_PATH, loadRaiseContext, (req, res) => {
    const data = req.session.data
    const { openIssues } = res.locals

    if (
      openIssues.length &&
      data.issueTemp?.raise?.aboutSomethingElse !== 'yes'
    ) {
      return res.render('issues/raise-existing')
    }

    res.render('issues/raise')
  })

  router.post(`${RAISE_PATH}/existing-answer`, loadRaiseContext, (req, res) => {
    const data = req.session.data
    const referrerChain = req.query.referrerChain
    const { raiseUrl, returnFallbackUrl } = res.locals
    const answer = data.issueTemp?.raise?.aboutSomethingElse

    if (answer === 'yes') {
      return res.redirect(urlWithReferrer(raiseUrl, referrerChain))
    }

    if (answer === 'no') {
      delete data.issueTemp?.raise

      // Nothing new to raise, so go back to what they were doing. The check
      // page links to each open issue for anyone who wants to see it
      return res.redirect(
        modalBreakout(getReturnUrl(returnFallbackUrl, referrerChain))
      )
    }

    const error = {
      text: 'Select yes if the issue is about something else',
      name: 'issueTemp[raise][aboutSomethingElse]',
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
    const referrerChain = req.query.referrerChain
    const { raisedFrom, raiseUrl, returnFallbackUrl, issueRecordIds } =
      res.locals

    const answers = data.issueTemp?.raise || {}
    const description = (answers.description || '').trim()

    const errors = getRaiseIssueErrors(answers)
    if (errors.length) {
      // Inside a modal, show the errors in place rather than redirecting,
      // which the modal would treat as a further step
      if (req.headers['x-requested-with'] === 'XMLHttpRequest') {
        return res.status(422).render('issues/raise', {
          flash: { error: errors }
        })
      }

      errors.forEach((error) => req.flash('error', error))
      return res.redirect(urlWithReferrer(raiseUrl, referrerChain))
    }

    const issue = createIssue(data, {
      type: getOfferedIssueType(answers.type, raisedFrom),
      description,
      raisedBy: data.currentUser?.id,
      raisedFrom,
      ...issueRecordIds
    })

    // The kit's autoStoreData copies every posted field into the session, so
    // the answers would otherwise prefill the next raise form
    delete data.issueTemp?.raise

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
