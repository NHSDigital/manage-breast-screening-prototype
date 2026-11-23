// tests/e2e/screening-order.spec.js

const { test, expect } = require('./helpers/fixtures')
const { findTodayAppointment, readCollection } = require('./helpers/seed-data')
const {
  updateAppointmentStatus
} = require('../../app/lib/utils/appointment-status')
const {
  wasAttended,
  getCompletedTime,
  getSimulatedNow
} = require('../../app/lib/utils/status')
const {
  getAppointmentRunByIds
} = require('../../app/lib/utils/roles-and-permissions')

test('numbers attended outcomes by completion time and closes gaps after undo', () => {
  const appointment = (id, status, extra = {}) => ({
    id,
    clinicId: 'screening-order-test',
    status,
    statusHistory: [],
    ...extra
  })
  const data = {
    currentUser: { id: 'mammographer' },
    _changes: { appointments: {} },
    appointments: [
      appointment('first', 'in_progress', {
        sessionDetails: { startedAt: '2020-01-01T09:00:00Z' }
      }),
      appointment('second', 'in_progress', {
        sessionDetails: { startedAt: '2020-01-01T09:01:00Z' }
      }),
      appointment('not-screened', 'checked_in'),
      appointment('cancelled', 'scheduled'),
      appointment('other-clinic', 'in_progress', { clinicId: 'other' })
    ]
  }
  const get = (id) => data.appointments.find((item) => item.id === id)

  updateAppointmentStatus(data, 'first', 'paused')
  expect(get('first').screeningOrder).toBeUndefined()
  updateAppointmentStatus(data, 'second', 'complete')
  expect(get('second').screeningOrder).toBe(1)
  updateAppointmentStatus(data, 'first', 'partially_screened')
  expect(get('first').screeningOrder).toBe(2)
  updateAppointmentStatus(data, 'not-screened', 'attended_not_screened')
  expect(get('not-screened').screeningOrder).toBe(3)
  expect(get('not-screened').sessionDetails.endedAt).toBe(
    getSimulatedNow().toISOString()
  )
  expect(getAppointmentRunByIds(get('not-screened'))).toEqual([])
  updateAppointmentStatus(data, 'cancelled', 'cancelled')
  expect(get('cancelled').screeningOrder).toBeUndefined()

  data.appointment = {
    ...get('first'),
    appointmentStopped: { stoppedReason: ['Unsaved'] }
  }
  updateAppointmentStatus(data, 'second', 'checked_in')
  expect(get('second').screeningOrder).toBeNull()
  expect(get('first').screeningOrder).toBe(1)
  expect(get('not-screened').screeningOrder).toBe(2)
  expect(data._changes.appointments.first.screeningOrder).toBe(1)
  expect(data._changes.appointments.first.appointmentStopped).toBeUndefined()
  expect(data.appointment.appointmentStopped.stoppedReason).toEqual(['Unsaved'])
  expect(data.appointment.screeningOrder).toBe(1)
  expect(get('other-clinic').screeningOrder).toBeUndefined()

  delete data.appointment
  updateAppointmentStatus(data, 'not-screened', 'rescheduled')
  expect(get('not-screened').screeningOrder).toBe(2)
  expect(get('not-screened').sessionDetails.endedAt).toBeTruthy()
  updateAppointmentStatus(data, 'second', 'rescheduled')
  expect(get('second').screeningOrder).toBe(3)
})

test('orders outcomes completed at the same simulated time', async ({
  page
}) => {
  const { clinic } = findTodayAppointment({ status: 'scheduled' })
  const appointments = readCollection('appointments.json', 'appointments')
    .filter(
      (appointment) =>
        appointment.clinicId === clinic.id && appointment.status === 'scheduled'
    )
    .slice(0, 2)
  expect(appointments).toHaveLength(2)
  const clinicUrl = `/clinics/${clinic.id}`

  for (const appointment of [...appointments].reverse()) {
    const field = `closeReasonForm[${appointment.id}]`
    await page.goto(`${clinicUrl}/check-in/${appointment.id}`)
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
  }

  for (const [direction, expected] of [
    ['ascending', [...appointments].reverse()],
    ['descending', appointments]
  ]) {
    await page.goto(`${clinicUrl}/complete?sort=completed-${direction}`)
    const ids = await page
      .locator('tbody tr[data-fragment-id]')
      .evaluateAll((rows) => rows.map((row) => row.dataset.fragmentId))
    expect(ids.indexOf(expected[0].id)).toBeLessThan(
      ids.indexOf(expected[1].id)
    )
    expect(ids.indexOf(expected[1].id)).toBeGreaterThanOrEqual(0)
  }
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
    expect(attended.map((item) => item.screeningOrder)).toEqual(
      attended.map((item, index) => index + 1)
    )
    expect(
      clinicAppointments.filter(
        (item) => !wasAttended(item) && item.screeningOrder != null
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
