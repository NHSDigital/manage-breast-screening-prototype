// tests/e2e/reading.spec.js
//
// One journey through image reading: create a small session, record a normal
// opinion, then a recall for assessment with an annotation, and reach the end
// of the session.
//
// The session is created with an explicit limit so the test reads a known,
// small number of cases rather than working through a default-sized session.
//
// Not covered: the image-marking annotation modes ('with-images-simple' and
// friends), which need pixel-accurate clicks on the mammogram views. This spec
// pins 'without-images', where the abnormality location is typed instead.

const { test, expect } = require('./helpers/fixtures')
const { pinSettings, readingSettings } = require('./helpers/settings')
const { clickToOpenModal, expectModalClosed } = require('./helpers/modals')

// Cases in the session: two read as normal, the last recalled for assessment
const sessionSize = 3

/**
 * Record a normal opinion on the case currently on screen
 *
 * @param {import('@playwright/test').Page} page - Playwright page
 */
const recordNormal = async (page) => {
  await expect(
    page.getByRole('heading', { name: 'What is your opinion of these images?' })
  ).toBeVisible()
  await page.getByRole('button', { name: 'Normal (N)' }).first().click()
}

test.describe('Image reading', () => {
  test('reads a session of cases as normal and recall', async ({ page }) => {
    await pinSettings(page, readingSettings)

    await page.goto(
      `/reading/create-session?type=all_reads&limit=${sessionSize}&lazy=false`
    )
    await expect(page).toHaveURL(/\/reading\/session\/[^/]+\/appointments\//)

    // Read all but the last case as normal
    for (let caseNumber = 1; caseNumber < sessionSize; caseNumber++) {
      await recordNormal(page)
    }

    // Recall the last case for assessment
    await expect(
      page.getByRole('heading', {
        name: 'What is your opinion of these images?'
      })
    ).toBeVisible()
    await page
      .getByRole('button', { name: 'Recall for assessment (R)' })
      .first()
      .click()

    await expect(page).toHaveURL(/\/recall-for-assessment-details/)
    await page
      .locator(
        'input[name="imageReadingTemp[right][breastAssessment]"][value="abnormal"]'
      )
      .check()
    await page
      .locator(
        'input[name="imageReadingTemp[left][breastAssessment]"][value="normal"]'
      )
      .check()

    // An abnormal breast needs at least one annotation before it can be saved
    const annotationModal = await clickToOpenModal(page, 'Ill-defined mass')
    await annotationModal
      .locator('#modal-location')
      .fill('Upper outer quadrant')
    // The level of concern control hides its radios behind a custom picker,
    // so the label is the thing to click
    await annotationModal
      .locator(
        'label[for="modal-imageReadingTemp[annotationTemp][levelOfConcern]-4"]'
      )
      .click()
    await annotationModal.getByRole('button', { name: 'Save' }).first().click()
    await expectModalClosed(annotationModal)

    await expect(page.getByText('Level 4 (suspicious)')).toBeVisible()
    await page.getByRole('button', { name: 'Continue' }).first().click()

    await expect(
      page.getByRole('heading', { name: 'Confirm your opinion' })
    ).toBeVisible()
    await expect(page.getByText('Recall for assessment').first()).toBeVisible()
    await page.getByRole('button', { name: 'Confirm and save' }).click()

    await expect(
      page.getByRole('heading', { name: 'Session complete' })
    ).toBeVisible()
  })
})
