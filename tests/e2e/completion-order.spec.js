// tests/e2e/completion-order.spec.js

const { test, expect } = require('./helpers/fixtures')
const { findTodayAppointment, readCollection } = require('./helpers/seed-data')
const { wasAttended, getCompletedTime } = require('../../app/lib/utils/status')

test('a stopped appointment rescheduled before screening is numbered', async ({
  page
}) => {
  const { clinic, appointment } = findTodayAppointment({ status: 'scheduled' })
  const clinicUrl = `/clinics/${clinic.id}`
  const field = `closeReasonForm[${appointment.id}]`
  await page.goto(`${clinicUrl}/check-in/${appointment.id}`)
  await page.goto(`${clinicUrl}/close/reason/${appointment.id}`)
  const reason = await page.request.post(
    `${clinicUrl}/close/reason/${appointment.id}`,
    {
      form: {
        [`${field}[stoppedReason]`]: 'Consent withdrawn',
        [`${field}[needsReschedule]`]: 'yes'
      }
    }
  )
  expect(reason.ok()).toBeTruthy()
  const reschedule = await page.request.post(
    `${clinicUrl}/close/reschedule/${appointment.id}`,
    {
      form: { 'closeRescheduleForm[timing]': 'within-6-weeks' }
    }
  )
  expect(reschedule.ok()).toBeTruthy()
  await page.goto(`${clinicUrl}/complete?sort=completed-ascending`)
  const row = page.locator(`tr[data-fragment-id="${appointment.id}"]`)
  await expect(
    row.locator('.app-clinic-appointments-table__completed-time')
  ).not.toBeEmpty()
  await expect(
    row.locator(
      '.app-clinic-appointments-table__completed-column .nhsapp-badge'
    )
  ).toHaveCount(1)

  const appointmentUrl = `${clinicUrl}/appointments/${appointment.id}`
  await page.goto(`${appointmentUrl}/undo-reschedule`)
  await page.request.post(
    `${appointmentUrl}/cancel-or-reschedule-appointment/reschedule-answer`,
    {
      form: { 'appointment[reschedule][timing]': 'within-6-weeks' }
    }
  )
  await page.goto(`${clinicUrl}/complete?sort=completed-ascending`)
  const rescheduledRow = page.locator(
    `tr[data-fragment-id="${appointment.id}"]`
  )
  await expect(
    rescheduledRow.locator(
      '.app-clinic-appointments-table__completed-column .nhsapp-badge'
    )
  ).toHaveCount(0)
  await expect(rescheduledRow).not.toContainText('Consent withdrawn')
})

test('seeded completion numbers are consecutive and the list sorts by completion time', async ({
  page
}) => {
  const appointments = readCollection('appointments.json', 'appointments')
  const clinicIds = [...new Set(appointments.map((item) => item.clinicId))]
  for (const clinicId of clinicIds) {
    const clinicAppointments = appointments.filter(
      (item) => item.clinicId === clinicId
    )
    const attended = clinicAppointments
      .filter(wasAttended)
      .sort(
        (a, b) => new Date(getCompletedTime(a)) - new Date(getCompletedTime(b))
      )
    expect(attended.map((item) => item.completionOrder)).toEqual(
      attended.map((item, index) => index + 1)
    )
    expect(
      clinicAppointments.filter(
        (item) => !wasAttended(item) && item.completionOrder != null
      )
    ).toEqual([])
  }

  const clinicId = clinicIds.find(
    (id) =>
      appointments.filter((item) => item.clinicId === id && wasAttended(item))
        .length >= 3
  )
  expect(clinicId).toBeTruthy()
  await page.goto(`/clinics/${clinicId}/complete?sort=completed-ascending`)
  const badges = page.locator(
    '.app-clinic-appointments-table__completed-column .nhsapp-badge [aria-hidden="true"]'
  )
  const ascending = (await badges.allTextContents()).map(Number)
  expect(ascending.length).toBeGreaterThanOrEqual(3)
  expect([...ascending].sort((a, b) => a - b)).toEqual(
    ascending.map((item, index) => index + 1)
  )
  const rows = page.locator('tbody tr[data-fragment-id]')
  const completionTimes = async () => {
    const ids = await rows.evaluateAll((elements) =>
      elements.map((row) => row.dataset.fragmentId)
    )
    return ids
      .map((id) =>
        getCompletedTime(appointments.find((item) => item.id === id))
      )
      .filter(Boolean)
      .map((time) => new Date(time).getTime())
  }
  const ascendingTimes = await completionTimes()
  expect(ascendingTimes).toEqual([...ascendingTimes].sort((a, b) => a - b))

  await page.goto(`/clinics/${clinicId}/complete?sort=completed-descending`)
  const descending = (await badges.allTextContents()).map(Number)
  expect([...descending].sort((a, b) => a - b)).toEqual(
    [...ascending].sort((a, b) => a - b)
  )
  const descendingTimes = await completionTimes()
  expect(descendingTimes).toEqual([...descendingTimes].sort((a, b) => b - a))
})

test('numbers an attended-not-screened outcome and closes the gap when undone', async ({
  page
}) => {
  const { clinic, appointment } = findTodayAppointment({ status: 'checked_in' })
  const clinicUrl = `/clinics/${clinic.id}`
  const field = `closeReasonForm[${appointment.id}]`

  await page.goto(`${clinicUrl}/close/reason/${appointment.id}`)
  const response = await page.request.post(
    `${clinicUrl}/close/reason/${appointment.id}`,
    {
      form: {
        [`${field}[stoppedReason]`]: 'Consent withdrawn',
        [`${field}[needsReschedule]`]: 'no-invite'
      }
    }
  )
  expect(response.ok()).toBeTruthy()
  await page.goto(`${clinicUrl}/complete?sort=completed-ascending`)
  const badges = page.locator(
    '.app-clinic-appointments-table__completed-column .nhsapp-badge [aria-hidden="true"]'
  )
  const numbers = (await badges.allTextContents()).map(Number)
  expect(
    await page
      .locator(`tr[data-fragment-id="${appointment.id}"] .nhsapp-badge`)
      .count()
  ).toBe(1)
  expect([...numbers].sort((a, b) => a - b)).toEqual(
    numbers.map((item, index) => index + 1)
  )

  await page.goto(`${clinicUrl}/close/set-status/${appointment.id}/checked_in`)
  await page.goto(`${clinicUrl}/complete?sort=completed-ascending`)
  await expect(
    page.locator(`tr[data-fragment-id="${appointment.id}"]`)
  ).toHaveCount(0)
  const remaining = (await badges.allTextContents()).map(Number)
  expect([...remaining].sort((a, b) => a - b)).toEqual(
    remaining.map((item, index) => index + 1)
  )
})
