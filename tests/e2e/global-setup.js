// tests/e2e/global-setup.js
//
// The app regenerates its seed data on the first request of a new day, writing
// fresh files to app/data/generated. Tests read those files to pick their
// subjects, so we make that first request here - before any test reads them -
// and wait for it to finish. Without this, the first spec of a run could read
// yesterday's data while the server serves today's.

module.exports = async (config) => {
  const baseURL = config.projects[0].use.baseURL

  const response = await fetch(`${baseURL}/`)

  if (!response.ok) {
    throw new Error(
      `Test server did not respond OK to GET / (status ${response.status})`
    )
  }

  // Drain the body so the request is definitely complete
  await response.text()
}
