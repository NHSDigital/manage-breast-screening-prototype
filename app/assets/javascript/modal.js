class AppModal {
  constructor(element) {
    this.modal = element
    this.dialog = this.modal.querySelector('.app-modal__dialog')
    this.overlay = this.modal.querySelector('.app-modal__overlay')
    this.previousActiveElement = null
    this.scrollPosition = 0
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

    // Handle action buttons and links
    this.modal.addEventListener('click', (e) => {
      // Find the element with data-modal-action (might be the target or a parent)
      let actionElement = e.target
      let action = actionElement.getAttribute('data-modal-action')

      // If target doesn't have action, check if it's inside an element that does
      if (!action && actionElement.closest('[data-modal-action]')) {
        actionElement = actionElement.closest('[data-modal-action]')
        action = actionElement.getAttribute('data-modal-action')
      }

      if (action) {
        console.log('Modal action triggered:', action, actionElement) // Debug log
        this.handleAction(action, e, actionElement)
      }
    })
  }

  open() {
    console.log('Opening modal:', this.modal.id) // Debug log

    // Store current scroll position
    this.scrollPosition =
      window.pageYOffset || document.documentElement.scrollTop

    this.previousActiveElement = document.activeElement
    this.modal.hidden = false
    this.modal.classList.add('app-modal--open')

    // Prevent body scrolling and maintain scroll position
    document.body.classList.add('app-modal-open')
    document.body.style.top = `-${this.scrollPosition}px`
    document.body.style.position = 'fixed'
    document.body.style.width = '100%'

    // Focus the dialog
    this.dialog.focus()
    this.isOpen = true

    // Trap focus within modal
    this.trapFocus()
  }

  close() {
    console.log('Closing modal:', this.modal.id) // Debug log

    this.modal.hidden = true
    this.modal.classList.remove('app-modal--open')

    // Restore body scrolling and scroll position
    document.body.classList.remove('app-modal-open')
    document.body.style.position = ''
    document.body.style.top = ''
    document.body.style.width = ''

    // Restore scroll position
    window.scrollTo(0, this.scrollPosition)

    // Restore focus
    if (this.previousActiveElement) {
      this.previousActiveElement.focus()
    }

    this.isOpen = false
  }

  handleAction(action, event, actionElement) {
    console.log('Handling action:', action) // Debug log

    switch (action) {
      case 'close':
        event.preventDefault()
        this.close()
        break

      case 'navigate':
        // Let default behavior happen for links
        if (actionElement.tagName === 'A') {
          // Handle POST navigation if needed
          const method = actionElement.getAttribute('data-method')
          if (method && method.toUpperCase() === 'POST') {
            event.preventDefault()
            this.submitForm(actionElement.href, 'POST')
          }
        }
        break

      case 'ajax':
        event.preventDefault()
        this.handleAjax(actionElement)
        break

      default:
        // Fire custom event for other action types
        const customEvent = new CustomEvent('modal:action', {
          detail: {
            action,
            target: actionElement,
            originalEvent: event,
            modal: this
          }
        })
        this.modal.dispatchEvent(customEvent)
    }
  }

  handleAjax(target) {
    const href = target.getAttribute('data-href')
    const method = target.getAttribute('data-method') || 'GET'
    const closeOnSuccess =
      target.getAttribute('data-close-on-success') === 'true'

    if (!href) return

    // Show loading state
    this.setButtonLoading(target, true)

    // Collect any data from modal data attributes
    const modalData = this.getModalData()

    // Make AJAX request
    fetch(href, {
      method: method,
      headers: {
        'Content-Type': 'application/json',
        'X-Requested-With': 'XMLHttpRequest'
      },
      body: method !== 'GET' ? JSON.stringify(modalData) : null
    })
      .then((response) => {
        if (response.ok) {
          if (closeOnSuccess) {
            this.close()
          }
          // Fire success event
          const successEvent = new CustomEvent('modal:ajax:success', {
            detail: { response, target, modal: this }
          })
          this.modal.dispatchEvent(successEvent)
        } else {
          throw new Error('Request failed')
        }
      })
      .catch((error) => {
        // Fire error event
        const errorEvent = new CustomEvent('modal:ajax:error', {
          detail: { error, target, modal: this }
        })
        this.modal.dispatchEvent(errorEvent)
      })
      .finally(() => {
        this.setButtonLoading(target, false)
      })
  }

  setButtonLoading(button, isLoading) {
    if (isLoading) {
      button.disabled = true
      button.textContent = button.textContent + ' ...'
    } else {
      button.disabled = false
      button.textContent = button.textContent.replace(' ...', '')
    }
  }

  getModalData() {
    const data = {}
    const attributes = this.modal.dataset

    // Copy all data attributes
    Object.keys(attributes).forEach((key) => {
      data[key] = attributes[key]
    })

    return data
  }

  submitForm(url, method) {
    const form = document.createElement('form')
    form.method = method
    form.action = url
    document.body.appendChild(form)
    form.submit()
  }

  trapFocus() {
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
  console.log('Initializing modals...') // Debug log
  const modals = document.querySelectorAll('.app-modal')
  console.log('Found modals:', modals.length) // Debug log
  modals.forEach((modal) => {
    modal.appModal = new AppModal(modal)
  })
})

// Global functions
window.openModal = function (modalId) {
  console.log('Opening modal via global function:', modalId) // Debug log
  const modal = document.getElementById(modalId)
  if (modal && modal.appModal) {
    modal.appModal.open()
  } else {
    console.error('Modal not found or not initialized:', modalId)
  }
}

window.closeModal = function (modalId) {
  const modal = document.getElementById(modalId)
  if (modal && modal.appModal) {
    modal.appModal.close()
  }
}
