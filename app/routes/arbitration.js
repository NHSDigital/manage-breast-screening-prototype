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
const {
  getArbitrationBacklogCounts
} = require('../lib/utils/reading-case-list')

/**
 * Create the arbitration session and send the user into its first case,
 * falling back to the session overview when nothing is readable.
 */
const startArbitrationSession = (data, res, arbitration) => {
  const skipUserFilter = arbitration.mode === 'panel' || arbitration.skipUserFilter
  const sessionOptions = {
    type: 'arbitration',
    filters: skipUserFilter ? { skipUserFilter: true } : {}
  }

  const candidates = getEligibleCandidatesForSession(data, sessionOptions)
  if (candidates.length === 0) {
    return res.redirect('/reading')
  }

  const session = createReadingSession(data, sessionOptions)
  session.arbitration = arbitration

  // Cases are released as the user reaches them (see the per-case middleware in
  // routes/reading.js), so a lazy session doesn't claim the whole backlog

  const firstReadableAppointment = getFirstReadableAppointmentInSession(
    data,
    session.id,
    data.currentUser.id
  )

  // Panel arbitrators may have read every case in the session — fall back to
  // the first appointment so they still land on the arbitration compare page
  const firstAppointmentId =
    firstReadableAppointment?.id || session.appointmentIds[0]

  if (firstAppointmentId) {
    return res.redirect(
      `/reading/session/${session.id}/appointments/${firstAppointmentId}`
    )
  }

  return res.redirect(`/reading/session/${session.id}`)
}

module.exports = (router) => {
  // Setup: who is arbitrating - just the current user, or a panel
  router.get('/reading/arbitration/start', (req, res) => {
    const data = req.session.data

    // The whole backlog, counted the way the reading index and case list count
    // it, plus what's holding part of it up
    const backlog = getArbitrationBacklogCounts(data, { scope: 'open' })

    // What arbitration would actually offer: the backlog minus blocked cases,
    // and minus the user's own reads when they choose to exclude them
    const soloCount = getEligibleCandidatesForSession(data, {
      type: 'arbitration'
    }).length

    // Excluding own reads is the default, so the hint names what it takes away
    const ownReadsCount = backlog.available - soloCount

    res.render('reading/arbitration/start', {
      backlogCount: backlog.total,
      backlog,
      ownReadsCount
    })
  })

  router.post('/reading/arbitration/start-answer', (req, res) => {
    const data = req.session.data
    const mode = data.arbitrationTemp?.mode

    if (!mode) {
      req.flash('error', {
        text: 'Select who is arbitrating',
        name: 'arbitrationTemp[mode]',
        href: '#arbitration-mode'
      })
      return res.redirect('/reading/arbitration/start')
    }

    if (mode === 'panel') {
      return res.redirect('/reading/arbitration/panel')
    }

    // Checkbox returns ['yes'] when checked, absent when unchecked
    const excludeOwnReads = [].concat(data.arbitrationTemp?.excludeOwnReads || []).includes('yes')

    delete data.arbitrationTemp

    startArbitrationSession(data, res, {
      mode: 'alone',
      arbitratorIds: [data.currentUser.id],
      skipUserFilter: !excludeOwnReads
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

    // The picker chooses who else; the current user is an arbitrator too
    const chosenUserIds = []
      .concat(data.arbitrationTemp?.panelUserIds || [])
      .filter((userId) => userId && userId !== '_unchecked')

    if (chosenUserIds.length === 0) {
      req.flash('error', {
        text: 'Select who is arbitrating with you',
        name: 'arbitrationTemp[panelUserIds]',
        href: '#panel-users'
      })
      return res.redirect('/reading/arbitration/panel')
    }

    delete data.arbitrationTemp

    startArbitrationSession(data, res, {
      mode: 'panel',
      arbitratorIds: [data.currentUser.id, ...chosenUserIds]
    })
  })
}
