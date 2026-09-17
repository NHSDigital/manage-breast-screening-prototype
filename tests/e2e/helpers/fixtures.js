// tests/e2e/helpers/fixtures.js
//
// A `test` that fails if the app returned a server error at any point during
// the journey, whatever the assertions happened to look at.
//
// This matters because a lot of the app's requests are made by JavaScript -
// modal forms fetch their content, check-in posts in the background. A 500
// there leaves the page looking merely unfinished, so without this the failure
// shows up as an unrelated timeout further down the journey.

const base = require('@playwright/test')

const test = base.test.extend({
  page: async ({ page }, use) => {
    const serverErrors = []

    page.on('response', (response) => {
      if (response.status() >= 500) {
        serverErrors.push(
          `${response.status()} ${response.request().method()} ${response.url()}`
        )
      }
    })

    await use(page)

    if (serverErrors.length) {
      throw new Error(
        `The app returned server errors during this journey:\n  ${serverErrors.join('\n  ')}`
      )
    }
  }
})

module.exports = { test, expect: base.expect }
