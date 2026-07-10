// app/data/session-data-defaults.js

const _ = require('lodash')
const users = require('./users')
// Used to simulate in prototype
const breastScreeningUnits = require('./breast-screening-units')
// All breast screening units
const allBreastScreeningUnits = require('./all-breast-screening-units')
const medicalHistoryTypes = require('./medical-history-types')
const screeningRooms = require('./screening-rooms')
const path = require('path')
const fs = require('fs')
const { needsRegeneration } = require('../lib/utils/regenerate-data')
const config = require('../config')
const repeatReasons = require('./repeat-reasons')
const symptomTypes = require('./symptom-types')
const abnormalityTypes = require('./abnormality-types')
const {
  DEFAULT_SEED_DATA_PROFILE,
  SEED_DATA_PROFILES,
  createSeedProfilesState
} = require('../lib/generators/seed-profiles')

// Check if generated data folder exists and create if needed
const generatedDataPath = path.join(__dirname, 'generated')
if (!fs.existsSync(generatedDataPath)) {
  fs.mkdirSync(generatedDataPath)
}

let participants = []
let events = []
let generationInfo = {
  generatedAt: 'Never',
  seedDataProfile: DEFAULT_SEED_DATA_PROFILE,
  stats: { participants: 0, clinics: 0, events: 0 }
}

// Load generation info
const generationInfoPath = path.join(generatedDataPath, 'generation-info.json')
if (fs.existsSync(generationInfoPath)) {
  try {
    generationInfo = JSON.parse(fs.readFileSync(generationInfoPath))
  } catch (err) {
    console.warn('Error reading generation info:', err)
  }
}

if (!generationInfo.seedDataProfile) {
  generationInfo.seedDataProfile = DEFAULT_SEED_DATA_PROFILE
}

if (!SEED_DATA_PROFILES[generationInfo.seedDataProfile]) {
  generationInfo.seedDataProfile = DEFAULT_SEED_DATA_PROFILE
}

// Generate or load data
if (needsRegeneration(generationInfo)) {
  console.log('Generating new seed data...')
  require('../lib/generate-seed-data.js')({
    seedDataProfile: generationInfo.seedDataProfile
  })

  // Reload generation info written by the generator
  if (fs.existsSync(generationInfoPath)) {
    try {
      generationInfo = JSON.parse(fs.readFileSync(generationInfoPath))
    } catch (err) {
      console.warn('Error reading generation info after regeneration:', err)
    }
  }

  if (!generationInfo.seedDataProfile) {
    generationInfo.seedDataProfile = DEFAULT_SEED_DATA_PROFILE
  }

  // The shared data store may already have loaded the stale files (require
  // order at boot), so reload it now the generator has written fresh ones
  require('../lib/data-store').reload()
}

// Load generated data
// Clinics are NOT loaded here: they live in the shared data store
// (app/lib/data-store.js) and are attached to each request by middleware in
// app/routes.js, so they never get copied into (or serialised with) sessions.
try {
  participants = require('./generated/participants.json').participants
  events = require('./generated/events.json').events
} catch (err) {
  console.warn('Error loading generated data:', err)
}

// In development, freeze these seed arrays so any leftover in-place mutation
// of a shared record throws at the offending line. Only the first request of
// a session sees these exact objects (afterwards the session store holds its
// own parsed copy), but that is enough to flush out bad writers early.
// These arrays move to the shared data store in the next phase.
const { deepFreeze, shouldFreeze } = require('../lib/data-store')
if (shouldFreeze) {
  deepFreeze(participants)
  deepFreeze(events)
}

const defaultSettings = {
  darkMode: 'false',
  compactMode: 'false',
  debugMode: 'false',
  showEnvironmentBanner: 'true',
  mammogramViewOrder: 'cc-first', // 'cc-first' | 'mlo-first'
  modalForms: 'true',
  seedProfiles: {
    ...createSeedProfilesState(),
    selectedKey: generationInfo.seedDataProfile
  },
  screening: {
    confirmIdentityOnCheckIn: 'true',
    manualImageCollection: 'true',
    showParticipantSection: 'false',
    useCondensedReviewSummaries: 'true',
    addedToWorklist: 'true',
    imageStreaming: {
      enabled: 'true',
      intervalMs: '3000'
    }
  },
  reading: {
    blindReading: config.reading.blindReading,
    confirmNormal: 'false',
    confirmNormalWithDetails: 'false',
    confirmTechnicalRecall: 'false',
    confirmRecallForAssessment: 'true',
    showRemaining: 'true',
    autoOpenPacsViewer: 'false',
    enableOpinionDelay: 'true',
    annotationsMode: 'with-images-simple', // 'without-images' | 'with-images-simple' | 'with-images' | 'with-images-progressive'
    secondReaderComparison: 'off', // 'early' | 'late' | 'off'
    compareWhen: 'non_normal', // 'non_normal' | 'discordant_only'
    arbitrationPolicy: 'discordant_only', // 'discordant_only' | 'all_non_normal'
    lazySessions: 'true',
    defaultSessionSize: '25'
  }
}

const defaults = {
  users,
  currentUserId: users[0].id,
  currentUser: users[0],
  currentScreeningRoom: screeningRooms[0].id,
  breastScreeningUnits,
  allBreastScreeningUnits,
  screeningRooms,
  participants,
  events,
  generationInfo,
  config,
  settings: defaultSettings,
  defaultSettings,
  medicalHistoryTypes,
  repeatReasons,
  symptomTypes,
  abnormalityTypes
}

// Load local overrides if they exist (gitignored, not committed)
let localOverrides = {}
try {
  localOverrides = require('./session-data-defaults.local')
} catch (err) {
  // No local overrides file - that's fine
}

module.exports = _.merge({ ...defaults }, localOverrides)
