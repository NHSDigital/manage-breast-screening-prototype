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
const users = require('../../app/data/users')

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

// Sets the server-wide mode to 'room' from this browser, and returns the mode
// it started in so it can be put back afterwards
const switchToRoomMode = async (page) => {
  await page.goto('/settings')
  const originalModeLabel = await page
    .locator('p', { hasText: /^\s*Mode:/ })
    .locator('strong')
    .innerText()
  await page.goto('/settings/shared-data?settings[sharedData][mode]=room')
  return modesByLabel[originalModeLabel.trim()] || 'off'
}

test.describe('Shared data', () => {
  // Both tests change the server-wide mode, so they mustn't overlap
  test.describe.configure({ mode: 'serial' })

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

    // Reception's browser also sets the server-wide mode
    await pinSettings(page, settings)
    const originalMode = await switchToRoomMode(page)
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

  test('an appointment page shows status changes from another browser live, and a banner for other changes', async ({
    browser,
    page
  }) => {
    const { clinic, appointment } = findTodayAppointment({
      status: 'scheduled',
      index: 2
    })
    const appointmentUrl = `/clinics/${clinic.id}/appointments/${appointment.id}`

    await pinSettings(page, settings)
    const originalMode = await switchToRoomMode(page)
    await page.goto(`/clinics/${clinic.id}/all?room=research-2`)

    const mammographyRoom = await openBrowser(browser)

    try {
      const otherPage = mammographyRoom.page
      await otherPage.goto(`${appointmentUrl}?room=research-2`)
      const header = otherPage.locator('#appointment-header')
      const details = otherPage.locator('#appointment-details')
      const banner = otherPage.locator('[data-live-updates-shown]')
      await expect(header.getByText('Scheduled', { exact: true })).toBeVisible()

      // Checking in also moves the episode on, which the header covers too,
      // so there is nothing left for a banner to announce
      await page.goto(`/clinics/${clinic.id}/check-in/${appointment.id}`)
      await expect(
        header.getByText('Checked in', { exact: true })
      ).toBeVisible()
      await expect(
        details.getByText('Checked in', { exact: true })
      ).toBeVisible()
      await expect(banner).toHaveCount(0)

      // A note isn't shown in a live region, so the page says it has changed.
      // The note saves from reception's working copy of the appointment,
      // which opening it sets up.
      await page.goto(appointmentUrl)
      await page.request.post(`${appointmentUrl}/appointment-note-answer`, {
        form: {
          'appointment[appointmentNote]': 'Shared data test note'
        }
      })
      await expect(banner).toBeVisible()
    } finally {
      await mammographyRoom.context.close()
      // Clear the room's changes so a failed run doesn't leave them for the next
      await page.request.post('/shared-data/reset')
      await page.goto(
        `/settings/shared-data?settings[sharedData][mode]=${originalMode}`
      )
    }
  })

  test('another user can resume a paused appointment and takes it over', async ({
    browser,
    page
  }) => {
    const { clinic, appointment } = findTodayAppointment({
      status: 'checked_in',
      index: 2
    })
    const appointmentUrl = `/clinics/${clinic.id}/appointments/${appointment.id}`
    const [firstUser, secondUser] = users.filter((user) =>
      user.role.includes('clinician')
    )
    const shortName = (user) => `${user.firstName.charAt(0)}. ${user.lastName}`

    await pinSettings(page, settings)
    const originalMode = await switchToRoomMode(page)
    await page.goto(
      `/clinics/${clinic.id}/all?room=research-2&currentUserId=${firstUser.id}`
    )

    const secondRoom = await openBrowser(browser)

    try {
      const otherPage = secondRoom.page
      await otherPage.goto(
        `/clinics/${clinic.id}/all?room=research-2&currentUserId=${secondUser.id}`
      )

      // The first user starts and then pauses the appointment
      await page.goto(`${appointmentUrl}/start`)
      await otherPage.goto(`${appointmentUrl}/appointment`)
      await expect(
        otherPage.getByText(`currently being run by ${shortName(firstUser)}`)
      ).toBeVisible()
      await page.request.post(`${appointmentUrl}/exit-appointment-answer`, {
        form: { _exitAction: 'save' }
      })

      // The second user resumes it, so it opens in the workflow for them, and
      // the first user sees that they are now running it
      await otherPage.goto(`${appointmentUrl}/resume`)
      await expect(otherPage.locator('.app-workflow-container')).toBeVisible()
      await page.goto(`${appointmentUrl}/appointment`)
      await expect(
        page.getByText(`currently being run by ${shortName(secondUser)}`)
      ).toBeVisible()
    } finally {
      await secondRoom.context.close()
      await page.request.post('/shared-data/reset')
      await page.goto(
        `/settings/shared-data?settings[sharedData][mode]=${originalMode}`
      )
    }
  })
})
