// app/routes/arbitration.js
//
// Arbitration flow - stub pages only for now. An arbitration session works
// through the cases awaiting arbitration; the arbitration outcome is the final
// outcome of image reading for the case.
//
// Stub status: sessions and outcomes are stored under data.arbitrationSessions
// so the flow can be clicked through end to end, but nothing writes real
// arbitration reads yet - that is the rest of phase 3 (buildRead with
// readType 'arbitration', panelUserIds, finalisation).
//
// Registered after routes/reading.js so its `/reading` middleware (nav state)
// has already run.

const generateId = require('../lib/utils/id-generator')
const { getReadingCaseList } = require('../lib/utils/reading-case-list')
const { getReadingCaseById } = require('../lib/utils/episodes')
const { getAppointment } = require('../lib/utils/appointment-data')
const { getParticipant } = require('../lib/utils/participants')
const { getReadsAsArray } = require('../lib/utils/reading-cases')

/**
 * The cases currently awaiting arbitration, oldest images first.
 *
 * @param {object} data - Session data
 * @returns {Array} Rows from the reading case list
 */
const getArbitrationBacklog = (data) => {
  return getReadingCaseList(data, { scope: 'open', state: 'awaiting_arbitration' }).rows
}

/**
 * Look up an arbitration session
 *
 * @param {object} data - Session data
 * @param {string} sessionId - Session id
 * @returns {object|null} Session
 */
const getArbitrationSession = (data, sessionId) => {
  return data.arbitrationSessions?.[sessionId] || null
}

/**
 * Create an arbitration session from the current backlog.
 *
 * @param {object} data - Session data
 * @param {object} arbitration - { mode, panelUserIds }
 * @returns {object} The new session
 */
const createArbitrationSession = (data, arbitration) => {
  const session = {
    id: generateId(),
    type: 'arbitration',
    createdAt: new Date().toISOString(),
    caseIds: getArbitrationBacklog(data).map((row) => row.readingCase.id),
    arbitration,
    // Stub: outcomes recorded per case id rather than as real reads
    outcomes: {}
  }

  data.arbitrationSessions = data.arbitrationSessions || {}
  data.arbitrationSessions[session.id] = session

  return session
}

/**
 * The next case in the session without a recorded outcome, or null.
 *
 * @param {object} session - Arbitration session
 * @param {string} [afterCaseId] - Start looking after this case
 * @returns {string|null} Case id
 */
const getNextArbitrationCaseId = (session, afterCaseId = null) => {
  const startIndex = afterCaseId ? session.caseIds.indexOf(afterCaseId) + 1 : 0

  // Look forward from the current case first, then wrap to the start
  const ordered = [
    ...session.caseIds.slice(startIndex),
    ...session.caseIds.slice(0, startIndex)
  ]

  return ordered.find((caseId) => !session.outcomes[caseId]) || null
}

/**
 * Redirect to the next unarbitrated case, or the session overview when done.
 */
const redirectToNextCase = (res, session, afterCaseId = null) => {
  const nextCaseId = getNextArbitrationCaseId(session, afterCaseId)

  if (nextCaseId) {
    return res.redirect(
      `/reading/arbitration/session/${session.id}/cases/${nextCaseId}/compare`
    )
  }

  return res.redirect(`/reading/arbitration/session/${session.id}`)
}

