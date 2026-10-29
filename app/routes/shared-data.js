// app/routes/shared-data.js
//
// Routes for sharing changes between browsers. See app/lib/shared-data.js
// and docs/data-conventions.md.

const sharedData = require('../lib/shared-data')

// Heroku drops a connection that has sent nothing for 55 seconds. Pages also
// watch for this heartbeat, and reconnect if it stops (see live-updates.js).
const HEARTBEAT_MS = 25 * 1000

// How long browsers wait before reconnecting after the server stops. Long
// enough for a local restart, because in development the kit's proxy never
// answers a request it can't pass on, so a reconnect made too soon hangs.
const RESTART_RETRY_MS = 10 * 1000

// Open event streams. Stopping the server waits for every connection to
// finish, and these never do by themselves, so they are ended when the
// process is told to stop - otherwise a restart (nodemon, or the kit's own
// stop) hangs. Browsers reconnect once the server is back.
const openStreams = new Set()
const endOpenStreams = () => {
  for (const stream of openStreams) {
    stream.end(`retry: ${RESTART_RETRY_MS}\n\n`)
  }
  openStreams.clear()
}
// The kit stops the server on these (SIGUSR2 is nodemon's restart)
for (const signal of ['SIGINT', 'SIGUSR2']) {
  process.on(signal, endOpenStreams)
}

module.exports = (router) => {
  // Join or leave a room from a link, eg /clinics?room=research-1. The kit has
  // already stored the query as data.room, so it is moved into settings and
  // the page reloaded without it. ?room=none leaves the room.
  router.use((req, res, next) => {
    if (req.method !== 'GET' || typeof req.query.room !== 'string') {
      return next()
    }

    const data = req.session.data
    delete data.room
    data.settings = data.settings || {}
    data.settings.sharedData = data.settings.sharedData || {}
    data.settings.sharedData.room = sharedData.findRoom(req.query.room) || ''

    const url = new URL(req.originalUrl, 'http://localhost')
    url.searchParams.delete('room')
    return res.redirect(`${url.pathname}${url.search}`)
  })

  // How this session is sharing, for /settings and the layout
  router.use((req, res, next) => {
    res.locals.sharedData = {
      ...sharedData.getSharingDetails(req.session.data),
      usersSignedInElsewhere: sharedData.getUsersSignedInElsewhere(
        req.session.data,
        req.sessionID
      )
    }
    next()
  })

  // Server-sent events: a stream of change notices for the session's channel.
  // Events made by this session are left out, so the page you've just saved
  // from isn't told about its own change.
  router.get('/shared-data/events', (req, res) => {
    const channelKey = sharedData.getChannelKey(req.session.data)
    const sessionId = req.sessionID

    // Stop express-session saving this request's copy of the session when the
    // stream closes, which would overwrite anything saved since it opened
    req.session = null

    // 204 tells the browser to stop reconnecting
    if (!channelKey) return res.status(204).end()

    res.set({
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive'
    })
    res.flushHeaders()
    res.write('retry: 3000\n\n')

    const unsubscribe = sharedData.subscribe(channelKey, (event) => {
      if (event.origin && event.origin === sessionId) return
      const { type, collection, ids, fields } = event
      res.write(
        `data: ${JSON.stringify({ type, collection, ids, fields })}\n\n`
      )
    })

    const heartbeat = setInterval(() => {
      res.write('event: heartbeat\ndata: ping\n\n')
      sharedData.touchPresence(sessionId)
    }, HEARTBEAT_MS)

    openStreams.add(res)

    req.on('close', () => {
      clearInterval(heartbeat)
      unsubscribe()
      openStreams.delete(res)
    })
  })

  // Change the server-wide mode from /settings. The chosen mode arrives as
  // settings[sharedData][mode], but it is not a per-session setting, so it is
  // applied to the server and removed from the session.
  router.get('/settings/shared-data', (req, res) => {
    const settings = req.session.data.settings || {}
    const newMode = settings.sharedData?.mode
    if (settings.sharedData) delete settings.sharedData.mode

    if (sharedData.setMode(newMode)) {
      req.flash('success', 'Shared data mode changed')
    }
    return res.redirect('/settings')
  })

  // The room to bring a browser back to after its session is reset, if any
  const getRoomToRejoin = (data) =>
    sharedData.getMode() === 'room'
      ? sharedData.getSharingDetails(data).room
      : null

  // The footer "Reset data" link comes here without JavaScript when sharing.
  // Like the kit's own reset page, but the form clears the shared changes
  // too. The return page names the room, so the browser rejoins it.
  router.get('/shared-data/reset', (req, res) => {
    const returnUrl = new URL(
      typeof req.query.returnPage === 'string' &&
      req.query.returnPage.startsWith('/') &&
      !req.query.returnPage.startsWith('//')
        ? req.query.returnPage
        : '/',
      'http://localhost'
    )
    const room = getRoomToRejoin(req.session.data)
    if (room) returnUrl.searchParams.set('room', room)

    return res.render('shared-data/reset', {
      returnPage: `${returnUrl.pathname}${returnUrl.search}`
    })
  })

  // Resetting data from the footer link clears the shared changes for
  // everyone sharing them, then this session.
  //
  // With JavaScript, main.js calls this before the kit's own reset, which
  // clears this session, and uses the room in the response to bring the
  // browser back to the same room afterwards. Without, the form on the page
  // above posts here, and is passed on to the kit's reset with its return
  // page (307 keeps it a POST, with the same form data).
  router.post('/shared-data/reset', (req, res) => {
    const data = req.session.data
    const channelKey = sharedData.getChannelKey(data)
    if (channelKey) {
      sharedData.resetChannel(channelKey, req.sessionID)
    }
    sharedData.forgetPresence(req.sessionID)
    if (req.body?.returnPage) {
      return res.redirect(307, '/prototype-admin/reset-session-data')
    }
    return res.json({ room: getRoomToRejoin(data) })
  })
}
