// tests/e2e/helpers/modals.js
//
// Most forms in the appointment flow open in a modal loaded over the page.
// The modal container itself has no size of its own, so waits and assertions
// target the dialog inside it.

const { expect } = require('@playwright/test')

/**
 * Wait until the modal script has claimed the modals on the page.
 *
 * The buttons that open modals are progressively enhanced: their href points
 * at a full-page version of the form, and a delegated click handler bound on
 * DOMContentLoaded intercepts the click. Playwright is quick enough to click
 * before that handler exists, which quietly follows the non-JS path instead -
 * so wait for the marker the script leaves behind.
 *
 * @param {import('@playwright/test').Page} page - Playwright page
 */
const waitForModalsReady = async (page) => {
  await page.waitForFunction(() =>
    Boolean(document.getElementById('app-form-modal')?.appModal)
  )
}

/**
 * The shared form modal, once its content has loaded.
 *
 * The modal fetches its content. If that takes more than 300ms it shows a
 * "Loading…" placeholder and becomes visible before the real form arrives, so
 * waiting for the dialog alone races the content swap. The body wrapper only
 * exists in the fetched fragment, which makes it the signal to wait on.
 *
 * @param {import('@playwright/test').Page} page - Playwright page
 * @returns {import('@playwright/test').Locator} The modal container
 */
const openFormModal = async (page) => {
  const modal = page.locator('#app-form-modal')
  await expect(modal.locator('.app-modal__dialog')).toBeVisible()
  await expect(modal.locator('.app-modal__body')).toBeVisible()
  return modal
}

/**
 * Click a button that opens a form in the shared modal, and wait for it
 *
 * @param {import('@playwright/test').Page} page - Playwright page
 * @param {string} name - Accessible name of the button
 * @param {object} [options] - Extra options passed to getByRole
 * @returns {import('@playwright/test').Locator} The open modal container
 */
const clickToOpenModal = async (page, name, options = {}) => {
  await waitForModalsReady(page)
  await page
    .getByRole('button', { name, ...options })
    .first()
    .click()
  return openFormModal(page)
}

/**
 * Click a link that opens its target in the shared modal, and wait for it
 *
 * The link variant of clickToOpenModal - openInModal rewires links with
 * data-load-modal-url rather than the data-modal-submit it puts on buttons,
 * but both end up in the same shared modal.
 *
 * @param {import('@playwright/test').Page} page - Playwright page
 * @param {string} name - Accessible name of the link
 * @param {object} [options] - Extra options passed to getByRole
 * @returns {import('@playwright/test').Locator} The open modal container
 */
const clickLinkToOpenModal = async (page, name, options = {}) => {
  await waitForModalsReady(page)
  await page
    .getByRole('link', { name, ...options })
    .first()
    .click()
  return openFormModal(page)
}

/**
 * Wait for a modal to close again after submitting
 *
 * @param {import('@playwright/test').Locator} modal - Modal container
 */
const expectModalClosed = async (modal) => {
  await expect(modal.locator('.app-modal__dialog')).toBeHidden()
}

/**
 * Open one of the collapsed sections on the review medical information page
 *
 * @param {import('@playwright/test').Page} page - Playwright page
 * @param {string} name - Visible section name, eg "Medical history"
 */
const openSection = async (page, name) => {
  const summary = page.locator('main summary', { hasText: name }).first()
  await summary.click()
}

module.exports = {
  waitForModalsReady,
  openFormModal,
  clickToOpenModal,
  clickLinkToOpenModal,
  expectModalClosed,
  openSection
}
