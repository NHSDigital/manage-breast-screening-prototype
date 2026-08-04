// app/routes/arbitration.js
//
// Arbitration setup - who is arbitrating, then a real reading session of type
// 'arbitration' over the arbitration backlog. The per-case flow itself runs
// through the standard reading workflow (routes/reading.js), which knows to
// start arbitration cases on the compare step.
//
// Registered after routes/reading.js so its `/reading` middleware (nav state)
// has already run.

const {
  getEligibleCandidatesForSession,
  createReadingSession,
  getFirstReadableAppointmentInSession
} = require('../lib/utils/reading')
const { getReadingCase, updateReadingCase } = require('../lib/utils/episodes')

/**
 * Record the release of each case in an arbitration session.
 *
 * Auto-finalisation by time never writes the release (there is no act to
 * record) - pulling a case into an arbitration session is one, so the release
 * gets recorded here if finalisation didn't already. This is what makes
 * buildRead stamp the eventual read as an arbitration read.
 *
 * @param {object} data - Session data
 * @param {object} session - The arbitration reading session
 */
const recordArbitrationReleases = (data, session) => {
  const releasedAt = new Date().toISOString()

  for (const appointmentId of session.appointmentIds) {
    const appointment = data.appointments.find(
      (candidate) => candidate.id === appointmentId
    )
    if (!appointment) continue

    const readingCase = getReadingCase(data, appointment)
    if (!readingCase || readingCase.arbitration?.releasedAt) continue

    updateReadingCase(data, appointment.episodeId, {
      ...readingCase,
      arbitration: { releasedAt, releasedBy: data.currentUser.id }
    })
  }
}

/**
 * Create the arbitration session and send the user into its first case,
 * falling back to the session overview when nothing is readable.
 */
const startArbitrationSession = (data, res, arbitration) => {
  const sessionOptions = { type: 'arbitration', lazy: false }

  const candidates = getEligibleCandidatesForSession(data, sessionOptions)
  if (candidates.length === 0) {
    return res.redirect('/reading')
  }

  const session = createReadingSession(data, sessionOptions)
  session.arbitration = arbitration

  recordArbitrationReleases(data, session)

  const firstReadableAppointment = getFirstReadableAppointmentInSession(
    data,
    session.id,
    data.currentUser.id
  )

  if (firstReadableAppointment) {
    return res.redirect(
      `/reading/session/${session.id}/appointments/${firstReadableAppointment.id}`
    )
  }

  return res.redirect(`/reading/session/${session.id}`)
}

module.exports = (router) => {
  // Setup: who is arbitrating - just the current user, or a panel
  router.get('/reading/arbitration/start', (req, res) => {
    const data = req.session.data

    const backlogCount = getEligibleCandidatesForSession(data, {
      type: 'arbitration'
    }).length

    res.render('reading/arbitration/start', { backlogCount })
  })

  router.post('/reading/arbitration/start-answer', (req, res) => {
    const data = req.session.data

    if (data.arbitrationTemp?.mode === 'panel') {
      return res.redirect('/reading/arbitration/panel')
    }

    delete data.arbitrationTemp

    startArbitrationSession(data, res, {
      mode: 'alone',
      panelUserIds: [data.currentUser.id]
    })
  })

  // Setup: pick who else is arbitrating
  router.get('/reading/arbitration/panel', (req, res) => {
    const data = req.session.data

    // Clinicians other than the current user
    const availableUsers = data.users.filter(
      (user) =>
        user.role.includes('clinician') && user.id !== data.currentUser.id
    )

    res.render('reading/arbitration/panel', { availableUsers })
  })

  router.post('/reading/arbitration/panel-answer', (req, res) => {
    const data = req.session.data

    const panelUserIds = [].concat(data.arbitrationTemp?.panelUserIds || [])
      .filter(Boolean)

    delete data.arbitrationTemp

    startArbitrationSession(data, res, {
      mode: 'panel',
      panelUserIds: [data.currentUser.id, ...panelUserIds]
    })
  })
}
