// tests/e2e/clinic-list.spec.js
//
// Focused checks for clinic-list behaviours that update in place.

const { test, expect } = require('./helpers/fixtures')
const { appointmentSettings, pinSettings } = require('./helpers/settings')
const { findTodayAppointment, readCollection } = require('./helpers/seed-data')
const { waitForModalsReady, expectModalClosed } = require('./helpers/modals')
const dayjs = require('dayjs')
const users = require('../../app/data/users')

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

const findTodayOpenClinicWithRemainingAppointments = () => {
  const today = dayjs().format('YYYY-MM-DD')
  const clinics = readCollection('clinics.json', 'clinics')
  const appointments = readCollection('appointments.json', 'appointments')

  const clinic = clinics.find(
    (candidate) =>
      candidate.date === today &&
      !['closed', 'scheduled'].includes(candidate.status) &&
      appointments.some(
        (appointment) =>
          appointment.clinicId === candidate.id &&
          appointment.status === 'scheduled'
      )
  )

  if (!clinic) {
    throw new Error(
      'Seed data has no open clinic today with remaining appointments.'
    )
  }

  return clinic
}

const findTodayClinicWithMammographerAndRemainingAppointments = () => {
  const today = dayjs().format('YYYY-MM-DD')
  const clinics = readCollection('clinics.json', 'clinics')
  const appointments = readCollection('appointments.json', 'appointments')

  const clinic = clinics.find(
    (candidate) =>
      candidate.date === today &&
      appointments.some(
        (appointment) =>
          appointment.clinicId === candidate.id &&
          appointment.status === 'scheduled'
      ) &&
      appointments.some(
        (appointment) =>
          appointment.clinicId === candidate.id &&
          appointment.status === 'complete' &&
          appointment.sessionDetails?.startedBy
      )
  )

  if (!clinic) {
    throw new Error(
      'Seed data has no clinic today with both remaining appointments and a completed appointment assigned to a mammographer.'
    )
  }

  return clinic
}

const findClinicWithNewAndReturningParticipants = () => {
  const clinics = readCollection('clinics.json', 'clinics')
  const appointments = readCollection('appointments.json', 'appointments')
  const episodes = readCollection('episodes.json', 'episodes')
  const firstScreeningEpisodeIds = new Set(
    episodes
      .filter((episode) => episode.isFirstScreening)
      .map((episode) => episode.id)
  )

  for (const clinic of clinics) {
    const clinicAppointments = appointments.filter(
      (appointment) => appointment.clinicId === clinic.id
    )
    const newCount = clinicAppointments.filter((appointment) =>
      firstScreeningEpisodeIds.has(appointment.episodeId)
    ).length

    if (newCount > 0 && newCount < clinicAppointments.length) {
      return { clinic, newCount }
    }
  }

  throw new Error(
    'Seed data has no clinic with both new and returning participants.'
  )
}

