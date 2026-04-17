// app/routes.js

// External dependencies
const express = require('express')
const {
  regenerateData,
  needsRegeneration
} = require('./lib/utils/regenerate-data')
const { resetCallSequence } = require('./lib/utils/random')

const router = express.Router()

// Parse JSON request bodies (in addition to URL-encoded, which the kit handles)
router.use(express.json())

// Memory logging - tracks growth and logs significant changes
let requestCount = 0
let lastLoggedRss = 0
const logMemory = (context, sessionData) => {
  const mem = process.memoryUsage()
  const rss = mem.rss / 1024 / 1024
  let sessionInfo = ''
  if (sessionData) {
    try {
      const sessionStr = JSON.stringify(sessionData)
      sessionInfo = `, session: ${(sessionStr.length / 1024 / 1024).toFixed(2)}MB`
    } catch (e) {
      sessionInfo = ', session: [error]'
    }
  }
  console.log(
    `[Memory ${context}] heap: ${(mem.heapUsed / 1024 / 1024).toFixed(1)}MB, rss: ${rss.toFixed(1)}MB, requests: ${requestCount}${sessionInfo}`
  )
  lastLoggedRss = rss
}

// Log memory on startup
logMemory('startup')

// Keep regeneration middleware before other routes
router.use(async (req, res, next) => {
  try {
    requestCount++
    const isStaticRequest = req.path.match(
      /\.(js|css|ico|png|jpg|svg|woff|woff2)$/
    )

    // Log memory if RSS has grown significantly (>20MB) since last log
    const currentRss = process.memoryUsage().rss / 1024 / 1024
    if (!isStaticRequest && currentRss - lastLoggedRss > 20) {
      logMemory(`growth on ${req.method} ${req.path}`, req.session?.data)
    }

    // Also log periodically
    if (!isStaticRequest && requestCount % 50 === 0) {
      logMemory(`request #${requestCount}`, req.session?.data)
    }

    if (needsRegeneration(req.session.data?.generationInfo)) {
      logMemory('before-regeneration')
      console.log('Regenerating data for new day...')
      await regenerateData(req)
      logMemory('after-regeneration')
    }
    next()
  } catch (err) {
    console.error('Error checking/regenerating data:', err)
    next(err)
  }
})

// Reset randomisation per page load
router.use((req, res, next) => {
  resetCallSequence()
  next()
})

// Support swapping users
router.use((req, res, next) => {
  const data = req.session.data

  if (data && data.currentUser && data.currentUserId != data.currentUser.id) {
    const selectedUser = data.users.find(
      (user) => user.id === data.currentUserId
    )

    if (selectedUser) {
      console.log(
        `Changing user to user ${selectedUser.firstName} ${selectedUser.lastName}`
      )

      data.currentUser = selectedUser
      res.locals.data.currentUser = selectedUser

      req.flash(
        'success',
        `Signed in as ${selectedUser.firstName} ${selectedUser.lastName}`
      )
    } else {
      console.log(
        `Cannot find user ${data.currentUserId} to sign in. Reverting to user 1`
      )

      data.currentUserId = data.currentUser.id
      res.locals.data.currentUserId = data.currentUser.id
    }
  }

  next()
})

// Clear query string from URL if clearQuery is present
// This is useful for removing query parameters after processing them
router.use((req, res, next) => {
  if (req.query.clearQuery === 'true') {
    // Remove clearQuery from session data
    if (req.session.data && req.session.data.clearQuery) {
      delete req.session.data.clearQuery
    }

    // Remove temp event from session data
    if (req.session.data && req.session.data.clearEvent) {
      delete req.session.data.event
    }

    // Redirect to the same URL without query string
    return res.redirect(req.path)
  }
  next()
})

// Admin route to save mammogram manifest
const fs = require('fs')
const path = require('path')

