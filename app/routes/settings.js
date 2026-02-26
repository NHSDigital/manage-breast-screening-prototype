// app/routes/settings.js

const { regenerateData } = require('../lib/utils/regenerate-data')
const {
  CUSTOM_SEED_DATA_PROFILE,
  DEFAULT_SEED_DATA_PROFILE,
  ensureSeedProfilesState,
  getSeedDataProfileFromState,
  mergeDeep
} = require('../lib/generators/seed-profiles')

const parseProbability = (value, fallbackValue) => {
  const parsed = Number(value)

  if (Number.isNaN(parsed)) {
    return fallbackValue
  }

  if (parsed < 0) {
    return 0
  }

  if (parsed > 1) {
    return 1
  }

  return parsed
}

const getCustomOverridesFromBody = (body = {}, fallbackProfile = {}) => {
  return {
    medicalInformation: {
      probabilityOfSymptoms: parseProbability(
        body?.medicalInformation?.probabilityOfSymptoms,
        fallbackProfile?.medicalInformation?.probabilityOfSymptoms
      )
    },
    specialAppointment: {
      probability: parseProbability(
        body?.specialAppointment?.probability,
        fallbackProfile?.specialAppointment?.probability
      )
    },
    previousMammograms: {
      rate: parseProbability(
        body?.previousMammograms?.rate,
        fallbackProfile?.previousMammograms?.rate
      )
    }
  }
}

module.exports = (router) => {
  // Ensure any POST to settings resolves to a GET render
  router.post('/settings', (req, res) => {
    return res.redirect(303, '/settings')
  })

  router.get('/settings/seed-profiles/custom', (req, res) => {
    if (!req.session.data.settings) {
      req.session.data.settings = {}
    }

    ensureSeedProfilesState(req.session.data.settings)

    return res.render('settings/seed-profiles/custom')
  })

  router.post('/settings/seed-profiles/custom', (req, res) => {
    const submitAction = req.body?.settings?.seedProfiles?.customForm?.action

    if (!req.session.data.settings) {
      req.session.data.settings = {}
    }

    const seedProfiles = ensureSeedProfilesState(req.session.data.settings)
    const customForm = req.body?.settings?.seedProfiles?.customForm || {}
    const requestedBaseKey = customForm.baseKey || seedProfiles.customBaseKey
    const baseProfileKey = seedProfiles.profiles[requestedBaseKey]
      ? requestedBaseKey
      : DEFAULT_SEED_DATA_PROFILE
    const baseProfile = getSeedDataProfileFromState(seedProfiles, baseProfileKey)
    const customOverrides = getCustomOverridesFromBody(customForm, baseProfile)
    const customProfile = {
      ...mergeDeep(baseProfile, customOverrides),
      key: CUSTOM_SEED_DATA_PROFILE,
      label: 'Custom'
    }

    seedProfiles.customBaseKey = baseProfileKey
    seedProfiles.selectedKey = CUSTOM_SEED_DATA_PROFILE
    seedProfiles.profiles[CUSTOM_SEED_DATA_PROFILE] = customProfile

    if (submitAction === 'save-and-regenerate') {
      regenerateData(req, {
        seedDataProfile: CUSTOM_SEED_DATA_PROFILE
      })
        .then(() => {
          req.flash('success', 'Custom profile saved and data regenerated')
          return res.redirect(303, '/settings')
        })
        .catch((err) => {
          console.error('Error regenerating data from custom profile:', err)
          req.flash('error', 'Custom profile saved but data regeneration failed')
          return res.redirect(303, '/settings/seed-profiles/custom')
        })

      return
    }

    req.flash('success', 'Custom profile updated')

    return res.redirect(303, '/settings/seed-profiles/custom')
  })

  // Handle regenerate data action
  router.post('/settings/regenerate', async (req, res) => {
    try {
      if (!req.session.data.settings) {
        req.session.data.settings = {}
      }

      const seedProfiles = ensureSeedProfilesState(req.session.data.settings)
      const selectedProfile = req.body?.settings?.seedProfiles?.selectedKey

      if (selectedProfile && seedProfiles.profiles[selectedProfile]) {
        seedProfiles.selectedKey = selectedProfile
      }

      await regenerateData(req, {
        seedDataProfile: seedProfiles.selectedKey
      })

      req.flash('success', 'Data regenerated successfully')
    } catch (err) {
      console.error('Error regenerating data:', err)
      req.flash('error', 'Error regenerating data')
    }
    return res.redirect(303, '/settings')
  })
}
