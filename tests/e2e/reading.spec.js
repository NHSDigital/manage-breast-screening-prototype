// tests/e2e/reading.spec.js
//
// Journeys through image reading. Between them they cover the four ways a
// reader can leave a case - normal, recall for assessment, technical recall,
// and deferral - plus the second reader's comparison step, and a concordant
// second read taking a case to its concluded outcome.
//
// Sessions are created with an explicit limit so each test reads a known,
// small number of cases rather than working through a default-sized session.
//
// Not covered: the image-marking annotation modes ('with-images-simple' and
// friends), which need pixel-accurate clicks on the mammogram views. These
// specs pin 'without-images', where the abnormality location is typed instead.

const { test, expect } = require('./helpers/fixtures')
const { pinSettings, readingSettings } = require('./helpers/settings')
const { findCaseAwaitingSecondRead } = require('./helpers/seed-data')
const {
  clickToOpenModal,
  clickLinkToOpenModal,
  revealInModal,
  expectModalClosed
} = require('./helpers/modals')

// Cases in the session: two read as normal, the last recalled for assessment
const sessionSize = 3

/**
 * Record a normal opinion on the case currently on screen.
 *
 * A case whose participant disclosed significant symptoms offers "Normal, and
 * add details" instead of a plain "Normal", and then asks the reader to
 * acknowledge the symptoms. Which cases a session picks up depends on the seed
 * data, so both paths have to work.
 *
 * @param {import('@playwright/test').Page} page - Playwright page
 */
const recordNormal = async (page) => {
  await expect(
    page.getByRole('heading', { name: 'What is your opinion of these images?' })
  ).toBeVisible()

  const plainNormal = page.getByRole('button', { name: 'Normal (N)' }).first()

  if (await plainNormal.isVisible()) {
    await plainNormal.click()
    return
  }

  // The details route loads into the shared modal, so this is a modal flow
  const detailsModal = await clickToOpenModal(
    page,
    'Normal, and add details (N)'
  )

  // Symptoms have to be acknowledged before a normal opinion can be saved
  await detailsModal
    .locator('input[name="imageReadingTemp[symptomsAcknowledged]"][value="true"]')
    .check()
  await detailsModal.getByRole('button', { name: 'Continue' }).first().click()

  // The modal has to finish closing before the next case's opinion page is
  // clickable - its overlay swallows pointer events while it is still open
  await expectModalClosed(detailsModal)
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
    const saveAnnotation = annotationModal
      .getByRole('button', { name: 'Save' })
      .first()
    await revealInModal(saveAnnotation)
    await saveAnnotation.click()
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

  test('keeps a lazy session lazy across a resume', async ({ page }) => {
    // Lazy sessions load one case at a time, so the overview should only ever
    // show what has actually been reached. Leaving and resuming used to load
    // every remaining case at once, which made the whole backlog look claimed.
    await pinSettings(page, readingSettings)

    await page.goto(
      '/reading/create-session?type=all_reads&limit=10&lazy=true'
    )
    await expect(page).toHaveURL(/\/reading\/session\/[^/]+\/appointments\//)

    const sessionId = page.url().split('/session/')[1].split('/')[0]

    // Rows for cases the session hasn't reached yet are rendered as
    // placeholders, so count the ones that link to a real case
    const caseRows = page.locator(
      '.app-reading-session-table tbody tr:not(.app-placeholder-row) a[href*="/appointments/"]'
    )

    await page.goto(`/reading/session/${sessionId}/all-reads`)
    const rowsBefore = await caseRows.count()
    expect(rowsBefore).toBeLessThanOrEqual(2)

    // Leave, come back through the dashboard, and resume
    await page.goto('/reading')
    await page.goto(`/reading/session/${sessionId}/resume`)
    await expect(page).toHaveURL(/\/appointments\//)

    await page.goto(`/reading/session/${sessionId}/all-reads`)
    await expect(caseRows).toHaveCount(rowsBefore)
  })

  test('concludes a case after a concordant second read', async ({ page }) => {
    // The safety net under the reading state derivation: a case with one
    // seeded normal read gets a matching second read, and the case view then
    // shows it concluded with a normal outcome. Anything that breaks
    // getReadingCaseState or getReadingCaseOutcome shows up here first.
    await pinSettings(page, {
      ...readingSettings,
      // Concordant reads conclude without arbitration
      'settings[reading][arbitrationPolicy]': 'discordant_only'
    })

    // Picked from the seed data so the first read's opinion is known - the
    // second read mirrors it, making the pair concordant
    const { readingCase, appointment } = findCaseAwaitingSecondRead({
      firstOpinion: 'normal'
    })

    await page.goto(
      '/reading/create-session?type=second_reads&limit=100&lazy=false'
    )
    await expect(page).toHaveURL(/\/reading\/session\/[^/]+\/appointments\//)
    const sessionId = page.url().split('/session/')[1].split('/')[0]

    // Go straight to the chosen case rather than whichever the session leads
    // with - the appointment routes resolve any readable case by id
    await page.goto(`/reading/session/${sessionId}/appointments/${appointment.id}`)
    await recordNormal(page)

    // Saving moves on to another case (or session complete) - wait for that
    // before leaving, so the save has landed
    await expect(page).not.toHaveURL(new RegExp(appointment.id))

    // The case view derives state and outcome from the reads
    await page.goto(`/reading/cases/${readingCase.id}`)

    const summaryRow = (label) =>
      page.locator('.nhsuk-summary-list__row', { hasText: label })

    await expect(summaryRow('State')).toContainText('Concluded')
    await expect(summaryRow('Reads')).toContainText('2')
    await expect(summaryRow('Outcome')).toContainText('Normal')
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
