// app/lib/utils/regenerate-data.js

const generateData = require('../generate-seed-data')
const { join, resolve } = require('path')
const dayjs = require('dayjs')
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

  // Generate new data
  await generateData({
    seedDataProfile: resolvedProfile.key,
    seedDataProfileObject: resolvedProfile
  })

  // Reload the shared data store from the freshly generated files. This also
  // updates the store's generationId, which invalidates every session's
  // _changes (see the attach middleware in app/routes.js) - so a regenerate
  // resets data for all sessions, not just this one.
  // (Required lazily to avoid loading the store before generation at boot.)
  require('../data-store').reload()

  // Clear the require cache for session data defaults so they re-evaluate
  delete require.cache[require.resolve(sessionDataPath)]

  // Reset this session to fresh defaults. Collections and generationInfo are
  // not part of defaults - the attach middleware provides them from the store.
  // IMPORTANT: Modify existing object rather than replacing it
  // Replacing breaks express-session's change tracking
  const freshDefaults = require('../../data/session-data-defaults')

  // Preserve settings before reset
  const preservedSettings = req.session.data.settings
    ? JSON.parse(JSON.stringify(req.session.data.settings))
    : null

  // Clear existing keys
  Object.keys(req.session.data).forEach((key) => delete req.session.data[key])
  // Merge in fresh defaults
  Object.assign(req.session.data, freshDefaults)

  // Restore settings if they existed
  if (preservedSettings) {
    req.session.data.settings = preservedSettings
  }

  if (!req.session.data.settings) {
    req.session.data.settings = {}
  }

  const refreshedSeedProfiles = ensureSeedProfilesState(
    req.session.data.settings
  )
  refreshedSeedProfiles.selectedKey = resolvedProfile.key
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
