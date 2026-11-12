// tests/e2e/clinic-list.spec.js
//
// Focused checks for clinic-list behaviours that update in place.

const { test, expect } = require('./helpers/fixtures')
const { appointmentSettings, pinSettings } = require('./helpers/settings')
const { findTodayAppointment, readCollection } = require('./helpers/seed-data')
const { waitForModalsReady, expectModalClosed } = require('./helpers/modals')
const dayjs = require('dayjs')
const {
  getAppointmentRunnerId
} = require('../../app/lib/utils/roles-and-permissions')
const users = require('../../app/data/users')
const riskLevels = require('../../app/data/risk-levels')

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
  test('shows in-progress and paused appointments on the Remaining tab', async ({
    page
  }) => {
    for (const status of ['in_progress', 'paused']) {
      const { clinic, appointment } = findTodayAppointment({ status })
      const row = page.locator(`tr[data-fragment-id="${appointment.id}"]`)
      const remainingTab = page
        .getByRole('navigation', { name: 'Secondary menu' })
        .getByRole('link', { name: /Remaining/ })

      await page.goto(`/clinics/${clinic.id}`)

      await expect(row).toBeVisible()
      await expect(
        remainingTab.locator('strong.app-secondary-navigation__current')
      ).toBeVisible()
      await expect(remainingTab).toContainText(
        `(${await page.locator('tbody tr[data-fragment-id]').count()})`
      )

      await page.goto(`/clinics/${clinic.id}/in-progress`)

      await expect(row).toBeVisible()
    }
  })

  test('shows who is running an in-progress appointment on the All tab', async ({
    page
  }) => {
    const { clinic, appointment } = findTodayAppointment({
      status: 'in_progress'
    })
    const runner = users.find(
      (user) => user.id === getAppointmentRunnerId(appointment)
    )
    const runnerName = `${runner.firstName} ${runner.lastName}`
    const row = page.locator(`tr[data-fragment-id="${appointment.id}"]`)
    const statusColumn = row.locator(
      '.app-clinic-appointments-table__appointment-column'
    )
    const startedAtColumn = row.locator(
      '.app-clinic-appointments-table__started-at-column'
    )
    const completedColumn = row.locator(
      '.app-clinic-appointments-table__completed-column'
    )

    await page.goto(`/clinics/${clinic.id}/all`)

    await expect(row).toBeVisible()
    await expect(statusColumn).toContainText(`with ${runnerName}`)
    await expect(completedColumn).toBeEmpty()
    await expect(completedColumn.locator('.nhsapp-badge')).toHaveCount(0)

    await page.goto(`/clinics/${clinic.id}/in-progress`)

    await expect(statusColumn).not.toContainText(runnerName)
    await expect(startedAtColumn).toContainText(runnerName)
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
      `tr[data-fragment-id="${appointment.id}"] .js-elapsed-time`
    )
    await expect(waitingTime).toHaveAttribute('data-elapsed-since', /\d{4}/)
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
      appointmentType: 'special'
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

    await page.goto(`/clinics/${clinic.id}/all?appointmentType=new`)

    await expect(page.getByLabel('New to screening')).toBeChecked()
    await expect(rows).toHaveCount(newCount)
    await expect(
      rows.filter({
        has: page.locator('.nhsuk-tag', { hasText: /^\s*New\s*$/ })
      })
    ).toHaveCount(newCount)
    await expect(
      rows.locator('.nhsuk-tag--green', { hasText: /^\s*New\s*$/ })
    ).toHaveCount(newCount)
  })

  test('shows appointments of any ticked type', async ({ page }) => {
    const appointments = readCollection('appointments.json', 'appointments')
    const episodes = readCollection('episodes.json', 'episodes')
    const episodesById = new Map(
      episodes.map((episode) => [episode.id, episode])
    )
    const clinicId = appointments.find(
      (appointment) => episodesById.get(appointment.episodeId)?.isLastScreening
    ).clinicId
    const matchingCount = appointments.filter((appointment) => {
      const episode = episodesById.get(appointment.episodeId)
      return (
        appointment.clinicId === clinicId &&
        (episode?.isFirstScreening || episode?.isLastScreening)
      )
    }).length

    await page.goto(
      `/clinics/${clinicId}/all?appointmentType=new&appointmentType=final`
    )

    await expect(page.locator('tbody tr.appointment-row')).toHaveCount(
      matchingCount
    )
  })

  test('shows selected filters as tags and removes one at a time', async ({
    page
  }) => {
    const { clinic } = findClinicWithNewAndReturningParticipants()
    const selectedFilters = page.locator('.app-selected-filters')

    await page.goto(`/clinics/${clinic.id}/all`)
    await expect(selectedFilters).toHaveCount(0)

    await page.goto(
      `/clinics/${clinic.id}/all?appointmentType=new&appointmentType=special`
    )
    await expect(selectedFilters.getByRole('link')).toHaveCount(2)

    await selectedFilters
      .getByRole('link', { name: 'Remove this filter: New to screening' })
      .click()

    await expect(page).toHaveURL(/appointmentType=special/)
    await expect(page).not.toHaveURL(/appointmentType=new/)
    await expect(selectedFilters.getByRole('link')).toHaveCount(1)
  })

  test('seeds an age-eligible final invite in every screening clinic', async () => {
    const clinics = readCollection('clinics.json', 'clinics')
    const appointments = readCollection('appointments.json', 'appointments')
    const episodes = readCollection('episodes.json', 'episodes')
    const participants = readCollection('participants.json', 'participants')
    const lastEpisodeIds = new Set(
      episodes
        .filter((episode) => episode.isLastScreening)
        .map((episode) => episode.id)
    )
    const screeningClinics = clinics.filter(
      (clinic) => clinic.clinicType === 'screening'
    )

    for (const clinic of screeningClinics) {
      const finalInvite = appointments.find(
        (appointment) =>
          appointment.clinicId === clinic.id &&
          lastEpisodeIds.has(appointment.episodeId)
      )
      expect(
        finalInvite,
        `Clinic ${clinic.id} has a final screening invite`
      ).toBeDefined()

      const participant = participants.find(
        (candidate) => candidate.id === finalInvite.participantId
      )
      const age = dayjs(clinic.date).diff(
        dayjs(participant.demographicInformation.dateOfBirth),
        'year'
      )
      expect(
        age,
        `Clinic ${clinic.id} invitee is screening-age eligible`
      ).toBeGreaterThanOrEqual(riskLevels.routine.ageRange.lower)
      expect(
        age,
        `Clinic ${clinic.id} invitee is screening-age eligible`
      ).toBeLessThanOrEqual(riskLevels.routine.ageRange.upper)
      expect(
        dayjs(clinic.date)
          .add(3, 'year')
          .isBefore(
            dayjs(participant.demographicInformation.dateOfBirth).add(
              riskLevels.routine.ageRange.upper + 1,
              'year'
            ),
            'day'
          ),
        `Clinic ${clinic.id} invitee qualifies by age`
      ).toBe(false)
    }
  })

  test('filters to participants tagged Final', async ({ page }) => {
    const appointments = readCollection('appointments.json', 'appointments')
    const episodes = readCollection('episodes.json', 'episodes')
    const lastEpisodeIds = new Set(
      episodes
        .filter((episode) => episode.isLastScreening)
        .map((episode) => episode.id)
    )
    const clinicId = appointments.find((appointment) =>
      lastEpisodeIds.has(appointment.episodeId)
    ).clinicId
    const lastCount = appointments.filter(
      (appointment) =>
        appointment.clinicId === clinicId &&
        lastEpisodeIds.has(appointment.episodeId)
    ).length
    const rows = page.locator('tbody tr.appointment-row')

    await page.goto(`/clinics/${clinicId}/all?appointmentType=final`)

    await expect(page.getByLabel('Final screening invite')).toBeChecked()
    await expect(rows).toHaveCount(lastCount)
    await expect(
      rows.filter({
        has: page.locator('.nhsuk-tag', { hasText: /^\s*Final\s*$/ })
      })
    ).toHaveCount(lastCount)
    await expect(
      rows.locator('.nhsuk-tag--red', { hasText: /^\s*Final\s*$/ })
    ).toHaveCount(lastCount)
  })

  test('clears the search and filters, keeping the tab, sort and open panel', async ({
    page
  }) => {
    const clinic = findTodayClinicWithMammographerAndRemainingAppointments()
    const clearButton = page.locator('a:has-text("Clear filters")')
    const filterPanel = page.locator('details', {
      hasText: 'Filter appointments'
    })

    await page.goto(`/clinics/${clinic.id}/all?sort=time-descending`)
    await expect(clearButton).toHaveCount(0)

    await page.getByText('Filter appointments', { exact: true }).click()
    await page.getByLabel('Special appointments').check()
    await page.getByLabel('New to screening').check()
    await expect(page).toHaveURL(/appointmentType=new/)
    await page.locator('#filter-mammographer').check()
    await page.locator('#participant-search').fill('NoMatchClinicListTest')
    await expect(page).toHaveURL(/search=NoMatchClinicListTest/)
    await expect(page).toHaveURL(/sort=time-descending/)

    await expect(clearButton).toBeVisible()
    await clearButton.click()

    await expect(page).toHaveURL(
      `/clinics/${clinic.id}/all?sort=time-descending`
    )
    await expect(page.locator('#participant-search')).toHaveValue('')
    await expect(page.getByLabel('Special appointments')).not.toBeChecked()
    await expect(page.getByLabel('New to screening')).not.toBeChecked()
    await expect(
      page.locator('input[name="mammographer"]:checked')
    ).toHaveCount(0)
    await expect(clearButton).toHaveCount(0)
    await expect(filterPanel).toHaveAttribute('open', '')
    await expect(page.locator('#participant-search')).toBeFocused()
  })
})
