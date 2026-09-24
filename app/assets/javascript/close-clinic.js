// Close clinic page - page-specific enhancements on top of
// fragment-actions.js, which already handles the single outcome links
// (marked data-fragment-action in the row macro). This file adds the parts
// with wider effects: revealing the refresh hint when counts go stale, and
// refreshing a row after its details modal saves.

import { refreshFragment } from './fragment-actions.js'

document.addEventListener('DOMContentLoaded', () => {
  const container = document.getElementById('js-close-clinic-content')
  if (!container) return

  const clinicId = container.dataset.clinicId
  let detailsToOpen = null

  // Open a details form in the modal, or navigate to it when modal forms are
  // disabled and the shell (#app-form-modal) isn't rendered - otherwise the
  // form would never open
  const openDetailsFormOrNavigate = (modalId, loadUrl, onSuccess) => {
    const modal = document.getElementById(modalId)
    if (modal && modal.appModal) {
      window.openModal(modalId, { loadUrl, onSuccess })
    } else {
      window.location.href = loadUrl
    }
  }

  // Counts in the card headings and inset text aren't updated in place -
  // this link invites a refresh instead
  const showRefreshLink = () => {
    const link = container.querySelector('.js-refresh-link')
    if (link) link.hidden = false
  }

  // Any swapped row means the page counts may be stale
  container.addEventListener('fragment:swapped', (event) => {
    showRefreshLink()

    if (detailsToOpen !== event.detail.fragment.dataset.fragmentId) return

    const appointmentId = detailsToOpen
    detailsToOpen = null
    openDetailsFormOrNavigate(
      'app-form-modal',
      `/clinics/${clinicId}/close/reason/${appointmentId}`,
      () => {
        const row = rowFor(appointmentId)
        if (!row) return window.location.reload()
        refreshRow(row).catch(() => window.location.reload())
      }
    )
  })

  const rowFor = (appointmentId) =>
    container.querySelector(`tr[data-fragment-id="${appointmentId}"]`)

  // Re-fetch one row and swap it in place
  const refreshRow = (row) => {
    const showActions = row.closest('table')?.dataset.showActions || 'false'
    const url = `/clinics/${clinicId}/close/appointment-row/${row.dataset.fragmentId}?showActions=${showActions}`
    return refreshFragment(row, url)
  }

  container.addEventListener('click', (event) => {
    const actionLink = event.target.closest('a[data-open-details-after-action]')
    if (actionLink) {
      detailsToOpen = actionLink.closest('[data-fragment-id]')?.dataset.fragmentId
    }

    // Details links open in a modal (attributes added by the openInModal
    // filter). Take over from the global handler in modal.js so the row can
    // be refreshed in place when the modal form saves.
    const modalLink = event.target.closest('[data-load-modal-url]')
    if (modalLink) {
      event.preventDefault()
      event.stopPropagation()
      const appointmentId = modalLink.closest('tr')?.dataset.fragmentId
      openDetailsFormOrNavigate(
        modalLink.dataset.modalId || 'app-form-modal',
        modalLink.dataset.loadModalUrl,
        () => {
          const row = rowFor(appointmentId)
          if (!row) return window.location.reload()
          refreshRow(row).catch(() => window.location.reload())
        }
      )
    }
  })
})
