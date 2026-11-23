// app/assets/javascript/close-clinic.js
//
// Close clinic page - enhancements on top of fragment-actions.js, which
// handles the status links in each row (marked data-fragment-action). This
// file reveals the refresh notice when counts go stale, refreshes the Actions
// card, and refreshes a row after its details modal saves.

import { refreshFragment } from './lib/fragments.js'

document.addEventListener('DOMContentLoaded', () => {
  const container = document.getElementById('js-close-clinic-content')
  if (!container) return

  const clinicId = container.dataset.clinicId

  const actions = document.getElementById('close-clinic-actions')
  let latestActionsRequest = 0

  // Counts in the table card headings aren't updated in place
  const showRefreshNotice = () => {
    const notice = container.querySelector('.js-refresh-notice')
    if (notice) notice.hidden = false
  }

  // Read the latest outcome count from the server after a status change
  const refreshActions = async () => {
    const request = ++latestActionsRequest
    const button = actions.querySelector('button')
    if (button) button.disabled = true

    try {
      const url = new URL(window.location.href)
      url.searchParams.set('_actions', '1')
      const response = await fetch(url)
      if (!response.ok) throw new Error(`Request failed: ${response.status}`)
      const html = await response.text()
      const freshPage = new DOMParser().parseFromString(html, 'text/html')
      const freshActions = freshPage.getElementById('close-clinic-actions')
      if (!freshActions) throw new Error('Actions card missing from response')
      if (request === latestActionsRequest) {
        actions.replaceChildren(...freshActions.childNodes)
      }
    } catch (error) {
      console.error('Could not update close clinic actions:', error)
      showRefreshNotice()
    }
  }

  container.addEventListener('fragment:swapped', () => {
    showRefreshNotice()
    refreshActions()
  })

  // Re-fetch one row and swap it in place
  const refreshRow = (appointmentId) => {
    const row = container.querySelector(
      `tr[data-fragment-id="${appointmentId}"]`
    )
    if (!row) return window.location.reload()
    const completedQuery = row.dataset.showCompleted ? '?_completed=1' : ''
    const url = `/clinics/${clinicId}/close/appointment-row/${appointmentId}${completedQuery}`
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
