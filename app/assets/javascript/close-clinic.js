// Close clinic page - progressively enhances the outcome action links so
// status changes happen without a full page reload. Without JS every link
// still works as a normal navigation. Changed rows are re-rendered
// server-side (the appointment-row fragment route) and swapped in place, so
// tags and action links can't drift from the server's rendering.

document.addEventListener('DOMContentLoaded', () => {
  const container = document.getElementById('js-close-clinic-content')
  if (!container) return

  const clinicId = container.dataset.clinicId
  const fetchOptions = { headers: { 'X-Requested-With': 'XMLHttpRequest' } }

  // Counts in the card headings and inset text aren't updated in place -
  // this link invites a refresh instead
  const showRefreshLink = () => {
    const link = container.querySelector('.js-refresh-link')
    if (link) link.hidden = false
  }

  const rowFor = (appointmentId) =>
    container.querySelector(`tr[data-appointment-id="${appointmentId}"]`)

  // Replace a row with its server-rendered replacement
  const swapRow = (row, html) => {
    const template = document.createElement('template')
    template.innerHTML = html.trim()
    const newRow = template.content.querySelector('tr[data-appointment-id]')
    if (!newRow || newRow.dataset.appointmentId !== row.dataset.appointmentId) {
      throw new Error('Response was not the expected row')
    }
    row.replaceWith(newRow)
  }

  // Re-fetch one row and swap it in place
  const refreshRow = (row) => {
    const showActions = row.closest('table')?.dataset.showActions || 'false'
    const url = `/clinics/${clinicId}/close/appointment-row/${row.dataset.appointmentId}?showActions=${showActions}`
    return fetch(url, fetchOptions)
      .then((response) => {
        if (!response.ok) throw new Error('Failed to refresh row')
        return response.text()
      })
      .then((html) => swapRow(row, html))
  }

  // Single outcome change - the response is the re-rendered row
  const handleActionClick = (link) => {
    const row = link.closest('tr')
    fetch(link.href, fetchOptions)
      .then((response) => {
        if (!response.ok) throw new Error('Request failed')
        return response.text()
      })
      .then((html) => {
        swapRow(row, html)
        showRefreshLink()
      })
      .catch(() => {
        window.location.href = link.href
      })
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
    const actionLink = event.target.closest('.js-close-clinic-action')
    if (actionLink) {
      event.preventDefault()
      handleActionClick(actionLink)
      return
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
      const appointmentId = modalLink.closest('tr')?.dataset.appointmentId
      window.openModal(modalLink.dataset.modalId || 'app-form-modal', {
        loadUrl: modalLink.dataset.loadModalUrl,
        onSuccess: () => {
          const row = rowFor(appointmentId)
          if (!row) return window.location.reload()
          refreshRow(row)
            .then(showRefreshLink)
            .catch(() => window.location.reload())
        }
      })
    }
  })
})