test.describe('Clinic appointment list', () => {
  test('does not show completed screening details for an in-progress appointment on the All tab', async ({
    page
  }) => {
    const { clinic, appointment } = findTodayAppointment({
      status: 'in_progress'
    })
    const mammographer = users.find(
      (user) => user.id === appointment.sessionDetails.startedBy
    )
    const row = page.locator(`tr[data-fragment-id="${appointment.id}"]`)
    const statusColumn = row.locator(
      '.app-clinic-appointments-table__appointment-column'
    )
    const completedColumn = row.locator(
      '.app-clinic-appointments-table__completed-column'
    )

    await page.goto(`/clinics/${clinic.id}/all`)

    await expect(row).toBeVisible()
    await expect(statusColumn).not.toContainText(
      `${mammographer.firstName.charAt(0)}. ${mammographer.lastName}`
    )
    await expect(completedColumn).toBeEmpty()
    await expect(completedColumn.locator('.nhsapp-badge')).toHaveCount(0)
  })

  test('keeps mammographer options visible on every tab', async ({ page }) => {
    const clinic = findTodayClinicWithMammographerAndRemainingAppointments()

    for (const tab of [
      'remaining',
      'checked-in',
      'in-progress',
      'complete',
      'all'
    ]) {
      const tabUrl =
        tab === 'remaining'
          ? `/clinics/${clinic.id}?search=NoMatchClinicListTest`
          : `/clinics/${clinic.id}/${tab}?search=NoMatchClinicListTest`
      await page.goto(tabUrl)
      const activeTab = page
        .getByRole('navigation', { name: 'Secondary menu' })
        .getByRole('link', { name: new RegExp(tab.replaceAll('-', ' '), 'i') })
      await expect(
        activeTab.locator('strong.app-secondary-navigation__current')
      ).toBeVisible()
      await expect(
        page.getByRole('heading', {
          name: 'Filter appointments by mammographer'
        })
      ).toBeVisible()
      await expect(page.locator('#filter-mammographer')).toBeVisible()
    }
  })

  test('keeps clinic tabs available when search has no matching remaining appointments', async ({
    page
  }) => {
    const clinic = findTodayOpenClinicWithRemainingAppointments()

    await page.goto(`/clinics/${clinic.id}?search=NoMatchClinicListTest`)

    await expect(
      page.getByRole('navigation', { name: 'Secondary menu' })
    ).toContainText('Remaining')
    const navigation = page.getByRole('navigation', {
      name: 'Secondary menu'
    })
    const remainingTab = navigation.getByRole('link', { name: /Remaining/ })
    await expect(remainingTab.locator('.app-count')).toHaveText('(0)')
    await expect(navigation).toContainText('Checked in')
    const checkedInTab = navigation.getByRole('link', { name: /Checked in/ })
    await expect(checkedInTab.locator('.app-count')).toHaveText('(0)')
  })

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

    await page.clock.install({
      time: new Date(Date.now() + 60000)
    })
    await page.goto(`/clinics/${clinic.id}/checked-in`)

    const waitingTime = page.locator(
      `tr[data-fragment-id="${appointment.id}"] .js-waiting-time`
    )
    await expect(waitingTime).toHaveAttribute('data-waiting-since', /\d{4}/)
    const initialText = await waitingTime.innerText()
    await expect(waitingTime).toHaveText(/^\d+ mins? ago$/)

    await page.clock.fastForward(60000)

    await expect(waitingTime).not.toHaveText(initialText)
    await expect(waitingTime).toHaveText(/^\d+ mins? ago$/)
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

  test('filters to participants tagged New', async ({ page }) => {
    const { clinic, newCount } = findClinicWithNewAndReturningParticipants()
    const rows = page.locator('tbody tr.appointment-row')

    await page.goto(`/clinics/${clinic.id}/all?firstScreening=yes`)

    await expect(page.locator('#filter-first-screening')).toBeChecked()
    await expect(rows).toHaveCount(newCount)
    await expect(
      rows.filter({
        has: page.locator('.nhsuk-tag', { hasText: /^\s*New\s*$/ })
      })
    ).toHaveCount(newCount)
  })

  test('clears the search and filters, keeping the tab, sort and open panel', async ({
    page
  }) => {
    const clinic = findTodayClinicWithMammographerAndRemainingAppointments()
    const clearButton = page.getByRole('button', { name: 'Clear filters' })
    const filterPanel = page.locator('details', {
      hasText: 'Filter appointments'
    })

    await page.goto(`/clinics/${clinic.id}/all?sort=time-descending`)
    await expect(clearButton).toHaveCount(0)

    await page.getByText('Filter appointments', { exact: true }).click()
    await page.locator('#filter-special-appointment').check()
    await page.locator('#filter-first-screening').check()
    await expect(page).toHaveURL(/firstScreening=yes/)
    await page.locator('#filter-mammographer').check()
    await page.locator('#participant-search').fill('NoMatchClinicListTest')
    await expect(page).toHaveURL(/search=NoMatchClinicListTest/)
    await expect(page).toHaveURL(/sort=time-descending/)

    await clearButton.click()

    await expect(page).toHaveURL(
      `/clinics/${clinic.id}/all?sort=time-descending`
    )
    await expect(page.locator('#participant-search')).toHaveValue('')
    await expect(page.locator('#filter-special-appointment')).not.toBeChecked()
    await expect(page.locator('#filter-first-screening')).not.toBeChecked()
    await expect(
      page.locator('input[name="mammographer"]:checked')
    ).toHaveCount(0)
    await expect(clearButton).toHaveCount(0)
    await expect(filterPanel).toHaveAttribute('open', '')
    await expect(page.locator('#participant-search')).toBeFocused()
  })
})