router.post(
  '/admin/mammogram-sets/save',
  express.json({ limit: '5mb' }),
  (req, res) => {
    try {
      const manifestPath = path.join(
        __dirname,
        'assets/images/mammogram-diagrams/manifest.json'
      )
      const output = JSON.stringify(req.body, null, 2)
      fs.writeFileSync(manifestPath, output, 'utf8')
      res.json({ success: true })
    } catch (err) {
      console.error('Failed to save manifest:', err)
      res.status(500).json({ error: err.message })
    }
  }
)

require('./routes/settings')(router)

// Modal fragment middleware — threads the _modal param through redirect chains
// and form submissions so any page can render as a modal fragment without
// per-route changes.
//
// Detection: XHR request (X-Requested-With header, set by modal.js fetch) OR
//            _modal=1 query/body param (survives server-side redirects and form posts).
//
// On detection:
//   - Sets res.locals.parentLayout so templates use the modal fragment layout
//   - Wraps res.redirect() to append ?_modal=1 to the target URL, threading
//     the param through any server-side redirects in the request chain
router.use((req, res, next) => {
  const isXhr = req.headers['x-requested-with'] === 'XMLHttpRequest'
  const hasModalParam = req.query._modal === '1' || req.body?._modal === '1'

  if (!isXhr && !hasModalParam) return next()

  res.locals.parentLayout = '_templates/layout-modal-form.html'

  // Wrap redirect to carry _modal=1 through server-side redirect chains.
  // The X-Requested-With header is stripped by the browser when following
  // redirects, so without this the fragment layout would be lost after a redirect.
  // For _modal_breakout redirects, send a special 200 fragment instead of a real
  // redirect — this prevents fetch from following the redirect and calling res.render,
  // which would consume the flash before the browser navigates to the destination.
  const originalRedirect = res.redirect.bind(res)
  res.redirect = (...args) => {
    let status, url
    if (typeof args[0] === 'number') {
      ;[status, url] = args
    } else {
      status = 302
      ;[url] = args
    }

    if (url && url.includes('_modal_breakout')) {
      // Intercept breakout redirects — send a minimal fragment that tells modal.js
      // to navigate the browser to the destination. The flash is not consumed here
      // because we bypass res.render (which is where express-flash reads req.flash()).
      return res.status(200).send(`<div data-modal-navigate="${url}"></div>`)
    }

    // Only thread _modal=1 through app-relative URLs, not external ones or already-tagged ones
    if (url && !url.startsWith('http') && !url.includes('_modal=')) {
      const separator = url.includes('?') ? '&' : '?'
      url = `${url}${separator}_modal=1`
    }
    originalRedirect(status, url)
  }

  next()
})

require('./routes/clinics')(router)
require('./routes/participants')(router)
require('./routes/events')(router)
require('./routes/reading')(router)
require('./routes/reports')(router)

router.get('/modal-examples', (req, res) => {
  res.render('_components/modal/examples')
})

// Style guide demo: form-in-modal example
router.post('/style-guide/modal-form-demo/save', (req, res) => {
  const isModal = req.headers['x-requested-with'] === 'XMLHttpRequest'
  const note = (req.body['demo-note'] || '').trim()

  if (!note) {
    const validationErrors = [
      { name: 'demo-note', text: 'Enter a note', href: '#demo-note' }
    ]
    if (isModal) {
      // Render the fragment with errors inside the modal
      return res.status(422).render('style-guide/modal-form-demo', {
        errors: validationErrors,
        flash: { error: validationErrors },
        values: { 'demo-note': req.body['demo-note'] }
      })
    }
    // Non-JS fallback: flash uses the name field so populateErrors can match
    req.flash('error', { name: 'demo-note', text: 'Enter a note' })
    return res.redirect('/style-guide/modal')
  }

  req.flash('success', `Note saved (demo \u2014 nothing was actually stored)`)
  res.redirect('/style-guide/modal')
})

// Workaround for Chrome DevTools requesting a specific URL
router.get('/.well-known/appspecific/com.chrome.devtools.json', (req, res) => {
  // Either return an empty JSON object
  res.json({})
  // Or send a 204 No Content response
  // res.status(204).end();
})

module.exports = router
