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
const {
  findCaseAwaitingSecondRead,
  readCollection
} = require('./helpers/seed-data')
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
 * Record a normal outcome on the arbitration case currently on screen.
 *
 * Arbitration confirms the outcome on a review step before saving it, rather
 * than saving straight from the opinion buttons the way a read does.
 *
 * @param {import('@playwright/test').Page} page - Playwright page
 */
const recordArbitrationNormal = async (page) => {
  await page.getByRole('button', { name: 'Normal (N)' }).first().click()

  await expect(page).toHaveURL(/\/review/)
  await page.getByRole('button', { name: 'Confirm and save' }).first().click()
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

    // The case now sits on the deferred list, waiting for manual review.
    // Scope everything to its card - the seed data carries deferred cases of
    // its own, so the page is never otherwise empty
    await page.goto('/reading/deferred')
    await expect(
      page.getByRole('heading', { name: 'Deferred cases' })
    ).toBeVisible()
    const deferralCard = page
      .locator('.nhsuk-summary-card')
      .filter({ hasText: deferralReason })
    await expect(deferralCard).toBeVisible()

    // Unflagging returns it to the queue, keeping a record of why it was held
    await deferralCard.getByRole('button', { name: 'Unflag case' }).click()

    await expect(
      page.getByRole('heading', { name: 'Recently resolved' })
    ).toBeVisible()
    await expect(
      page.locator('.nhsuk-summary-card').filter({ hasText: deferralReason })
    ).toContainText('Returned to queue')
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

  test('does not load an extra case when a skipped case is read out of order', async ({
    page
  }) => {
    // Settling a case only earns the session a new one when it has nothing left
    // to work on. Going back for a skipped case while a loaded case is still
    // unread used to add one anyway, leaving the session permanently a case
    // ahead of where the reader had actually got to.
    await pinSettings(page, readingSettings)

    await page.goto('/reading/create-session?type=all_reads&limit=10&lazy=true')
    await expect(page).toHaveURL(/\/reading\/session\/[^/]+\/appointments\//)

    const sessionId = page.url().split('/session/')[1].split('/')[0]
    const caseRows = page.locator(
      '.app-reading-session-table tbody tr:not(.app-placeholder-row) a[href*="/appointments/"]'
    )

    // Read the first case, which loads the second
    await recordNormal(page)
    await expect(page).toHaveURL(/\/appointments\//)

    // Skip the second case, which loads the third and moves the reader to it
    const skippedAppointmentId = page.url().split('/appointments/')[1].split('/')[0]
    await page.goto(
      `/reading/session/${sessionId}/appointments/${skippedAppointmentId}/skip`
    )
    await expect(page).toHaveURL(/\/appointments\//)

    await page.goto(`/reading/session/${sessionId}/all-reads`)
    const rowsBefore = await caseRows.count()

    // Go back and read the skipped case. The third case is still unread, so the
    // session already has somewhere to send the reader next
    await page.goto(
      `/reading/session/${sessionId}/appointments/${skippedAppointmentId}`
    )
    await recordNormal(page)
    await expect(page).toHaveURL(/\/appointments\//)

    await page.goto(`/reading/session/${sessionId}/all-reads`)
    await expect(caseRows).toHaveCount(rowsBefore)
  })

  test('still loads a case when the only one left behind was skipped', async ({
    page
  }) => {
    // The counterpart to the test above: a skipped case sitting behind the
    // reader isn't somewhere they can be sent next, so finishing the case at the
    // front of the session does have to load a new one.
    await pinSettings(page, readingSettings)

    await page.goto('/reading/create-session?type=all_reads&limit=10&lazy=true')
    await expect(page).toHaveURL(/\/reading\/session\/[^/]+\/appointments\//)

    const sessionId = page.url().split('/session/')[1].split('/')[0]
    const caseRows = page.locator(
      '.app-reading-session-table tbody tr:not(.app-placeholder-row) a[href*="/appointments/"]'
    )

    // Skip the first case, which loads the second and moves the reader to it
    const skippedAppointmentId = page.url().split('/appointments/')[1].split('/')[0]
    await page.goto(
      `/reading/session/${sessionId}/appointments/${skippedAppointmentId}/skip`
    )
    await expect(page).toHaveURL(/\/appointments\//)

    await page.goto(`/reading/session/${sessionId}/all-reads`)
    const rowsBefore = await caseRows.count()

    // Read the case at the front. Only the skipped case sits behind it, so the
    // session has to load another to have anywhere to send the reader
    await page.goto(`/reading/session/${sessionId}/resume`)
    await expect(page).toHaveURL(/\/appointments\//)
    await recordNormal(page)

    await page.goto(`/reading/session/${sessionId}/all-reads`)
    await expect(caseRows).toHaveCount(rowsBefore + 1)
  })

  test('does not load an extra arbitration case when one is settled out of order', async ({
    page
  }) => {
    // Arbitration sessions are lazy on the same terms as reading ones, and grow
    // through the same top-up, so the out-of-order case has to hold here too.
    await pinSettings(page, {
      ...readingSettings,
      'settings[reading][arbitration][lazySessions]': 'true',
      'settings[reading][lazySessions]': 'true'
    })

    // Arbitrating alone rather than as a panel
    await page.goto('/reading/arbitration/start')
    await page.locator('input[name="arbitrationTemp[mode]"]').first().check()
    await page.getByRole('button', { name: /Continue/i }).first().click()

    await expect(page).toHaveURL(/\/session\/[^/]+\/appointments\//)
    const sessionId = page.url().split('/session/')[1].split('/')[0]
    const caseRows = page.locator(
      '.app-reading-session-table tbody tr:not(.app-placeholder-row) a[href*="/appointments/"]'
    )

    await recordArbitrationNormal(page)
    await expect(page).toHaveURL(/\/appointments\//)

    // Skip the second case, which loads the third and moves the reader to it
    const skippedAppointmentId = page.url().split('/appointments/')[1].split('/')[0]
    await page.goto(
      `/reading/session/${sessionId}/appointments/${skippedAppointmentId}/skip`
    )
    await expect(page).toHaveURL(/\/appointments\//)

    await page.goto(`/reading/session/${sessionId}/all-reads`)
    const rowsBefore = await caseRows.count()

    // Settle the skipped case while the third is still outstanding
    await page.goto(
      `/reading/session/${sessionId}/appointments/${skippedAppointmentId}`
    )
    await recordArbitrationNormal(page)
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
      'settings[reading][arbitration][policy]': 'discordant_only'
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

  test('finalises reads from the session overview', async ({ page }) => {
    // With a finalisation delay, a fresh read sits unfinalised. Finalisation
    // deliberately lives on the session overview - behind a chance to review
    // what was read - not on the session-complete page, which only points
    // there. The seeded first read is hours old, so it has auto-finalised -
    // finalising ours settles the case.
    await pinSettings(page, {
      ...readingSettings,
      'settings[reading][finalisationDelay]': '60'
    })

    await page.goto(
      '/reading/create-session?type=second_reads&limit=1&lazy=false'
    )
    await expect(page).toHaveURL(/\/reading\/session\/[^/]+\/appointments\//)

    // The case in hand, for finding its case view afterwards
    const appointmentId = page.url().split('/appointments/')[1].split('/')[0]

    await recordNormal(page)

    // The only case is read, so the session is complete - the page notes the
    // unfinalised read but sends the reader to the overview to finalise it
    await expect(page).toHaveURL(/\/no-more-cases/)
    await expect(page.getByText('not yet finalised')).toBeVisible()
    await page.getByRole('button', { name: 'See session overview' }).click()

    // The session-complete panel carries the auto-finalisation time and the
    // finalise action
    await expect(page.getByText('finalised automatically')).toBeVisible()
    await page.getByRole('link', { name: 'Finalise opinions now' }).click()

    // Finalised: the prompt gives way to the settled state
    await expect(page.getByText('All opinions are finalised')).toBeVisible()

    // Both reads now finalised, so the case has settled - concluded if the
    // reads agreed, awaiting arbitration if not
    const episodes = readCollection('episodes.json', 'episodes')
    const readingCase = episodes
      .flatMap((episode) => episode.readingCases || [])
      .find((candidate) => candidate.appointmentId === appointmentId)

    await page.goto(`/reading/cases/${readingCase.id}`)
    const stateRow = page.locator('.nhsuk-summary-list__row', {
      hasText: 'State'
    })
    await expect(stateRow).toContainText(/Concluded|Awaiting arbitration/)
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
