// tests/e2e/appointment.spec.js
//
// Two journeys through a screening appointment: one that records medical
// information along the way, and one that goes straight through with nothing
// to record. Together they exercise check-in, the workflow steps, the modal
// forms, the imaging step and completion.

const { test, expect } = require('./helpers/fixtures')
const { pinSettings, appointmentSettings } = require('./helpers/settings')
const { findTodayAppointment } = require('./helpers/seed-data')
const {
  clickToOpenModal,
  openFormModal,
  revealInModal,
  expectModalClosed,
  openSection,
  waitForModalsReady
} = require('./helpers/modals')

/**
 * Check a participant in from the clinic list, through the identity modal
 *
 * @param {import('@playwright/test').Page} page - Playwright page
 * @param {object} appointment - Appointment record from the seed data
 */
const checkIn = async (page, appointment) => {
  await waitForModalsReady(page)
  await page.locator(`a[onclick*="check-in-modal-${appointment.id}"]`).click()

  const modal = page.locator(`#check-in-modal-${appointment.id}`)
  await expect(modal.locator('.app-modal__dialog')).toBeVisible()
  await modal
    .getByRole('button', { name: 'Confirm identity and check in' })
    .click()
  await expectModalClosed(modal)
}

/**
 * Walk the imaging and completion steps that both journeys share
 *
 * @param {import('@playwright/test').Page} page - Playwright page
 */
const takeImagesAndComplete = async (page) => {
  await expect(
    page.getByRole('heading', { name: 'Take mammogram images' })
  ).toBeVisible()
  await page
    .locator(
      'input[name="appointment[mammogramDataTemp][isStandardSet]"][value="yes"]'
    )
    .check()
  await page.getByRole('button', { name: 'Continue' }).first().click()

  await expect(
    page.getByRole('heading', { name: 'Check information' })
  ).toBeVisible()
  await page
    .getByRole('button', { name: 'Complete screening and return to clinic' })
    .click()
}