module.exports = (router) => {
  // Setup: who is arbitrating - just the current user, or a panel
  router.get('/reading/arbitration/start', (req, res) => {
    const data = req.session.data

    res.render('reading/arbitration/start', {
      backlogCount: getArbitrationBacklog(data).length
    })
  })

  router.post('/reading/arbitration/start-answer', (req, res) => {
    const data = req.session.data
    const mode = data.arbitrationTemp?.mode

    if (mode === 'panel') {
      return res.redirect('/reading/arbitration/panel')
    }

    const session = createArbitrationSession(data, {
      mode: 'alone',
      panelUserIds: [data.currentUser.id]
    })

    delete data.arbitrationTemp

    redirectToNextCase(res, session)
  })

  // Setup: pick who else is arbitrating
  router.get('/reading/arbitration/panel', (req, res) => {
    const data = req.session.data

    // Clinicians other than the current user
    const availableUsers = data.users.filter(
      (user) =>
        user.role.includes('clinician') && user.id !== data.currentUser.id
    )

    res.render('reading/arbitration/panel', {
      availableUsers
    })
  })

  router.post('/reading/arbitration/panel-answer', (req, res) => {
    const data = req.session.data

    const panelUserIds = [].concat(data.arbitrationTemp?.panelUserIds || [])
      .filter(Boolean)

    const session = createArbitrationSession(data, {
      mode: 'panel',
      panelUserIds: [data.currentUser.id, ...panelUserIds]
    })

    delete data.arbitrationTemp

    redirectToNextCase(res, session)
  })

  // Load session and case context for the per-case pages
  router.use(
    '/reading/arbitration/session/:sessionId/cases/:caseId',
    (req, res, next) => {
      const data = req.session.data
      const session = getArbitrationSession(data, req.params.sessionId)

      if (!session) {
        return res.redirect('/reading/arbitration/start')
      }

      const found = getReadingCaseById(data, req.params.caseId)
      if (!found) {
        return res.redirect(`/reading/arbitration/session/${session.id}`)
      }

      const { readingCase, episode } = found
      const appointment = getAppointment(data, readingCase.appointmentId)

      res.locals.session = session
      res.locals.sessionId = session.id
      res.locals.readingCase = readingCase
      res.locals.episode = episode
      res.locals.appointment = appointment
      res.locals.appointmentId = appointment?.id
      res.locals.participant = getParticipant(data, episode.participantId)
      res.locals.reads = getReadsAsArray(readingCase)
      res.locals.caseIndex = session.caseIds.indexOf(readingCase.id) + 1
      res.locals.caseTotal = session.caseIds.length

      next()
    }
  )

  router.get(
    '/reading/arbitration/session/:sessionId/cases/:caseId',
    (req, res) => {
      res.redirect(
        `/reading/arbitration/session/${req.params.sessionId}/cases/${req.params.caseId}/compare`
      )
    }
  )

  // Both reads side by side - agree with either, or go on to record a
  // different outcome
  router.get(
    '/reading/arbitration/session/:sessionId/cases/:caseId/compare',
    (req, res) => {
      res.render('reading/arbitration/compare')
    }
  )

  router.post(
    '/reading/arbitration/session/:sessionId/cases/:caseId/compare-answer',
    (req, res) => {
      const data = req.session.data
      const session = res.locals.session
      const readingCase = res.locals.readingCase

      // Stub: agreeing adopts that read's opinion as the arbitration outcome.
      // Reads have no id of their own - the reader identifies the read.
      const agreedReaderId = req.body.agreedReaderId
      const agreedRead = res.locals.reads.find(
        (read) => read.readerId === agreedReaderId
      )

      session.outcomes[readingCase.id] = {
        outcome: agreedRead?.opinion,
        agreedWithReaderId: agreedReaderId,
        recordedBy: data.currentUser.id,
        recordedAt: new Date().toISOString()
      }

      redirectToNextCase(res, session, readingCase.id)
    }
  )

  // Record a different outcome to either read
  router.get(
    '/reading/arbitration/session/:sessionId/cases/:caseId/outcome',
    (req, res) => {
      res.render('reading/arbitration/outcome')
    }
  )

  router.post(
    '/reading/arbitration/session/:sessionId/cases/:caseId/outcome-answer',
    (req, res) => {
      const data = req.session.data
      const session = res.locals.session
      const readingCase = res.locals.readingCase

      session.outcomes[readingCase.id] = {
        outcome: req.body.arbitrationOutcome,
        recordedBy: data.currentUser.id,
        recordedAt: new Date().toISOString()
      }

      redirectToNextCase(res, session, readingCase.id)
    }
  )

  // Session overview - everyone arbitrated this session, outcomes pending
  // finalisation
  router.get('/reading/arbitration/session/:sessionId', (req, res) => {
    const data = req.session.data
    const session = getArbitrationSession(data, req.params.sessionId)

    if (!session) {
      return res.redirect('/reading/arbitration/start')
    }

    // One row per case in the session, with its reads and any recorded outcome
    const rows = session.caseIds
      .map((caseId) => {
        const found = getReadingCaseById(data, caseId)
        if (!found) return null

        const { readingCase, episode } = found
        const appointment = getAppointment(data, readingCase.appointmentId)

        return {
          readingCase,
          episode,
          appointment,
          participant: getParticipant(data, episode.participantId),
          reads: getReadsAsArray(readingCase),
          outcome: session.outcomes[caseId] || null
        }
      })
      .filter(Boolean)

    const arbitratedCount = rows.filter((row) => row.outcome).length

    res.render('reading/arbitration/session', {
      session,
      sessionId: session.id,
      rows,
      arbitratedCount,
      nextCaseId: getNextArbitrationCaseId(session)
    })
  })
}
