// app/data/session-data-defaults.js

const users = require('./users')
// Used to simulate in prototype
const breastScreeningUnits = require('./breast-screening-units')
// All breast screening units
const allBreastScreeningUnits = require('./all-breast-screening-units')
const path = require('path')
const fs = require('fs')
const { needsRegeneration } = require('../lib/utils/regenerate-data')
const config = require('../config')

// Check if generated data folder exists and create if needed
const generatedDataPath = path.join(__dirname, 'generated')
if (!fs.existsSync(generatedDataPath)) {
  fs.mkdirSync(generatedDataPath)
}

let participants = []
let clinics = []
let events = []
let generationInfo = {
  generatedAt: 'Never',
  stats: { participants: 0, clinics: 0, events: 0 },
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

// Generate or load data
if (needsRegeneration(generationInfo)) {
  console.log('Generating new seed data...')
  require('../lib/generate-seed-data.js')()

  // Save generation info
  fs.writeFileSync(
    generationInfoPath,
    JSON.stringify({ generatedAt: new Date().toISOString() })
  )
}

// Load generated data
try {
  participants = require('./generated/participants.json').participants
  clinics = require('./generated/clinics.json').clinics
  events = require('./generated/events.json').events
} catch (err) {
  console.warn('Error loading generated data:', err)
}

const defaultSettings = {
  darkMode: 'false',
  screening: {
    confirmIdentityOnCheckIn: 'true',
  },
  reading: {
    blindReading: config.reading.blindReading,
    confirmNormal: 'false',
    showRemaining: 'true',
    showRepeatsTag: 'false',
    showPacsViewer: 'true',
  },
}

module.exports = {
  users,
  currentUser: users[0],
  breastScreeningUnits,
  allBreastScreeningUnits,
  participants,
  clinics,
  events,
  generationInfo,
  config,
  settings: defaultSettings,
  defaultSettings
}
