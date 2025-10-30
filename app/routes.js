// app/routes.js

// External dependencies
const express = require('express')
// const {
//   regenerateData,
//   needsRegeneration
// } = require('./lib/utils/regenerate-data')
// const { resetCallSequence } = require('./lib/utils/random')

const router = express.Router()

// Keep regeneration middleware before other routes
// router.use(async (req, res, next) => {
//   try {
//     if (needsRegeneration(req.session.data?.generationInfo)) {
//       console.log('Regenerating data for new day...')
//       await regenerateData(req)
//     }
//     next()
//   } catch (err) {
//     console.error('Error checking/regenerating data:', err)
//     next(err)
//   }
// })

// Reset randomisation per page load
// router.use((req, res, next) => {
//   resetCallSequence()
//   next()
// })

// Support swapping users
router.use((req, res, next) => {
  const data = req.session.data

  // Check that required data exists before trying to access properties
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

require('./routes/settings')(router)
require('./routes/clinics')(router)
require('./routes/participants')(router)
require('./routes/events')(router)
require('./routes/reading')(router)

router.get('/modal-examples', (req, res) => {
  res.render('_components/modal/examples')
})

// TEST ROUTES - Simple session persistence test
router.get('/test-session-set', (req, res) => {
  const data = req.session.data
  data.testValue = 'TEST_VALUE_' + Date.now()
  data.testObject = { id: 'test123', name: 'Test Object' }
  console.log('[TEST SET] Set testValue to:', data.testValue)
  console.log('[TEST SET] Set testObject to:', data.testObject)
  res.redirect('/test-session-check')
})

router.get('/test-session-check', (req, res) => {
  const data = req.session.data
  console.log('[TEST CHECK] testValue is:', data.testValue)
  console.log('[TEST CHECK] testObject is:', data.testObject)
  res.send(`
    <h1>Session Test Results</h1>
    <p>testValue: ${data.testValue || 'UNDEFINED'}</p>
    <p>testObject: ${JSON.stringify(data.testObject) || 'UNDEFINED'}</p>
    <p><a href="/test-session-set">Run test again</a></p>
  `)
})

// Test with a form POST
router.get('/test-form', (req, res) => {
  res.send(`
    <h1>Test Form</h1>
    <form method="POST" action="/test-form-check">
      <label>Test input: <input name="testFormValue" value="Test from form"></label>
      <button type="submit">Submit</button>
    </form>
  `)
})

router.post('/test-form-submit', (req, res) => {
  console.log('[TEST FORM POST] Body:', req.body)
  console.log('[TEST FORM POST] req.session exists:', !!req.session)
  console.log('[TEST FORM POST] req.session.data exists:', !!req.session.data)
  console.log(
    '[TEST FORM POST] Session keys before redirect:',
    Object.keys(req.session.data || {})
  )
  console.log(
    '[TEST FORM POST] testFormValue in session:',
    req.session.data?.testFormValue
  )
  console.log('[TEST FORM POST] Session ID:', req.session.id)
  res.redirect('/test-form-check')
})

router.get('/test-form-check', (req, res) => {
  console.log(
    '[TEST FORM CHECK] testFormValue in session:',
    req.session.data?.testFormValue
  )
  console.log('[TEST FORM CHECK] Session ID:', req.session.id)
  res.send(`
    <h1>Form Test Results</h1>
    <p>testFormValue: ${req.session.data?.testFormValue || 'UNDEFINED'}</p>
    <p>Session ID: ${req.session.id || 'UNDEFINED'}</p>
    <p><a href="/test-form-real">Try again</a></p>
  `)
})

// Workaround for Chrome DevTools requesting a specific URL
router.get('/.well-known/appspecific/com.chrome.devtools.json', (req, res) => {
  // Either return an empty JSON object
  res.json({})
  // Or send a 204 No Content response
  // res.status(204).end();
})

module.exports = router
