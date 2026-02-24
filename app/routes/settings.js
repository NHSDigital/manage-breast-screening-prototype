// app/routes/settings.js

const { regenerateData } = require('../lib/utils/regenerate-data')

module.exports = (router) => {
  // Ensure any POST to settings resolves to a GET render
  router.post('/settings', (req, res) => {
    return res.redirect(303, '/settings')
  })

  // Handle regenerate data action
  router.post('/settings/regenerate', async (req, res) => {
    try {
      const selectedProfile = req.body?.settings?.seedDataProfile

      await regenerateData(req, {
        seedDataProfile: selectedProfile
      })

      req.flash('success', 'Data regenerated successfully')
    } catch (err) {
      console.error('Error regenerating data:', err)
      req.flash('error', 'Error regenerating data')
    }
    return res.redirect(303, '/settings')
  })
}