test.describe('Screening appointment', () => {
  test('records medical history and a symptom, then completes', async ({
    page
  }) => {
    const { clinic, appointment, fullName, fullNameReversed } =
      findTodayAppointment({ index: 0 })

    await pinSettings(page, appointmentSettings)
    await page.goto(`/clinics/${clinic.id}`)

    await checkIn(page, appointment)
    await expect(page.getByText('Checked in').first()).toBeVisible()

    await page
      .locator(
        `a[href^="/clinics/${clinic.id}/appointments/${appointment.id}/start"]`
      )
      .first()
      .click()

    // Confirm identity
    await expect(
      page.getByRole('heading', { name: 'Confirm identity' })
    ).toBeVisible()
    await expect(page.getByText(fullNameReversed).first()).toBeVisible()
    await page.getByRole('button', { name: 'Confirm identity' }).first().click()

    await expect(
      page.getByRole('heading', { name: 'Review medical information' })
    ).toBeVisible()

    // Medical history - the routes behind this modal are the ones the
    // 2026-07-15 stranded-helper bug broke
    await openSection(page, 'Medical history')

    const historyModal = await clickToOpenModal(page, 'Breast cancer')
    // Under a loaded full-suite run Playwright intermittently reports this
    // checkbox "outside of the viewport" inside the transformed dialog and
    // retries forever (see revealInModal's note). A DOM-level click sidesteps
    // the geometry, and the assertion keeps it honest.
    const cancerLocation = historyModal.locator(
      'input[name="appointment[medicalHistoryTemp][cancerLocation]"][value="Right breast"]'
    )
    await cancerLocation.evaluate((element) => element.click())
    await expect(cancerLocation).toBeChecked()

    const lumpectomy = historyModal.locator(
      'input[name="appointment[medicalHistoryTemp][procedures]"][value="Lumpectomy"]'
    )
    await lumpectomy.evaluate((element) => element.click())
    await expect(lumpectomy).toBeChecked()

    const saveButton = historyModal.getByRole('button', { name: 'Save' })
    await revealInModal(saveButton)
    await saveButton.click()
    await expect(
      historyModal.getByText('Select which breast for lumpectomy')
    ).toBeVisible()

    const lumpectomySide = historyModal.locator(
      'input[name="appointment[medicalHistoryTemp][lumpectomySide]"][value="Right"]'
    )
    await revealInModal(lumpectomySide)
    await lumpectomySide.check()
    await saveButton.click()
    await expectModalClosed(historyModal)

    await expect(page.getByText('Cancer location')).toBeVisible()
    await expect(page.getByText('Lumpectomy').first()).toBeVisible()

    const breastCancerCard = page.locator('.nhsuk-card').filter({
      has: page.getByRole('heading', {
        name: 'Breast cancer',
        exact: true
      })
    })
    await waitForModalsReady(page)
    await breastCancerCard.getByRole('link', { name: 'Change' }).click()
    const editHistoryModal = await openFormModal(page)
    await expect(
      editHistoryModal.locator(
        'input[name="appointment[medicalHistoryTemp][procedures]"][value="Lumpectomy"]'
      )
    ).toBeChecked()

    const savedLumpectomySide = editHistoryModal.locator(
      'input[name="appointment[medicalHistoryTemp][lumpectomySide]"][value="Right"]'
    )
    await expect(savedLumpectomySide).toBeChecked()
    await editHistoryModal.getByRole('button', { name: 'Save' }).click()
    await expectModalClosed(editHistoryModal)

    // Symptom
    await openSection(page, 'Symptoms')

    const symptomModal = await clickToOpenModal(page, 'Lump', { exact: true })
    await revealInModal(
      symptomModal.locator(
        'input[name="appointment[symptomTemp][location]"][value="right breast"]'
      )
    )
    await symptomModal
      .locator(
        'input[name="appointment[symptomTemp][location]"][value="right breast"]'
      )
      .check()
    await symptomModal
      .locator(
        'input[name="appointment[symptomTemp][dateType]"][value="Less than 3 months"]'
      )
      .check()
    await symptomModal.getByRole('button', { name: 'Save symptom' }).click()
    await expectModalClosed(symptomModal)

    await expect(page.getByText('Lump').first()).toBeVisible()

    await page
      .getByRole('button', { name: 'Complete all and continue' })
      .first()
      .click()

    await takeImagesAndComplete(page)

    // Back on the clinic list, with the appointment finished
    await expect(page).toHaveURL(new RegExp(`/clinics/${clinic.id}`))
    await expect(page.getByText(`${fullName} has been screened`)).toBeVisible()
  })

  test('goes straight through with nothing to record', async ({ page }) => {
    // A different appointment to the journey above, so a failure points at one
    // journey rather than at the two interfering
    const { clinic, appointment, fullName } = findTodayAppointment({ index: 1 })

    await pinSettings(page, appointmentSettings)
    await page.goto(
      `/clinics/${clinic.id}/appointments/${appointment.id}/start`
    )

    await expect(
      page.getByRole('heading', { name: 'Confirm identity' })
    ).toBeVisible()
    await page.getByRole('button', { name: 'Confirm identity' }).first().click()

    await expect(
      page.getByRole('heading', { name: 'Review medical information' })
    ).toBeVisible()
    await page
      .getByRole('button', { name: 'Complete all and continue' })
      .first()
      .click()

    await takeImagesAndComplete(page)

    await expect(page).toHaveURL(new RegExp(`/clinics/${clinic.id}`))
    await expect(page.getByText(`${fullName} has been screened`)).toBeVisible()
  })

  test('records why no images were needed after bilateral mastectomy', async ({
    page
  }) => {
    const { clinic, appointment } = findTodayAppointment({ index: 2 })

    await pinSettings(page, appointmentSettings)
    await page.goto(
      `/clinics/${clinic.id}/appointments/${appointment.id}/start`
    )

    await expect(
      page.getByRole('heading', { name: 'Confirm identity' })
    ).toBeVisible()
    await page.getByRole('button', { name: 'Confirm identity' }).first().click()
    await expect(
      page.getByRole('heading', { name: 'Review medical information' })
    ).toBeVisible()

    await openSection(page, 'Medical history')
    const historyModal = await clickToOpenModal(page, 'Breast cancer')

    const cancerLocation = historyModal.locator(
      'input[name="appointment[medicalHistoryTemp][cancerLocation]"][value="Right breast"]'
    )
    await cancerLocation.evaluate((element) => element.click())
    const mastectomy = historyModal.locator(
      'input[name="appointment[medicalHistoryTemp][procedures]"][value="Mastectomy"]'
    )
    await mastectomy.evaluate((element) => element.click())
    const mastectomySide = historyModal.locator(
      'input[name="appointment[medicalHistoryTemp][mastectomySide]"][value="Both"]'
    )
    await revealInModal(mastectomySide)
    await mastectomySide.check()

    await historyModal.getByRole('button', { name: 'Save' }).click()
    await expect(
      historyModal.getByRole('heading', { name: 'Bilateral mastectomy' })
    ).toBeVisible()
    await expect(
      historyModal.getByText('Do you need to take any images?')
    ).toBeVisible()
    await expect(
      historyModal.getByLabel('Yes, both sides')
    ).toBeVisible()
    const noImages = historyModal.locator(
      'input[name="appointment[medicalHistoryTemp][mastectomyImagingSide]"][value="None"]'
    )
    await revealInModal(noImages)
    await noImages.check()
    await historyModal
      .getByRole('button', { name: 'Save and continue' })
      .click()
    await expectModalClosed(historyModal)

    await page
      .getByRole('button', { name: 'Complete all and end appointment' })
      .first()
      .click()
    await expect(page).toHaveURL(new RegExp(`/clinics/${clinic.id}`))
    await page.getByRole('link', { name: /^All/ }).click()
    await expect(
      page.locator(`#appointment-row-${appointment.id}`)
    ).toContainText(
      'Other reason (No images needed because of bilateral mastectomy)'
    )
  })
})
