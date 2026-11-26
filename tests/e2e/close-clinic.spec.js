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
  const message = page.locator('#close-clinic-outstanding')
  const row = page.locator(`tr[data-fragment-id="${appointment.id}"]`)

  await expect(closeButton).toBeEnabled()
  await expect(message).toHaveCount(0)
  await row.getByRole('link', { name: 'Undo status' }).click()
  await expect(message).toHaveText(
    '1 appointment needs a completed status before this clinic can be closed'
  )
  await expect(page.locator('#close-clinic-status')).toContainText(
    '1 appointment needs a completed status'
  )
  await expect(closeButton).toBeDisabled()
  await expect(row.locator('td')).toHaveCount(5)

  await row.getByRole('link', { name: 'Mark as did not attend' }).click()
  await expect(closeButton).toBeEnabled()
  await expect(message).toHaveCount(0)
  await expect(page.locator('#close-clinic-status')).toHaveText(
    'All appointments have a completed status. You can now close the clinic.'
  )
})

test('undoing an attended outcome updates the other completion numbers', async ({
  page
}) => {
  const appointments = readCollection('appointments.json', 'appointments')
  const { clinic, appointment: first } = findTodayAppointment({
    status: 'scheduled'
  })
  const second = appointments.find(
    (appointment) =>
      appointment.clinicId === clinic.id &&
      appointment.status === 'scheduled' &&
      appointment.id !== first.id
  )
  if (!second) {
    throw new Error(
      'Seed data has no second scheduled appointment in the clinic.'
    )
  }
  const clinicUrl = `/clinics/${clinic.id}`
  for (const appointment of [first, second]) {
    await page.goto(`${clinicUrl}/check-in/${appointment.id}`)
    await page.goto(`${clinicUrl}/close/reason/${appointment.id}`)
    const field = `closeReasonForm[${appointment.id}]`
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
  await page.goto(`${clinicUrl}/close`)
  const nextBadge = page
    .locator(`tr[data-fragment-id="${second.id}"]`)
    .locator('.app-clinic-appointments-table__completed-column .nhsapp-badge')
  const previousOrder = Number(
    await nextBadge.locator('[aria-hidden]').innerText()
  )
  expect(previousOrder).toBeGreaterThan(1)
  await page
    .locator(`tr[data-fragment-id="${first.id}"]`)
    .getByRole('link', { name: 'Undo status' })
    .click()
  await expect(nextBadge.locator('[aria-hidden]')).toHaveText(
    String(previousOrder - 1)
  )
})

test('background refreshes keep reason answers and validation errors', async ({
  page
}) => {
  const { clinic, appointment } = findTodayAppointment({ status: 'scheduled' })
  const clinicUrl = `/clinics/${clinic.id}`
  const reasonUrl = `${clinicUrl}/close/reason/${appointment.id}`
  const field = `closeReasonForm[${appointment.id}]`
  const refreshClosePage = async () => {
    const response = await page.request.get(`${clinicUrl}/close`, {
      headers: { 'X-Region-Refresh': '1' }
    })
    expect(response.ok()).toBeTruthy()
  }
  await page.goto(`${clinicUrl}/check-in/${appointment.id}`)
  await page.goto(reasonUrl)

  const invalid = await page.request.post(reasonUrl, {
    form: {},
    maxRedirects: 0
  })
  expect(invalid.status()).toBe(302)
  await refreshClosePage()
  await page.goto(reasonUrl)
  await expect(
    page.getByText('Select why this appointment has been stopped').first()
  ).toBeVisible()

  const reason = await page.request.post(reasonUrl, {
    form: {
      [`${field}[stoppedReason]`]: 'Consent withdrawn',
      [`${field}[needsReschedule]`]: 'yes'
    }
  })
  expect(reason.url()).toContain(`/close/reschedule/${appointment.id}`)
  await refreshClosePage()
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
    await expect(page.locator('#close-clinic-outstanding')).toHaveText(
      '1 appointment needs a completed status before this clinic can be closed'
    )

    const response = await page.request.post(`/clinics/${clinic.id}/close`)
    expect(response.url()).toContain(`/clinics/${clinic.id}/close`)
    expect(await response.text()).toContain(
      'An outcome still needs to be recorded for 1 participant'
    )
    await expect(closeButton).toBeDisabled()
  })
})
