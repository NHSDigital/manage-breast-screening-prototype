// app/routes/settings.js

const { regenerateData } = require('../lib/utils/regenerate-data')

module.exports = router => {
  // Handle regenerate data action
  router.post('/settings/regenerate', async (req, res) => {
    try {
      await regenerateData(req)
      req.flash('success', 'Data regenerated successfully')
    } catch (err) {
      console.error('Error regenerating data:', err)
      req.flash('error', 'Error regenerating data')
    }
    res.redirect('/settings')
  })

  // Handle regenerate data action
  router.get('/clear-data', async (req, res) => {
    console.log('Clearing session data')
    req.session.data = {}
    req.flash('success', 'Session data cleared')
    res.redirect('/settings')
  })
}
