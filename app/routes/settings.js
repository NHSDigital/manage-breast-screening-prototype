// app/routes/settings.js

const { regenerateData } = require('../lib/utils/regenerate-data')
const {
  CUSTOM_SEED_DATA_PROFILE,
  DEFAULT_SEED_DATA_PROFILE,
  ensureSeedProfilesState,
  getSeedDataProfileFromState,
  mergeDeep
} = require('../lib/generators/seed-profiles')

const parsePercentageAsProbability = (value, fallbackProbability) => {
  const parsed = Number(value)
  const fallbackPercentage = Number(fallbackProbability) * 100

  if (Number.isNaN(parsed)) {
    return Number.isNaN(fallbackPercentage) ? 0 : fallbackPercentage / 100
  }

  if (parsed < 0) {
    return 0
  }

  if (parsed > 100) {
    return 1
  }

  return parsed / 100
}

const convertPercentageOverrides = (overrides, fallbackProfile) => {
  if (!overrides || typeof overrides !== 'object' || Array.isArray(overrides)) {
    return parsePercentageAsProbability(overrides, fallbackProfile)
  }

  return Object.keys(overrides).reduce((result, key) => {
    result[key] = convertPercentageOverrides(
      overrides[key],
      fallbackProfile?.[key]
    )

    return result
  }, {})
}

const getCustomOverridesFromBody = (body = {}, fallbackProfile = {}) => {
  const rawOverrides = {
    imageReading: body.imageReading,
    medicalInformation: body.medicalInformation,
    specialAppointment: body.specialAppointment,
    previousMammograms: body.previousMammograms,
    mammogram: body.mammogram,
    imageSetSelection: body.imageSetSelection
  }

  return convertPercentageOverrides(rawOverrides, {
    imageReading: fallbackProfile.imageReading,
    medicalInformation: fallbackProfile.medicalInformation,
    specialAppointment: fallbackProfile.specialAppointment,
    previousMammograms: fallbackProfile.previousMammograms,
    mammogram: fallbackProfile.mammogram,
    imageSetSelection: fallbackProfile.imageSetSelection
  })
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

    const seedProfiles = ensureSeedProfilesState(req.session.data.settings)
    const requestedBaseProfileKey =
      typeof req.query?.baseProfile === 'string' ? req.query.baseProfile : null
    const generatedProfileKey =
      req.session.data?.generationInfo?.seedDataProfile
    const hasValidRequestedProfile =
      requestedBaseProfileKey && seedProfiles.profiles[requestedBaseProfileKey]
    const hasValidGeneratedProfile =
      generatedProfileKey && seedProfiles.profiles[generatedProfileKey]
    const baseProfileKey = hasValidRequestedProfile
      ? requestedBaseProfileKey
      : hasValidGeneratedProfile
        ? generatedProfileKey
        : seedProfiles.customBaseKey || DEFAULT_SEED_DATA_PROFILE
    const formProfileKey = baseProfileKey
    const customFormProfile = getSeedDataProfileFromState(
      seedProfiles,
      formProfileKey
    )

    return res.render('settings/seed-profiles/custom', {
      customBaseProfileKey: baseProfileKey,
      customFormProfile
    })
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
    const baseProfile = getSeedDataProfileFromState(
      seedProfiles,
      baseProfileKey
    )
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
          req.flash(
            'error',
            'Custom profile saved but data regeneration failed'
          )
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
