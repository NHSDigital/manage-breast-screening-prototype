// Close clinic page - page-specific enhancements on top of
// fragment-actions.js, which already handles the single outcome links
// (marked data-fragment-action in the row macro). This file adds the parts
// with wider effects: bulk actions, revealing the refresh hint when counts
// go stale, and refreshing a row after its details modal saves.

import { refreshFragment } from './fragment-actions.js'

document.addEventListener('DOMContentLoaded', () => {
  const container = document.getElementById('js-close-clinic-content')
  if (!container) return

  const clinicId = container.dataset.clinicId
  const fetchOptions = { headers: { 'X-Requested-With': 'XMLHttpRequest' } }
  let detailsToOpen = null

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
    window.openModal('app-form-modal', {
      loadUrl: `/clinics/${clinicId}/close/reason/${appointmentId}`,
      onSuccess: () => {
        const row = rowFor(appointmentId)
        if (!row) return window.location.reload()
        refreshRow(row).catch(() => window.location.reload())
      }
    })
  })

  const rowFor = (appointmentId) =>
    container.querySelector(`tr[data-fragment-id="${appointmentId}"]`)

  // Re-fetch one row and swap it in place
  const refreshRow = (row) => {
    const showActions = row.closest('table')?.dataset.showActions || 'false'
    const url = `/clinics/${clinicId}/close/appointment-row/${row.dataset.fragmentId}?showActions=${showActions}`
    return refreshFragment(row, url)
  }

  // Bulk outcome change - refresh each affected row, then swap the button
  // and its undo message over
  const handleBulkClick = (link) => {
    const bulkContainer = link.closest('.js-bulk-action-container')
    const isUndo = Boolean(link.closest('.js-bulk-undo-message'))

    fetch(link.href, fetchOptions)
      .then((response) => {
        if (!response.ok) throw new Error('Request failed')
        return response.json()
      })
      .then((result) => {
        const rows = result.appointmentIds.map(rowFor).filter(Boolean)
        return Promise.all(rows.map(refreshRow)).then(() => result)
      })
      .then((result) => {
        bulkContainer.querySelector('.nhsuk-button').hidden = !isUndo
        const undoMessage = bulkContainer.querySelector('.js-bulk-undo-message')
        undoMessage.hidden = isUndo
        if (!isUndo) {
          undoMessage.querySelector('.js-bulk-count').textContent =
            result.count === 1 ? '1 participant' : `${result.count} participants`
        }
        showRefreshLink()
      })
      .catch(() => {
        window.location.href = link.href
      })
  }

  container.addEventListener('click', (event) => {
    const actionLink = event.target.closest('a[data-open-details-after-action]')
    if (actionLink) {
      detailsToOpen = actionLink.closest('[data-fragment-id]')?.dataset.fragmentId
    }

    const bulkLink = event.target.closest('.js-bulk-action')
    if (bulkLink) {
      event.preventDefault()
      handleBulkClick(bulkLink)
      return
    }

    // Details links open in a modal (attributes added by the openInModal
    // filter). Take over from the global handler in modal.js so the row can
    // be refreshed in place when the modal form saves.
    const modalLink = event.target.closest('[data-load-modal-url]')
    if (modalLink) {
      event.preventDefault()
      event.stopPropagation()
      const appointmentId = modalLink.closest('tr')?.dataset.fragmentId
      window.openModal(modalLink.dataset.modalId || 'app-form-modal', {
        loadUrl: modalLink.dataset.loadModalUrl,
        onSuccess: () => {
          const row = rowFor(appointmentId)
          if (!row) return window.location.reload()
          refreshRow(row).catch(() => window.location.reload())
        }
      })
    }
  })
})
