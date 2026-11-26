// app/assets/javascript/close-clinic.js
//
// Close clinic page - enhancements on top of fragment-actions.js, which
// handles the status links in each row (marked data-fragment-action). This
// file reveals the refresh notice when counts go stale, refreshes the outcome
// message and actions, and refreshes a row after its details modal saves.

import { refreshFragment } from './lib/fragments.js'
import { refreshRegionsFromPage } from './lib/regions.js'

document.addEventListener('DOMContentLoaded', () => {
  const container = document.getElementById('js-close-clinic-content')
  if (!container) return

  const clinicId = container.dataset.clinicId

  const actions = document.getElementById('close-clinic-actions')
  const status = document.getElementById('close-clinic-status')
  const refreshError = document.getElementById('close-clinic-refresh-error')
  const stickyFooter = document.querySelector(
    '.app-clinic-layout__sticky-footer'
  )
  const stickyEnd = document.querySelector('.app-clinic-layout__sticky-end')

  // The marker is at the footer's natural position, not its sticky position.
  const updateStickyFooter = () => {
    stickyFooter.classList.toggle(
      'app-clinic-layout__sticky-footer--in-flow',
      stickyFooter.getBoundingClientRect().height > window.innerHeight / 2
    )
    stickyFooter.classList.toggle(
      'app-clinic-layout__sticky-footer--stuck',
      getComputedStyle(stickyFooter).position === 'sticky' &&
        stickyEnd.getBoundingClientRect().top >= window.innerHeight
    )
  }
  window.addEventListener('scroll', updateStickyFooter, { passive: true })
  window.addEventListener('resize', updateStickyFooter)
  const stickyResizeObserver = new ResizeObserver(updateStickyFooter)
  stickyResizeObserver.observe(stickyFooter)
  stickyResizeObserver.observe(container)
  updateStickyFooter()

  // Counts in the table card headings aren't updated in place
  const showRefreshNotice = () => {
    const notice = container.querySelector('.js-refresh-notice')
    if (notice) notice.hidden = false
  }

  const announceOutcome = () => {
    status.textContent =
      actions.querySelector('#close-clinic-outstanding')?.textContent.trim() ||
      'All appointments have a completed status. You can now close the clinic.'
  }
  actions.addEventListener('fragment:swapped', announceOutcome)

  // A status change can change the outstanding count and renumber the other
  // completed appointments, so refresh those from the server
  const refreshActions = async () => {
    const button = actions.querySelector('button')
    if (button) button.disabled = true
    const completedCells = [
      ...container.querySelectorAll(
        'td.app-clinic-appointments-table__completed-column'
      )
    ]

    try {
      const refreshed = await refreshRegionsFromPage(
        [actions, ...completedCells],
        { optional: completedCells }
      )
      if (refreshed.some(({ region }) => region === actions)) {
        refreshError.hidden = true
        announceOutcome()
      }
    } catch (error) {
      console.error('Could not update close clinic actions:', error)
      refreshError.hidden = false
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
    const query = row.dataset.showCompleted ? '?_showCompleted=1' : ''
    const url = `/clinics/${clinicId}/close/appointment-row/${appointmentId}${query}`
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
