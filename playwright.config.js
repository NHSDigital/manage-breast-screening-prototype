// playwright.config.js
//
// Config for the smoke suite - a small set of end-to-end journeys that catch
// "the app is broken" regressions (500s, dead routes, broken core flows).
// See docs/testing.md for how to run it.

const { defineConfig, devices } = require('@playwright/test')

// A dedicated port so the suite never collides with a dev server on 3000
const port = Number(process.env.SMOKE_PORT || 3010)
const baseURL = `http://localhost:${port}`

module.exports = defineConfig({
  testDir: './tests/e2e',
  globalSetup: './tests/e2e/global-setup.js',

  // Journeys are many pages long and the prototype renders a lot of markup
  timeout: 120_000,
  expect: { timeout: 15_000 },

  fullyParallel: true,
  workers: 3,
  reporter: process.env.CI ? [['github'], ['list']] : [['list']],

  use: {
    baseURL,

    // Cap individual actions well below the test timeout, so a step that can
    // never succeed (a field that is missing because its page errored) fails
    // in seconds rather than burning the whole test budget
    actionTimeout: 20_000,
    navigationTimeout: 30_000,

    // Taller than the default 720px. Modal forms in this prototype are long,
    // and Playwright refuses to click a control that sits outside the viewport
    viewport: { width: 1400, height: 1600 },

    trace: 'retain-on-failure',
    screenshot: 'only-on-failure'
  },

  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1400, height: 1600 }
      }
    }
  ],

  webServer: {
    // PROXY=true makes the kit skip its nodemon/browsersync watch wrapper, so
    // this is a single plain Express process that Playwright can start and kill
    command: `PORT=${port} PROXY=true node .`,
    url: baseURL,

    // Always start a fresh server. Without the watch wrapper the app loads its
    // modules once at boot, so reusing a server left over from an earlier run
    // would test the code as it was then - the suite would pass over a change
    // that is actually broken.
    reuseExistingServer: false,
    timeout: 180_000,
    stdout: 'ignore',
    stderr: 'pipe'
  }
})
