// tests/e2e/clinic-list.spec.js
//
// Focused checks for clinic-list behaviours that update in place.

const { test, expect } = require('./helpers/fixtures')
const { appointmentSettings, pinSettings } = require('./helpers/settings')
const { findTodayAppointment, readCollection } = require('./helpers/seed-data')
const { waitForModalsReady, expectModalClosed } = require('./helpers/modals')
const dayjs = require('dayjs')

const findTodayStandardAppointment = () => {
  const today = dayjs().format('YYYY-MM-DD')
  const clinics = readCollection('clinics.json', 'clinics')
  const appointments = readCollection('appointments.json', 'appointments')
  const participants = readCollection('participants.json', 'participants')
  const todayClinicIds = new Set(
    clinics.filter((clinic) => clinic.date === today).map((clinic) => clinic.id)
  )

  const appointment = appointments.find((candidate) => {
    if (
      !todayClinicIds.has(candidate.clinicId) ||
      candidate.status !== 'scheduled' ||
      candidate.specialAppointment?.supportTypes?.length
    ) {
      return false
    }

    return !appointments.some(
      (other) =>
        other.clinicId === candidate.clinicId &&
        other.participantId === candidate.participantId &&
        other.specialAppointment?.supportTypes?.length
    )
  })

  if (!appointment) {
    throw new Error(
      'Seed data has no standard scheduled appointment in a clinic running today.'
    )
  }

  return {
    appointment,
    clinic: clinics.find((clinic) => clinic.id === appointment.clinicId),
    participant: participants.find(
      (participant) => participant.id === appointment.participantId
    )
  }
}

test.describe('Clinic appointment list', () => {
  test('checks in a row added by live search and keeps the All tab layout', async ({
    page
  }) => {
    const { clinic, appointment, participant } = findTodayAppointment({
      index: 1
    })
    const fullName = [
      participant.demographicInformation.firstName,
      participant.demographicInformation.middleName,
      participant.demographicInformation.lastName
    ]
      .filter(Boolean)
      .join(' ')

    await pinSettings(page, appointmentSettings)
    const initialSearch = 'NoMatchClinicListTest'
    await page.goto(
      `/clinics/${clinic.id}/all?search=${encodeURIComponent(initialSearch)}`
    )
    await page.evaluate(() => {
      window.__clipboardWrites = 0
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: {
          writeText: async () => {
            window.__clipboardWrites += 1
          }
        }
      })
    })
    await waitForModalsReady(page)

    const search = page.getByRole('searchbox', {
      name: 'Search by name or NHS number'
    })
    const row = page.locator(`tr[data-fragment-id="${appointment.id}"]`)
    await expect(row).toHaveCount(0)
    await search.fill(fullName)
    await page.waitForFunction(
      (value) => new URLSearchParams(location.search).get('search') === value,
      fullName
    )
    await expect(row).toBeVisible()
    const copyButton = row.locator('[data-module="app-copy-to-clipboard"]')
    await expect(copyButton).toBeVisible()

    await search.fill(fullName.slice(0, 5))
    await page.waitForFunction(
      (value) => new URLSearchParams(location.search).get('search') === value,
      fullName.slice(0, 5)
    )
    await expect(row).toBeVisible()
    await expect(copyButton).toBeVisible()
    await search.fill(fullName)
    await page.waitForFunction(
      (value) => new URLSearchParams(location.search).get('search') === value,
      fullName
    )
    await expect(row).toBeVisible()
    await expect(copyButton).toBeVisible()

    await copyButton.click()
    await expect
      .poll(() => page.evaluate(() => window.__clipboardWrites))
      .toBe(1)

    await row.locator('a[onclick*="check-in-modal"]').click()
    const modal = page.locator(`#check-in-modal-${appointment.id}`)
    const confirmButton = modal.getByRole('button', {
      name: 'Confirm identity and check in'
    })
    await expect(confirmButton).toHaveAttribute('data-current-filter', 'all')
    await confirmButton.click()
    await expectModalClosed(modal)
    await expect(row.getByText('Checked in', { exact: true })).toBeVisible()
    await expect(
      page.getByRole('columnheader', { name: 'Time completed' })
    ).toBeVisible()
    await expect(
      page.getByRole('columnheader', { name: 'Checked in' })
    ).toHaveCount(0)
  })

  test('updates waiting time while the checked-in list stays open', async ({
    page
  }) => {
    const { clinic, appointment } = findTodayAppointment({
      status: 'checked_in'
    })

    await page.goto(`/clinics/${clinic.id}/checked-in`)

    const waitingTime = page.locator(
      `tr[data-fragment-id="${appointment.id}"] .js-waiting-time`
    )
    await expect(waitingTime).toHaveAttribute('data-waiting-since', /\d{4}/)
    const initialText = await waitingTime.innerText()

    await expect
      .poll(() => waitingTime.innerText(), { timeout: 5000 })
      .not.toBe(initialText)
  })

  test('explains that search and filters together excluded participants', async ({
    page
  }) => {
    const { clinic, participant } = findTodayStandardAppointment()
    const fullName = [
      participant.demographicInformation.firstName,
      participant.demographicInformation.middleName,
      participant.demographicInformation.lastName
    ]
      .filter(Boolean)
      .join(' ')
    const query = new URLSearchParams({
      search: fullName,
      specialAppointment: 'yes'
    })

    await page.goto(`/clinics/${clinic.id}/all?${query}`)

    await expect(
      page.getByText(
        `No participants in this clinic match “${fullName}” and the selected filters.`
      )
    ).toBeVisible()
  })
})
