// app/routes/settings.js

const path = require('path')
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
}
