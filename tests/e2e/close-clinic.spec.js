// tests/e2e/close-clinic.spec.js

const { test, expect } = require('./helpers/fixtures')
const { findTodayAppointment, readCollection } = require('./helpers/seed-data')
const { isFinal } = require('../../app/lib/utils/status')

const findCompletedClinic = () => {
  const clinics = readCollection('clinics.json', 'clinics')
  const appointments = readCollection('appointments.json', 'appointments')
  const clinic = clinics.find((candidate) => {
    const clinicAppointments = appointments.filter(
      (appointment) => appointment.clinicId === candidate.id
    )
    return (
      clinicAppointments.length > 0 &&
      clinicAppointments.every(isFinal) &&
      clinicAppointments.some(
        (appointment) => appointment.status === 'did_not_attend'
      )
    )
  })

  if (!clinic) {
    throw new Error(
      'Seed data has no completed clinic with a did not attend appointment.'
    )
  }

  return {
    clinic,
    appointment: appointments.find(
      (appointment) =>
        appointment.clinicId === clinic.id &&
        appointment.status === 'did_not_attend'
    )
  }
}

test('close clinic actions update when an appointment outcome is undone and restored', async ({
  page
}) => {
  const { clinic, appointment } = findCompletedClinic()
  await page.goto(`/clinics/${clinic.id}/close`)

  const actions = page.locator('#close-clinic-actions')
  const closeButton = actions.getByRole('button', {
    name: 'Confirm and close clinic'
  })
  const message = actions.getByText(
    '1 appointment needs a completed status before this clinic can be closed.'
  )
  const row = page.locator(`tr[data-fragment-id="${appointment.id}"]`)

  await expect(closeButton).toBeEnabled()
  await expect(message).toHaveCount(0)
  await expect(row.locator('td')).toHaveCount(5)
  await row.getByRole('link', { name: 'Undo status' }).click()
  await expect(message).toBeVisible()
  await expect(closeButton).toBeDisabled()
  await expect(row.locator('td')).toHaveCount(5)

  await row.getByRole('link', { name: 'Mark as did not attend' }).click()
  await expect(closeButton).toBeEnabled()
  await expect(message).toHaveCount(0)
  await expect(row.locator('td')).toHaveCount(5)
})

test('refreshing Actions preserves a reschedule draft', async ({ page }) => {
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
  expect(reason.url()).toContain(`/close/reschedule/${appointment.id}`)

  const localRefresh = await page.request.get(`${clinicUrl}/close?_actions=1`)
  expect(localRefresh.ok()).toBeTruthy()
  const sharedRefresh = await page.request.get(`${clinicUrl}/close`, {
    headers: { 'X-Live-Update': '1' }
  })
  expect(sharedRefresh.ok()).toBeTruthy()

  const saved = await page.request.post(
    `${clinicUrl}/close/reschedule/${appointment.id}`,
    {
      form: { 'closeRescheduleForm[timing]': 'within-6-weeks' }
    }
  )
  expect(saved.url()).toContain(`${clinicUrl}/close`)
  expect(saved.url()).not.toContain('/close/reason/')
})

test.describe('without JavaScript', () => {
  test.use({ javaScriptEnabled: false })

  test('close button follows appointment outcomes after navigation', async ({
    page
  }) => {
    const { clinic, appointment } = findCompletedClinic()
    await page.goto(`/clinics/${clinic.id}/close`)
    const actions = page.locator('#close-clinic-actions')
    const closeButton = actions.getByRole('button', {
      name: 'Confirm and close clinic'
    })

    await expect(closeButton).toBeEnabled()
    await page
      .locator(`tr[data-fragment-id="${appointment.id}"]`)
      .getByRole('link', { name: 'Undo status' })
      .click()
    await expect(closeButton).toBeDisabled()
    await expect(
      actions.getByText(
        '1 appointment needs a completed status before this clinic can be closed.'
      )
    ).toBeVisible()

    const response = await page.request.post(`/clinics/${clinic.id}/close`)
    expect(response.url()).toContain(`/clinics/${clinic.id}/close`)
    expect(await response.text()).toContain(
      'An outcome still needs to be recorded for 1 participant'
    )
    await expect(closeButton).toBeDisabled()
  })
})
