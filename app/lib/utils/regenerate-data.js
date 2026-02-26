// app/lib/utils/regenerate-data.js

const generateData = require('../generate-seed-data')
const { join, resolve } = require('path')
const dayjs = require('dayjs')
const fs = require('fs')
const {
  DEFAULT_SEED_DATA_PROFILE,
  ensureSeedProfilesState,
  getSeedDataProfileFromState
} = require('../generators/seed-profiles')

async function regenerateData(req, options = {}) {
  if (!req.session.data.settings) {
    req.session.data.settings = {}
  }

  const seedProfiles = ensureSeedProfilesState(req.session.data.settings)
  const profileFromSession = seedProfiles.selectedKey
  const requestedProfileName =
    options.seedDataProfile || profileFromSession || DEFAULT_SEED_DATA_PROFILE
  const resolvedProfile = getSeedDataProfileFromState(
    seedProfiles,
    requestedProfileName
  )

  const dataDirectory = join(__dirname, '../../data')
  const sessionDataPath = resolve(dataDirectory, 'session-data-defaults.js')
  const generatedDataPath = resolve(dataDirectory, 'generated')
  const generationInfoPath = join(generatedDataPath, 'generation-info.json')

  // Generate new data
  await generateData({
    seedDataProfile: resolvedProfile.key,
    seedDataProfileObject: resolvedProfile
  })

  // Clear the require cache for session data defaults
  delete require.cache[require.resolve(sessionDataPath)]

  // Clear cache for the generated JSON files
  Object.keys(require.cache).forEach((key) => {
    if (key.startsWith(generatedDataPath)) {
      delete require.cache[key]
    }
  })

  // Read generation info including stats
  let generationInfo = {
    generatedAt: new Date().toISOString(),
    stats: { participants: 0, clinics: 0, events: 0 },
    seedDataProfile: resolvedProfile.key
  }

  try {
    if (fs.existsSync(generationInfoPath)) {
      generationInfo = JSON.parse(fs.readFileSync(generationInfoPath))
    }
  } catch (err) {
    console.warn('Error reading generation info:', err)
  }

  // Reload session data defaults with fresh data and updated generation info
  // req.session.data = {
  //   ...require('../../data/session-data-defaults'),
  //   generationInfo
  // }
  // IMPORTANT: Modify existing object rather than replacing it
  // Replacing breaks express-session's change tracking
  const freshDefaults = require('../../data/session-data-defaults')

  // Preserve settings before reset
  const preservedSettings = req.session.data.settings
    ? JSON.parse(JSON.stringify(req.session.data.settings))
    : null

  // Clear existing keys
  Object.keys(req.session.data).forEach((key) => delete req.session.data[key])
  // Merge in fresh defaults and generation info
  Object.assign(req.session.data, freshDefaults, { generationInfo })

  // Restore settings if they existed
  if (preservedSettings) {
    req.session.data.settings = preservedSettings
  }

  if (!req.session.data.settings) {
    req.session.data.settings = {}
  }

  const refreshedSeedProfiles = ensureSeedProfilesState(req.session.data.settings)
  refreshedSeedProfiles.selectedKey = resolvedProfile.key

  req.session.data.generationInfo.seedDataProfile = resolvedProfile.key
}

function needsRegeneration(generationInfo) {
  if (!generationInfo?.generatedAt) return true

  const generatedDate = dayjs(generationInfo.generatedAt).startOf('day')
  const today = dayjs().startOf('day')
  return !generatedDate.isSame(today, 'day')
}

module.exports = {
  regenerateData,
  needsRegeneration
}
