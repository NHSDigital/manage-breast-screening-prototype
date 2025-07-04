class AppModal {
  constructor(element) {
    this.modal = element
    this.dialog = this.modal.querySelector('.app-modal__dialog')
    this.overlay = this.modal.querySelector('.app-modal__overlay')
    this.previousActiveElement = null
    this.isOpen = false

    this.bindEvents()
  }

  bindEvents() {
    // Close on overlay click
    if (this.overlay) {
      this.overlay.addEventListener('click', () => this.close())
    }

    // Close on escape key
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.isOpen) {
        this.close()
      }
    })

    // Handle action buttons
    this.modal.addEventListener('click', (e) => {
      const action = e.target.getAttribute('data-modal-action')
      if (action) {
        this.handleAction(action, e)
      }
    })
  }

  open() {
    this.previousActiveElement = document.activeElement
    this.modal.hidden = false
    this.modal.classList.add('app-modal--open')
    document.body.classList.add('app-modal-open')

    // Focus the dialog
    this.dialog.focus()
    this.isOpen = true

    // Trap focus within modal
    this.trapFocus()
  }

  close() {
    this.modal.hidden = true
    this.modal.classList.remove('app-modal--open')
    document.body.classList.remove('app-modal-open')

    // Restore focus
    if (this.previousActiveElement) {
      this.previousActiveElement.focus()
    }

    this.isOpen = false
  }

  handleAction(action, event) {
    // Override this method or listen for custom events
    const customEvent = new CustomEvent('modal:action', {
      detail: { action, originalEvent: event }
    })

    this.modal.dispatchEvent(customEvent)

    // Default behaviour for cancel
    if (action === 'cancel') {
      event.preventDefault()
      this.close()
    }
  }

  trapFocus() {
    // Basic focus trapping - can be enhanced
    const focusableElements = this.dialog.querySelectorAll(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    )

    if (focusableElements.length === 0) return

    const firstElement = focusableElements[0]
    const lastElement = focusableElements[focusableElements.length - 1]

    this.dialog.addEventListener('keydown', (e) => {
      if (e.key === 'Tab') {
        if (e.shiftKey) {
          if (document.activeElement === firstElement) {
            e.preventDefault()
            lastElement.focus()
          }
        } else {
          if (document.activeElement === lastElement) {
            e.preventDefault()
            firstElement.focus()
          }
        }
      }
    })
  }
}

// Initialize modals
document.addEventListener('DOMContentLoaded', () => {
  const modals = document.querySelectorAll('.app-modal')
  modals.forEach(modal => {
    modal.appModal = new AppModal(modal)
  })
})

// Global function to open modal by ID
window.openModal = function(modalId) {
  const modal = document.getElementById(modalId)
  if (modal && modal.appModal) {
    modal.appModal.open()
  }
}

// Global function to close modal by ID
window.closeModal = function(modalId) {
  const modal = document.getElementById(modalId)
  if (modal && modal.appModal) {
    modal.appModal.close()
  }
}