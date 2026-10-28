// app/routes/shared-data.js
//
// Routes for sharing changes between browsers. See app/lib/shared-data.js
// and docs/data-conventions.md.

const sharedData = require('../lib/shared-data')

// Heroku drops a connection that has sent nothing for 55 seconds
const HEARTBEAT_MS = 25 * 1000

// Open event streams. Stopping the server waits for every connection to
// finish, and these never do by themselves, so they are ended when the
// process is told to stop - otherwise a restart (nodemon, or the kit's own
// stop) hangs. Browsers reconnect once the server is back.
const openStreams = new Set()
const endOpenStreams = () => {
  for (const stream of openStreams) stream.end()
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
    res.locals.sharedData = sharedData.getSharingDetails(req.session.data)
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
      const { type, collection, ids } = event
      res.write(`data: ${JSON.stringify({ type, collection, ids })}\n\n`)
    })

    const heartbeat = setInterval(
      () => res.write(': heartbeat\n\n'),
      HEARTBEAT_MS
    )

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

  // Resetting data from the footer link clears the shared changes for
  // everyone sharing them. main.js calls this before the kit's own reset,
  // which clears this session, and uses the room in the response to bring the
  // browser back to the same room afterwards.
  router.post('/shared-data/reset', (req, res) => {
    const data = req.session.data
    const channelKey = sharedData.getChannelKey(data)
    if (channelKey) {
      sharedData.resetChannel(channelKey, req.sessionID)
    }
    const { room } = sharedData.getSharingDetails(data)
    return res.json({ room: sharedData.getMode() === 'room' ? room : null })
  })
}
