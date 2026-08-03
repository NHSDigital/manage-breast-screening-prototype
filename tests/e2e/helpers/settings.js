// tests/e2e/helpers/settings.js
//
// Journeys in this prototype branch on session settings - whether forms open
// in modals, whether check-in asks to confirm identity, which annotation mode
// image reading uses, and so on. Every spec pins the settings it depends on
// before it starts, for two reasons:
//
//   1. app/data/session-data-defaults.local.js is gitignored, so any developer
//      can be running with different defaults to the ones in the repo.
//   2. A journey that silently follows whichever branch the defaults happen to
//      select isn't testing anything in particular.
//
// The kit's autoStoreData middleware copies query parameters into session data,
// so one navigation with a settings query string is enough to pin them - the
// same trick the dev index page uses for its preset links.

/**
 * Settings the screening appointment journeys depend on
 */
const appointmentSettings = {
  // Medical history and symptom forms open in modals
  'settings[modalForms]': 'true',
  // Check-in goes through the "Confirm participant identity" modal
  'settings[appointment][confirmIdentityOnCheckIn]': 'true',
  // Images are recorded manually rather than streamed in from the modality
  'settings[appointment][manualImageCollection]': 'true'
}

/**
 * Settings the image reading journey depends on
 */
const readingSettings = {
  'settings[modalForms]': 'true',
  'settings[reading][blindReading]': 'true',
  // No pause on the confirmation banner after recording an opinion
  'settings[reading][enableOpinionDelay]': 'false',
  // Recall goes via the review/confirm page before it is saved
  'settings[reading][confirmRecallForAssessment]': 'true',
  // Annotations are described in text rather than marked on the images.
  // The image-marking modes need pixel-accurate clicks on a canvas, which is
  // more than a smoke test should take on - see notes in reading.spec.js.
  'settings[reading][annotationsMode]': 'without-images',
  'settings[reading][secondReaderComparison]': 'off',
  // Reads confirm as soon as they are saved, so journeys see settled states
  // rather than cases waiting out the confirmation delay
  'settings[reading][confirmationDelay]': '0'
}

/**
 * Pin session settings, then land on the home page.
 *
 * @param {import('@playwright/test').Page} page - Playwright page
 * @param {Record<string, string>} settings - Query-string settings to store
 */
const pinSettings = async (page, settings) => {
  const query = new URLSearchParams(settings).toString()
  await page.goto(`/?${query}`)
}

module.exports = {
  appointmentSettings,
  readingSettings,
  pinSettings
}
