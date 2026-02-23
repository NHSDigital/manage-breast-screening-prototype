// app/data/session-data-defaults.local.example.js
//
// Copy this file to session-data-defaults.local.js to apply local overrides.
// That file is gitignored and won't be committed.
// Only include the settings you want to change - they're deep-merged on top of defaults.

module.exports = {
  settings: {
    debugMode: 'true',
    reading: {
      enableOpinionDelay: 'false'
    }
  }
}
