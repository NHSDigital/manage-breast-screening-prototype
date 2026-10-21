// app/assets/javascript/close-clinic.js
//
// Close clinic page - enhancements on top of fragment-actions.js, which
// handles the status links in each row (marked data-fragment-action). This
// file reveals the refresh notice when counts go stale, and refreshes a row
// after its details modal saves.

import { refreshFragment } from './lib/fragments.js'

document.addEventListener('DOMContentLoaded', () => {
  const container = document.getElementById('js-close-clinic-content')
  if (!container) return

  const clinicId = container.dataset.clinicId

  // Counts in the card headings and inset text aren't updated in place -
  // this notice invites a refresh instead
  const showRefreshNotice = () => {
    const notice = container.querySelector('.js-refresh-notice')
    if (notice) notice.hidden = false
  }

  // Any swapped row means the page counts may be stale
  container.addEventListener('fragment:swapped', showRefreshNotice)

  // Re-fetch one row and swap it in place
  const refreshRow = (appointmentId) => {
    const row = container.querySelector(
      `tr[data-fragment-id="${appointmentId}"]`
    )
    if (!row) return window.location.reload()
    const url = `/clinics/${clinicId}/close/appointment-row/${appointmentId}`
    refreshFragment(row, url).catch(() => window.location.reload())
  }

  container.addEventListener('click', (event) => {
    // Details links open in a modal when modal forms are on (attributes added
    // by the openInModal filter). Take over from the global handler in
    // modal.js so the row can be refreshed in place when the modal form saves.
    const modalLink = event.target.closest('[data-load-modal-url]')
    if (!modalLink) return

    event.preventDefault()
    event.stopPropagation()
    const appointmentId = modalLink.closest('tr')?.dataset.fragmentId
    window.openModal(modalLink.dataset.modalId || 'app-form-modal', {
      loadUrl: modalLink.dataset.loadModalUrl,
      onSuccess: () => refreshRow(appointmentId)
    })
  })
})
