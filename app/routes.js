// app/routes.js

// External dependencies
const express = require('express')
const { regenerateData, needsRegeneration } = require('./lib/utils/regenerate-data')
const { resetCallSequence } = require('./lib/utils/random')

const router = express.Router()

// Keep regeneration middleware before other routes
router.use(async (req, res, next) => {
  try {
    if (needsRegeneration(req.session.data?.generationInfo)) {
      console.log('Regenerating data for new day...')
      await regenerateData(req)
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

// require('./routes/shared')(router)
require('./routes/settings')(router)
require('./routes/clinics')(router)
require('./routes/participants')(router)
require('./routes/events')(router)
require('./routes/reading')(router)


// Workaround for Chrome DevTools requesting a specific URL
router.get('/.well-known/appspecific/com.chrome.devtools.json', (req, res) => {
  // Either return an empty JSON object
  res.json({});
  // Or send a 204 No Content response
  // res.status(204).end();
})

module.exports = router
