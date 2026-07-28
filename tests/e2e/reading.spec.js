// tests/e2e/reading.spec.js
//
// Journeys through image reading. Between them they cover the four ways a
// reader can leave a case - normal, recall for assessment, technical recall,
// and deferral - plus the second reader's comparison step.
//
// Sessions are created with an explicit limit so each test reads a known,
// small number of cases rather than working through a default-sized session.
//
// Not covered: the image-marking annotation modes ('with-images-simple' and
// friends), which need pixel-accurate clicks on the mammogram views. These
// specs pin 'without-images', where the abnormality location is typed instead.

const { test, expect } = require('./helpers/fixtures')
const { pinSettings, readingSettings } = require('./helpers/settings')
const {
  clickToOpenModal,
  clickLinkToOpenModal,
  expectModalClosed
} = require('./helpers/modals')

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

/**
 * Fill in the technical recall details for one view and continue.
 *
 * The technical recall form opens in the shared modal - unlike recall for
 * assessment, its route doesn't break out to a full page - so ids inside it
 * carry the modal's 'modal-' prefix. Field names are left alone, which makes
 * them the more stable thing to target.
 *
 * @param {import('@playwright/test').Locator} modal - The open modal container
 * @param {string} view - View code to mark for retaking, eg 'RMLO'
 * @param {string} reason - Reason to select from the dropdown
 */
const recordTechnicalRecallDetails = async (modal, view, reason) => {
  await modal
    .locator(
      `input[name="imageReadingTemp[technicalRecall][selectedViews]"][value="${view}"]`
    )
    .check()

  // The reason select sits in the checkbox's conditional reveal, so it only
  // becomes reachable once the view above is checked
  await modal
    .locator(
      `select[name="imageReadingTemp[technicalRecall][views][${view}][reason]"]`
    )
    .selectOption(reason)

  await modal.getByRole('button', { name: 'Continue' }).first().click()
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

  test('records a technical recall', async ({ page }) => {
    // The review page is opt-in for technical recall, and it's the step that
    // proves the selected views survived to the point of saving
    await pinSettings(page, {
      ...readingSettings,
      'settings[reading][confirmTechnicalRecall]': 'true'
    })

    await page.goto('/reading/create-session?type=all_reads&limit=1&lazy=false')
    await expect(page).toHaveURL(/\/reading\/session\/[^/]+\/appointments\//)

    await expect(
      page.getByRole('heading', { name: 'What is your opinion of these images?' })
    ).toBeVisible()

    const recallModal = await clickToOpenModal(page, 'Technical recall (T)')
    await expect(
      recallModal.getByRole('heading', { name: 'Technical recall' })
    ).toBeVisible()

    await recordTechnicalRecallDetails(recallModal, 'RMLO', 'Image blurred')

    // The review step stays in the modal, and the opinion page underneath still
    // has its own "Technical recall" button - so assert against the modal, not
    // the page, or the hidden button below matches first
    await expect(
      recallModal.getByRole('heading', { name: 'Confirm your opinion' })
    ).toBeVisible()
    await expect(recallModal.getByText('Technical recall').first()).toBeVisible()
    await expect(recallModal.getByText('RMLO').first()).toBeVisible()
    await expect(recallModal.getByText('Image blurred')).toBeVisible()
    await recallModal.getByRole('button', { name: 'Confirm and save' }).click()

    await expect(
      page.getByRole('heading', { name: 'Session complete' })
    ).toBeVisible()
  })

  test('defers a case and returns it to the reading queue', async ({ page }) => {
    await pinSettings(page, readingSettings)

    // The reason is the thing that identifies this deferral on the deferred
    // cases page, so make it distinctive
    const deferralReason = 'Prior images needed before an opinion can be given'

    await page.goto('/reading/create-session?type=all_reads&limit=1&lazy=false')
    await expect(page).toHaveURL(/\/reading\/session\/[^/]+\/appointments\//)

    const deferModal = await clickLinkToOpenModal(page, 'Defer this case')
    await deferModal.locator('#modal-deferralReason').fill(deferralReason)
    await deferModal
      .getByRole('button', { name: 'Confirm deferral' })
      .first()
      .click()

    // Deferral takes the only case out of the session, so there is nothing
    // left to read
    await expect(page).toHaveURL(/\/no-more-cases/)

    // The case now sits on the deferred list, waiting for manual review
    await page.goto('/reading/deferred')
    await expect(
      page.getByRole('heading', { name: 'Deferred cases' })
    ).toBeVisible()
    await expect(page.getByText(deferralReason)).toBeVisible()

    // Unflagging returns it to the queue, keeping a record of why it was held
    await page.getByRole('button', { name: 'Unflag case' }).first().click()

    await expect(
      page.getByRole('heading', { name: 'Recently resolved' })
    ).toBeVisible()
    await expect(page.getByText('No deferred cases.')).toBeVisible()
    await expect(page.getByText(deferralReason)).toBeVisible()
  })

  test('shows the second reader the first read before saving', async ({
    page
  }) => {
    // 'early' shows the comparison as soon as an opinion is chosen, before any
    // details are entered - the shortest path to the page under test. Combined
    // with 'non_normal', any non-normal second opinion reaches it whatever the
    // first reader said, so the test doesn't depend on the seeded read.
    await pinSettings(page, {
      ...readingSettings,
      'settings[reading][secondReaderComparison]': 'early',
      'settings[reading][compareWhen]': 'non_normal',
      'settings[reading][confirmTechnicalRecall]': 'true'
    })

    await page.goto(
      '/reading/create-session?type=second_reads&limit=1&lazy=false'
    )
    // An empty candidate list would redirect to /reading instead
    await expect(page).toHaveURL(/\/reading\/session\/[^/]+\/appointments\//)

    await expect(
      page.getByRole('heading', { name: 'What is your opinion of these images?' })
    ).toBeVisible()

    // Unlike the details pages, the comparison breaks out of the modal and
    // takes over the page, so this is a plain click rather than clickToOpenModal
    await page.getByRole('button', { name: 'Technical recall (T)' }).first().click()

    await expect(page).toHaveURL(/\/compare/)
    // Exact, because the page heading ("The first reader had a different
    // opinion") would otherwise match too
    await expect(
      page.getByRole('heading', { name: 'First read', exact: true })
    ).toBeVisible()
    await expect(
      page.getByRole('heading', { name: 'Your read', exact: true })
    ).toBeVisible()

    // Standing by the second opinion continues to its details page
    await page.getByRole('button', { name: 'Keep your opinion' }).first().click()

    await expect(page).toHaveURL(/\/technical-recall/)
  })
})
