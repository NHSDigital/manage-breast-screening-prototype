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

test('sticky clinic actions show a shadow only while stuck', async ({
  page
}) => {
  const { clinic } = findTodayAppointment({ status: 'scheduled' })
  await page.setViewportSize({ width: 1400, height: 900 })
  await page.goto(`/clinics/${clinic.id}/close`)

  const footer = page.locator('.app-clinic-layout__sticky-footer')
  const stuckClass = /app-clinic-layout__sticky-footer--stuck/
  await expect(footer).toHaveClass(stuckClass)

  for (const width of [1400, 375]) {
    await page.setViewportSize({ width, height: 900 })
    const shadow = await footer.evaluate((element) => {
      const style = getComputedStyle(element)
      const result = {
        boxShadow: style.boxShadow,
        documentWidth: document.documentElement.scrollWidth
      }
      element.classList.remove('app-clinic-layout__sticky-footer--stuck')
      result.documentWidthWithoutLine = document.documentElement.scrollWidth
      element.classList.add('app-clinic-layout__sticky-footer--stuck')
      return result
    })
    expect(shadow.boxShadow).not.toBe('none')
    expect(shadow.documentWidth).toBe(shadow.documentWidthWithoutLine)
  }

  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
  await expect(footer).not.toHaveClass(stuckClass)
  await expect(footer).toHaveCSS('box-shadow', 'none')
  await page.evaluate(() => window.scrollTo(0, 0))
  await expect(footer).toHaveClass(stuckClass)

  await page.setViewportSize({ width: 350, height: 225 })
  await expect(footer).toHaveCSS('position', 'static')
  await expect(footer).not.toHaveClass(stuckClass)
  await expect(footer.locator('button')).toBeVisible()
})

test('close clinic actions update when an appointment outcome is undone and restored', async ({
  page
}) => {
  const { clinic, appointment } = findCompletedClinic()
  await page.goto(`/clinics/${clinic.id}/close`)

  const actions = page.locator('#close-clinic-actions')
  const closeButton = actions.getByRole('button', {
    name: 'Confirm and close clinic'
  })
  const message = page
    .locator('#close-clinic-outstanding')
    .getByText(
      '1 appointment needs a completed status before this clinic can be closed.'
    )
  const row = page.locator(`tr[data-fragment-id="${appointment.id}"]`)

  await expect(actions.locator('.nhsuk-inset-text')).toHaveCount(0)
  await expect(closeButton).toBeEnabled()
  await expect(message).toHaveCount(0)
  await expect(row.locator('td')).toHaveCount(5)
  await row.getByRole('link', { name: 'Undo status' }).click()
  await expect(message).toBeVisible()
  await expect(page.locator('#close-clinic-status')).toContainText(
    '1 appointment needs a completed status'
  )
  await expect(
    page.locator('#close-clinic-outstanding .nhsuk-inset-text')
  ).toHaveCount(1)
  await expect(closeButton).toBeDisabled()
  await expect(row.locator('td')).toHaveCount(5)

  await row.getByRole('link', { name: 'Mark as did not attend' }).click()
  await expect(closeButton).toBeEnabled()
  await expect(message).toHaveCount(0)
  await expect(page.locator('#close-clinic-status')).toHaveText(
    'All appointments have a completed status. You can now close the clinic.'
  )
  await expect(row.locator('td')).toHaveCount(5)
})

test('refreshing close clinic actions preserves keyboard focus', async ({
  page
}) => {
  const { clinic, appointment } = findCompletedClinic()
  await page.goto(`/clinics/${clinic.id}/close`)

  let releaseRefresh
  const refreshGate = new Promise((resolve) => {
    releaseRefresh = resolve
  })
  await page.route('**/close?_actions=1', async (route) => {
    const response = await route.fetch()
    await refreshGate
    await route.fulfill({ response })
  })

  const refreshRequested = page.waitForRequest('**/close?_actions=1')
  await page
    .locator(`tr[data-fragment-id="${appointment.id}"]`)
    .getByRole('link', { name: 'Undo status' })
    .click()
  await refreshRequested
  const cancel = page.locator('#close-clinic-actions').getByRole('link', {
    name: 'Cancel'
  })
  await cancel.focus()
  releaseRefresh()
  await expect(page.locator('#close-clinic-outstanding')).toContainText(
    '1 appointment needs a completed status'
  )
  await expect(cancel).toBeFocused()
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

test('background refreshes do not consume form validation errors', async ({
  page
}) => {
  const { clinic, appointment } = findTodayAppointment({ status: 'scheduled' })
  const clinicUrl = `/clinics/${clinic.id}`
  const reasonUrl = `${clinicUrl}/close/reason/${appointment.id}`
  await page.goto(`${clinicUrl}/check-in/${appointment.id}`)
  await page.goto(reasonUrl)

  const invalid = await page.request.post(reasonUrl, {
    form: {},
    maxRedirects: 0
  })
  expect(invalid.status()).toBe(302)

  const localRefresh = await page.request.get(`${clinicUrl}/close?_actions=1`)
  expect(localRefresh.ok()).toBeTruthy()
  const sharedRefresh = await page.request.get(`${clinicUrl}/close`, {
    headers: { 'X-Live-Update': '1' }
  })
  expect(sharedRefresh.ok()).toBeTruthy()

  await page.goto(reasonUrl)
  await expect(
    page.getByText('Select why this appointment has been stopped').first()
  ).toBeVisible()
})

test.describe('without JavaScript', () => {
  test.use({ javaScriptEnabled: false })

  test('close button follows appointment outcomes after navigation', async ({
    page
  }) => {
    const { clinic, appointment } = findCompletedClinic()
    await page.goto(`/clinics/${clinic.id}/close`)
    await expect(page.locator('html')).toHaveCSS(
      'scroll-padding-bottom',
      '800px'
    )
    await page.setViewportSize({ width: 350, height: 225 })
    await expect(page.locator('.app-clinic-layout__sticky-footer')).toHaveCSS(
      'position',
      'static'
    )
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
      page
        .locator('#close-clinic-outstanding')
        .getByText(
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
