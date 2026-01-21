const { join, resolve } = require('node:path')

const express = require('express')

const router = express.Router()

const password = process.env.PROTOTYPE_PASSWORD

const { encryptPassword } = require('../utils')

router.get('/password', (req, res) => {
  const returnURL = req.query.returnURL || '/'
  const { error } = req.query
  res.render('password', {
    returnURL,
    error
  })
})

// Check authentication password
router.post('/password', (req, res) => {
  const submittedPassword = req.body.password
  const { returnURL } = req.body

  if (submittedPassword === password) {
    // see lib/middleware/authentication.js for explanation
    res.cookie('authentication', encryptPassword(password), {
      maxAge: 1000 * 60 * 60 * 24 * 30, // 30 days
      sameSite: 'None', // Allows GET and POST requests from other domains
      httpOnly: true,
      secure: true
    })
    res.redirect(returnURL)
  } else {
    res.redirect(
      `/prototype-admin/password?error=wrong-password&returnURL=${encodeURIComponent(returnURL)}`
    )
  }
})

router.get('/reset', (req, res) => {
  let { returnPage } = req.query

  // Allow local paths only
  if (!returnPage?.startsWith('/')) {
    returnPage = '/'
  }

  res.render('reset', {
    returnPage
  })
})

router.all('/reset-session-data', (req, res) => {
  let { returnPage } = req.body ?? req.query

  // Allow local paths only
  if (!returnPage?.startsWith('/')) {
    returnPage = '/'
  }

  // Log memory before reset
  const memBefore = process.memoryUsage()
  console.log(
    `[Memory before-reset] heap: ${(memBefore.heapUsed / 1024 / 1024).toFixed(1)}MB, rss: ${(memBefore.rss / 1024 / 1024).toFixed(1)}MB`
  )

  const dataDirectory = join(__dirname, '../../app/data')
  const sessionDataPath = resolve(dataDirectory, 'session-data-defaults.js')

  // Get the cached session defaults
  // Note: We don't clear require cache here as that causes memory growth
  // when done repeatedly (JSON parsing artifacts don't get GC'd properly).
  // The autoStoreData middleware will merge these defaults with session data
  // on the next request anyway.
  const sessionDefaults = require(sessionDataPath)

  // Preserve settings before reset
  const preservedSettings = req.session.data.settings ? JSON.parse(JSON.stringify(req.session.data.settings)) : null

  // Clear existing session data and reset to defaults
  // Using Object.assign to create a shallow copy - the arrays (participants,
  // events, clinics) remain shared references which is fine since sessions
  // don't typically modify the original arrays, just individual items
  Object.keys(req.session.data).forEach((key) => delete req.session.data[key])
  Object.assign(req.session.data, sessionDefaults)

  // Restore settings if they existed
  if (preservedSettings) {
    req.session.data.settings = preservedSettings
  }

  // Log memory after reset
  const memAfter = process.memoryUsage()
  console.log(
    `[Memory after-reset] heap: ${(memAfter.heapUsed / 1024 / 1024).toFixed(1)}MB, rss: ${(memAfter.rss / 1024 / 1024).toFixed(1)}MB`
  )

  req.flash('success', 'Session data cleared')

  res.render('reset-done', {
    returnPage
  })
})

module.exports = router
