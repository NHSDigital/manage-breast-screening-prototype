// tests/e2e/appointment.spec.js
//
// Two journeys through a screening appointment: one that records medical
// information along the way, and one that goes straight through with nothing
// to record. Together they exercise check-in, the workflow steps, the modal
// forms, the imaging step and completion.

const { test, expect } = require('./helpers/fixtures')
const { pinSettings, appointmentSettings } = require('./helpers/settings')
const { findTodayAppointment } = require('./helpers/seed-data')
const users = require('../../app/data/users')
const {
  getAppointmentMammographerSummary
} = require('../../app/lib/utils/roles-and-permissions')
const {
  clickToOpenModal,
  clickLinkToOpenModal,
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
 * @param {string} [operatorId] - Different mammographer to nominate as operator
 */
const takeImagesAndComplete = async (page, operatorId) => {
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

  if (operatorId) {
    const mammographerModal = await clickLinkToOpenModal(
      page,
      'Change operator'
    )
    const operatorRadio = mammographerModal.locator(
      `input[name="appointment[authorisedMammographerTemp][userId]"][value="${operatorId}"]`
    )
    await revealInModal(operatorRadio)
    await operatorRadio.check()
    await mammographerModal.getByRole('button', { name: 'Save' }).click()
    await expectModalClosed(mammographerModal)
  }

  await page
    .getByRole('button', { name: 'Complete screening and return to clinic' })
    .click()
}

test.describe('Screening appointment', () => {
  test('shows both roles when a practitioner also operates in a multi-person appointment', () => {
    const [practitioner, operator] = users
    const appointment = {
      authorisedMammographerId: practitioner.id,
      sessionDetails: {
        startedBy: practitioner.id,
        authors: [{ userId: practitioner.id }, { userId: operator.id }],
        endedBy: operator.id
      }
    }

    const summary = getAppointmentMammographerSummary.call(
      { ctx: { data: { users } } },
      appointment
    )

    expect(summary).toEqual({
      label: 'Mammographers',
      people: [
        {
          id: practitioner.id,
          name: `${practitioner.firstName} ${practitioner.lastName}`,
          roles: ['Practitioner', 'Operator']
        },
        {
          id: operator.id,
          name: `${operator.firstName} ${operator.lastName}`,
          roles: ['Practitioner']
        }
      ]
    })
  })

  test('records medical history and a symptom, then completes', async ({
    page
  }) => {
    const { clinic, appointment, fullName, shortName } = findTodayAppointment({
      index: 0
    })

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
    await expect(page.getByText(fullName).first()).toBeVisible()
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
      .getByRole('button', { name: 'Complete all and authorise imaging' })
      .first()
      .click()

    await takeImagesAndComplete(page)

    // Back on the clinic list, with the appointment finished
    await expect(page).toHaveURL(new RegExp(`/clinics/${clinic.id}`))
    await expect(page.getByText(`${shortName} has been screened`)).toBeVisible()
    await page.goto(
      `/clinics/${clinic.id}/appointments/${appointment.id}/appointment`
    )
    const mammographerRow = page
      .locator('.nhsuk-summary-list__row')
      .filter({ has: page.getByText('Mammographer', { exact: true }) })
    await expect(mammographerRow).toContainText('Mammographer')
    await expect(mammographerRow).toContainText(
      `${users[0].firstName} ${users[0].lastName}`
    )
    await expect(mammographerRow).not.toContainText('(Practitioner)')
    await expect(mammographerRow).not.toContainText('(Operator)')
  })

  test('goes straight through with nothing to record', async ({ page }) => {
    // A different appointment to the journey above, so a failure points at one
    // journey rather than at the two interfering
    const { clinic, appointment, shortName } = findTodayAppointment({
      index: 1
    })
    const operator = users.find(
      (user) =>
        user.id !== users[0].id && user.permissions.includes('implantImaging')
    )
    if (!operator) {
      throw new Error(
        'Seed data needs another mammographer with implant imaging permission'
      )
    }

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
      .getByRole('button', { name: 'Complete all and authorise imaging' })
      .first()
      .click()

    await takeImagesAndComplete(page, operator.id)

    await expect(page).toHaveURL(new RegExp(`/clinics/${clinic.id}`))
    await expect(page.getByText(`${shortName} has been screened`)).toBeVisible()
    await page.goto(
      `/clinics/${clinic.id}/appointments/${appointment.id}/appointment`
    )
    const mammographersRow = page
      .locator('.nhsuk-summary-list__row')
      .filter({ has: page.getByText('Mammographers', { exact: true }) })
    await expect(mammographersRow).toContainText(
      `${users[0].firstName} ${users[0].lastName} (Practitioner)`
    )
    await expect(mammographersRow).toContainText(
      `${operator.firstName} ${operator.lastName} (Operator)`
    )

    await page.goto(`/clinics/${clinic.id}/complete`)
    const clinicRow = page.locator(`tr[data-fragment-id="${appointment.id}"]`)
    const completedColumn = clinicRow.locator(
      '.app-clinic-appointments-table__completed-column'
    )
    await expect(
      completedColumn.locator('.app-clinic-appointments-table__completed-time')
    ).toHaveCSS('display', 'block')
    await expect(
      completedColumn.locator(
        '.app-clinic-appointments-table__completed-details'
      )
    ).toHaveCSS('display', 'block')
    await expect(completedColumn).toContainText(
      `${users[0].firstName} ${users[0].lastName} (you), ${operator.firstName} ${operator.lastName}`
    )
  })

  test('adds a symptom and a breast feature while taking images', async ({
    page
  }) => {
    const { clinic, appointment } = findTodayAppointment({ index: 4 })
    const imagingUrl = `/clinics/${clinic.id}/appointments/${appointment.id}/take-images`

    await pinSettings(page, appointmentSettings)
    await page.goto(
      `/clinics/${clinic.id}/appointments/${appointment.id}/start`
    )
    await page.getByRole('button', { name: 'Confirm identity' }).first().click()
    await page
      .getByRole('button', { name: 'Complete all and authorise imaging' })
      .first()
      .click()

    await expect(
      page.getByRole('heading', { name: 'Take mammogram images' })
    ).toBeVisible()

    const expander = page.locator('#symptoms-and-breast-features')
    await expect(expander).not.toHaveAttribute('open')
    await expander.locator('summary').click()

    // Symptom, in the modal
    const symptomModal = await clickToOpenModal(page, 'Lump', { exact: true })
    const symptomLocation = symptomModal.locator(
      'input[name="appointment[symptomTemp][location]"][value="right breast"]'
    )
    await revealInModal(symptomLocation)
    await symptomLocation.check()
    await symptomModal
      .locator(
        'input[name="appointment[symptomTemp][dateType]"][value="Less than 3 months"]'
      )
      .check()
    await symptomModal.getByRole('button', { name: 'Save symptom' }).click()
    await expectModalClosed(symptomModal)

    await expect(page).toHaveURL(new RegExp(imagingUrl))
    await expect(expander).toHaveAttribute('open')
    await expect(expander).toContainText('1 symptom added')

    // Breast feature, on its own page - the diagram's popover can't work in
    // a modal. Clicking anywhere on the body outline picks a region.
    await expander.getByRole('button', { name: 'Add a feature' }).click()
    await expect(
      page.getByRole('heading', { name: 'Record breast features' })
    ).toBeVisible()

    // The diagram is a module script, so it can attach its click handler after
    // the heading is already visible
    await page.waitForFunction(() => window.breastFeaturesInitialized)
    const diagram = page.locator('.breast-features__diagram svg')
    const diagramBox = await diagram.boundingBox()
    await diagram.click({
      position: { x: diagramBox.width * 0.3, y: diagramBox.height * 0.6 }
    })
    const popover = page.locator('.breast-features__popover')
    await expect(popover).toBeVisible()
    await popover
      .locator('input[name="feature"]')
      .first()
      .check({ force: true })
    await popover.locator('[data-action="add"]').click()
    await page.getByRole('button', { name: 'Save', exact: true }).click()

    await expect(page).toHaveURL(new RegExp(imagingUrl))
    await expect(page).not.toHaveURL(/_modal_breakout/)
    await expect(expander).toHaveAttribute('open')
    await expect(expander).toContainText('1 symptom and 1 breast feature added')
  })

  test('records why no images were needed after bilateral mastectomy', async ({
    page
  }) => {
    const { clinic, appointment, shortName } = findTodayAppointment({
      index: 2
    })

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
    await mastectomySide.evaluate((element) => element.click())
    await expect(mastectomySide).toBeChecked()

    await historyModal.getByRole('button', { name: 'Save' }).click()
    await expect(
      historyModal.getByRole('heading', { name: 'Bilateral mastectomy' })
    ).toBeVisible()
    const noImages = historyModal.locator(
      'input[name="appointment[medicalHistoryTemp][mastectomyImagingSide]"][value="None"]'
    )
    await expect(noImages).not.toBeChecked()
    await historyModal
      .getByRole('button', { name: 'Save and continue' })
      .click()
    await expect(
      historyModal
        .locator('.nhsuk-error-message')
        .filter({ hasText: 'Select whether any images need to be taken' })
    ).toBeVisible()
    await revealInModal(noImages)
    await noImages.check()
    await historyModal
      .getByRole('button', { name: 'Save and continue' })
      .click()

    await expect(
      historyModal.getByRole('heading', {
        name: 'This appointment cannot continue'
      })
    ).toBeVisible()

    await historyModal
      .getByRole('button', { name: 'Confirm and return to clinic' })
      .click()

    await expect(page).toHaveURL(new RegExp(`/clinics/${clinic.id}`))
    await expect(
      page.locator('.nhsuk-notification-banner__heading')
    ).toHaveText(
      `Appointment ended. ${shortName} does not need any images because of their bilateral mastectomy. View their appointment`
    )
    const endedAppointmentPage = await page.request.get(
      `/clinics/${clinic.id}/appointments/${appointment.id}/appointment`
    )
    expect(await endedAppointmentPage.text()).toContain(
      'No, not invited to future screening episodes'
    )
    await page.getByRole('link', { name: /^All/ }).click()
    await expect(
      page.locator(`#appointment-row-${appointment.id}`)
    ).toContainText('Reason for stopping: Other reason (Bilateral mastectomy)')
  })

  test('requests consent when breast implants are selected', async ({
    page
  }) => {
    const { clinic, appointment } = findTodayAppointment({ index: 3 })

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
    const historyModal = await clickToOpenModal(
      page,
      'Breast implants or augmentation'
    )
    const implants = historyModal.locator(
      'input[name="appointment[medicalHistoryTemp][procedures]"][value="Breast implants"]'
    )
    await implants.evaluate((element) => element.click())
    const implantSide = historyModal.locator(
      'input[name="appointment[medicalHistoryTemp][breastImplantsSide]"][value="Both"]'
    )
    await revealInModal(implantSide)
    await implantSide.check()
    await historyModal.getByRole('button', { name: 'Save' }).click()

    await expect(
      historyModal.getByRole('heading', {
        name: 'Request consent to continue'
      })
    ).toBeVisible()
    await historyModal.getByLabel('Yes', { exact: true }).check()
    await historyModal.getByRole('button', { name: 'Continue' }).click()
    await expectModalClosed(historyModal)
    await expect(page.getByText('Breast implants').first()).toBeVisible()
  })

  test('clears mastectomy imaging details when changing to one side', async ({
    page
  }) => {
    const { clinic, appointment } = findTodayAppointment({ index: 5 })

    await pinSettings(page, appointmentSettings)
    await page.goto(
      `/clinics/${clinic.id}/appointments/${appointment.id}/start`
    )

    await expect(
      page.getByRole('heading', { name: 'Confirm identity' })
    ).toBeVisible()
    await page.getByRole('button', { name: 'Confirm identity' }).first().click()
    await openSection(page, 'Medical history')
    let historyModal = await clickToOpenModal(page, 'Breast cancer')

    const cancerLocation = historyModal.locator(
      'input[name="appointment[medicalHistoryTemp][cancerLocation]"][value="Right breast"]'
    )
    await cancerLocation.evaluate((element) => element.click())
    const mastectomy = historyModal.locator(
      'input[name="appointment[medicalHistoryTemp][procedures]"][value="Mastectomy"]'
    )
    await mastectomy.evaluate((element) => element.click())
    const bilateralMastectomy = historyModal.locator(
      'input[name="appointment[medicalHistoryTemp][mastectomySide]"][value="Both"]'
    )
    await revealInModal(bilateralMastectomy)
    await bilateralMastectomy.check()
    await historyModal.getByRole('button', { name: 'Save' }).click()

    const imageBothSides = historyModal.locator(
      'input[name="appointment[medicalHistoryTemp][mastectomyImagingSide]"][value="Both"]'
    )
    await revealInModal(imageBothSides)
    await imageBothSides.check()
    await historyModal
      .locator(
        'input[name="appointment[medicalHistoryTemp][mastectomyImagingDetailsTemp][Both]"]'
      )
      .fill('Details for bilateral imaging')
    await historyModal
      .getByRole('button', { name: 'Save and continue' })
      .click()
    await expectModalClosed(historyModal)

    const breastCancerCard = page.locator('.nhsuk-card').filter({
      has: page.getByRole('heading', {
        name: 'Breast cancer',
        exact: true
      })
    })
    await waitForModalsReady(page)
    await breastCancerCard.getByRole('link', { name: 'Change' }).click()
    historyModal = await openFormModal(page)
    const rightMastectomy = historyModal.locator(
      'input[name="appointment[medicalHistoryTemp][mastectomySide]"][value="Right"]'
    )
    await revealInModal(rightMastectomy)
    await rightMastectomy.check()
    await historyModal.getByRole('button', { name: 'Save' }).click()

    const imageLeftSide = historyModal.locator(
      'input[name="appointment[medicalHistoryTemp][mastectomyImagingSide]"][value="Left"]'
    )
    await revealInModal(imageLeftSide)
    await imageLeftSide.check()
    await historyModal
      .getByRole('button', { name: 'Save and continue' })
      .click()
    await expectModalClosed(historyModal)
    await expect(breastCancerCard).not.toContainText(
      'Details for bilateral imaging'
    )
  })
})
