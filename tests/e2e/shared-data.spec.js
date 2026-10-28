// tests/e2e/shared-data.spec.js
//
// Sharing changes between browsers. Each browser is its own Playwright
// context, so its own session, as on separate machines.
//
// The server's mode is set to 'room' rather than 'on': other specs run in
// parallel against the same server, and sessions outside a room keep their own
// changes, so they are unaffected.

const { test, expect } = require('./helpers/fixtures')
const { pinSettings } = require('./helpers/settings')
const { findTodayAppointment } = require('./helpers/seed-data')

const settings = {
  // Check in straight from the row, without the confirm identity modal
  'settings[appointment][confirmIdentityOnCheckIn]': 'false'
}

const openBrowser = async (browser) => {
  const context = await browser.newContext()
  const page = await context.newPage()
  await pinSettings(page, settings)
  return { context, page }
}

const modesByLabel = {
  'Off': 'off',
  'On': 'on',
  'By room': 'room'
}

// The count on a clinic list tab, eg 3 from "Checked in 3"
const getTabCount = async (page, label) => {
  const text = await page
    .locator('.app-secondary-navigation__link', { hasText: label })
    .innerText()
  return Number(text.replace(/\D/g, ''))
}

test.describe('Shared data', () => {
  test('a check-in in one browser shows live in another in the same room, and nowhere else', async ({
    browser,
    page
  }) => {
    const { clinic, appointment } = findTodayAppointment({
      status: 'scheduled'
    })
    const row = (otherPage) =>
      otherPage.locator(`tr[data-fragment-id="${appointment.id}"]`)
    const checkedInUrl = `/clinics/${clinic.id}/checked-in`

    // Reception's browser also sets the server-wide mode, noting the one it
    // started in so it can be put back afterwards
    await pinSettings(page, settings)
    await page.goto('/settings')
    const originalModeLabel = await page
      .locator('p', { hasText: /^\s*Mode:/ })
      .locator('strong')
      .innerText()
    const originalMode = modesByLabel[originalModeLabel.trim()] || 'off'
    await page.goto('/settings/shared-data?settings[sharedData][mode]=room')
    await page.goto(`/clinics/${clinic.id}/all?room=research-1`)

    const mammographyRoom = await openBrowser(browser)
    const otherRoom = await openBrowser(browser)
    const notInRoom = await openBrowser(browser)

    try {
      await mammographyRoom.page.goto(`${checkedInUrl}?room=research-1`)
      await otherRoom.page.goto(`${checkedInUrl}?room=research-2`)
      await notInRoom.page.goto(checkedInUrl)
      await expect(row(mammographyRoom.page)).toHaveCount(0)
      const countBefore = await getTabCount(mammographyRoom.page, 'Checked in')

      await row(page).locator('.js-check-in-link').click()
      await expect(
        row(page).getByText('Checked in', { exact: true })
      ).toBeVisible()

      // The mammography room's list updates without a reload
      await expect(row(mammographyRoom.page)).toBeVisible()
      await expect
        .poll(() => getTabCount(mammographyRoom.page, 'Checked in'))
        .toBe(countBefore + 1)

      // A different room, or no room, doesn't see the change even on reload
      await otherRoom.page.reload()
      await notInRoom.page.reload()
      await expect(row(otherRoom.page)).toHaveCount(0)
      await expect(row(notInRoom.page)).toHaveCount(0)

      // Resetting from one browser resets the room for everyone in it
      await page.getByRole('link', { name: 'Reset data' }).click()
      await page.waitForURL(/\/clinics\//)
      await expect(row(mammographyRoom.page)).toHaveCount(0)
    } finally {
      await mammographyRoom.context.close()
      await otherRoom.context.close()
      await notInRoom.context.close()
      await page.goto(
        `/settings/shared-data?settings[sharedData][mode]=${originalMode}`
      )
    }
  })
})
