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

  console.log('Clearing session data')

  const dataDirectory = join(__dirname, '../../app/data')
  const sessionDataPath = resolve(dataDirectory, 'session-data-defaults.js')
  const generatedDataPath = resolve(dataDirectory, 'generated')

  // Clear the require cache for session data defaults
  // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
  delete require.cache[require.resolve(sessionDataPath)]

  // Clear cache for the generated JSON files
  Object.keys(require.cache).forEach((key) => {
    if (key.startsWith(generatedDataPath)) {
      // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
      delete require.cache[key]
    }
  })

  // Load fresh session defaults after clearing cache
  req.session.data = require(sessionDataPath)
  req.flash('success', 'Session data cleared')

  res.render('reset-done', {
    returnPage
  })
})

module.exports = router
