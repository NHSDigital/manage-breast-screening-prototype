import { initAll } from '/nhsuk-frontend/nhsuk-frontend.min.js'

class AppModal {
  constructor(element) {
    this.modal = element
    this.dialog = this.modal.querySelector('.app-modal__dialog')
    this.overlay = this.modal.querySelector('.app-modal__overlay')
    this.previousActiveElement = null
    this.scrollPosition = 0
    this.isOpen = false
    this._onSuccessCallback = null

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

    // Handle action buttons and links inside the modal
    this.modal.addEventListener('click', (e) => {
      let actionElement = e.target
      let action = actionElement.getAttribute('data-modal-action')

      if (!action && actionElement.closest('[data-modal-action]')) {
        actionElement = actionElement.closest('[data-modal-action]')
        action = actionElement.getAttribute('data-modal-action')
      }

      if (action) {
        this.handleAction(action, e, actionElement)
      }
    })

    // Trap focus within dialog — bound once, focusable elements queried dynamically
    this.dialog.addEventListener('keydown', (e) => {
      if (!this.isOpen || e.key !== 'Tab') return

      const focusableElements = this.dialog.querySelectorAll(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      )
      if (focusableElements.length === 0) return

      const firstElement = focusableElements[0]
      const lastElement = focusableElements[focusableElements.length - 1]

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
    })
  }

  // Open the modal. Pass { loadUrl } to fetch and inject content, or leave empty
  // for static content already in the DOM. Pass { onSuccess } to override the
  // default page reload that happens after a successful form submission.
  open(options = {}) {
    const { loadUrl, onSuccess } = options
    this._onSuccessCallback = onSuccess || null

    this.scrollPosition =
      window.pageYOffset || document.documentElement.scrollTop
    this.previousActiveElement = document.activeElement

    // When loading remote content, keep the modal hidden until content is ready
    // to avoid a flash of the empty dialog shell (overlay + close button only).
    // The loadContent method calls show() once content arrives, or after 300ms
    // on slow connections so there's always visible feedback.
    if (!loadUrl) {
      this.show()
      this.dialog.focus()
    } else {
      // Lock body scroll immediately so the page doesn't shift while loading,
      // but keep the modal visually hidden until content is injected.
      document.body.classList.add('app-modal-open')
      document.body.style.top = `-${this.scrollPosition}px`
      document.body.style.position = 'fixed'
      document.body.style.width = '100%'
      this.isOpen = true
      this.dialog.setAttribute('tabindex', '-1')
      this.loadContent(loadUrl)
    }
  }

  // Make the modal visually visible. Called immediately for static modals,
  // or deferred until content is loaded for remote (loadUrl) modals.
  show() {
    this.modal.hidden = false
    this.modal.classList.add('app-modal--open')
    if (!document.body.classList.contains('app-modal-open')) {
      document.body.classList.add('app-modal-open')
      document.body.style.top = `-${this.scrollPosition}px`
      document.body.style.position = 'fixed'
      document.body.style.width = '100%'
    }
    this.isOpen = true
  }

  close() {
    this.modal.hidden = true
    this.modal.classList.remove('app-modal--open')

    document.body.classList.remove('app-modal-open')
    document.body.style.position = ''
    document.body.style.top = ''
    document.body.style.width = ''

    window.scrollTo(0, this.scrollPosition)

    if (this.previousActiveElement) {
      this.previousActiveElement.focus()
    }

    this.isOpen = false
    this._onSuccessCallback = null
  }

  // Fetch a URL as an HTML fragment and inject it into the modal content area.
  // After injection, any form container inside the dialog is wired up for AJAX submission.
  loadContent(url) {
    // Store the absolute URL so relative form actions in fragments can be resolved correctly.
    // Fragments use './save' style actions — these must be resolved against the fragment's URL,
    // not the current page URL, otherwise they'd POST to the wrong endpoint.
    this._loadUrl = new URL(url, window.location.href).href
    // Clear stale content immediately so previous answers are never visible
    // while the new content is loading.
    const contentArea = this.dialog.querySelector('.app-modal__content')
    if (contentArea) contentArea.innerHTML = ''

    // Only show a loading indicator if the request takes longer than 300ms,
    // avoiding a flicker on fast connections.
    const loadingTimer = setTimeout(() => {
      this.setContent('<p aria-live="polite">Loading…</p>')
      this.show()
      this.dialog.focus()
    }, 300)

    fetch(url, {
      headers: { 'X-Requested-With': 'XMLHttpRequest' }
    })
      .then((response) => {
        if (!response.ok) throw new Error('Failed to load content')
        // Use the final URL after any server-side redirects (e.g. edit → details)
        // so that relative form actions like './save' resolve to the right endpoint.
        this._loadUrl = response.url
        return response.text()
      })
      .then((html) => {
        clearTimeout(loadingTimer)
        this.setContent(html)
        this.bindFormSubmit()
        this.bindLinkNavigation()
        this.show()
        // Re-run now that the modal is visible — offsetHeight is 0 while hidden,
        // so the call inside setContent() is a no-op on fast connections.
        this.trimBottomSpacing()
      })
      .catch((error) => {
        clearTimeout(loadingTimer)
        console.error('Modal: failed to load content', error)
        this.setContent(
          '<p>Sorry, there was a problem loading this content.</p>'
        )
        this.show()
      })
  }

  // Replace the content area of the dialog
  setContent(html) {
    const content = this.dialog.querySelector('.app-modal__content')
    if (content) {
      content.innerHTML = html
    } else {
      this.dialog.innerHTML = html
    }

    // Rewrite relative hrefs using the fragment's original URL as the base.
    // Injected content is parsed relative to the current page URL by the browser,
    // so './delete/abc' on a review page would resolve to the wrong path.
    // This fixes links like the 'Delete this symptom' anchor in details.html.
    if (this._loadUrl) {
      const base = new URL(this._loadUrl)
      const container = content || this.dialog
      container.querySelectorAll('a[href]').forEach((link) => {
        const href = link.getAttribute('href')
        // Only rewrite relative URLs (not absolute, hash-only, or already data: etc.)
        if (
          href &&
          !href.startsWith('http') &&
          !href.startsWith('#') &&
          !href.startsWith('/')
        ) {
          link.setAttribute(
            'href',
            new URL(href, base).pathname +
              (new URL(href, base).search || '') +
              (new URL(href, base).hash || '')
          )
        }
      })
    }

    // Bump all headings down one level so page-level h1s become modal h2s etc.
    // Also swap NHS heading size classes and add app-modal__title to promoted h1s.
    try {
      const headingTags = { H1: 'h2', H2: 'h3', H3: 'h4', H4: 'h5', H5: 'h6' }
      const headingSizes = {
        'nhsuk-heading-xl': 'nhsuk-heading-l',
        'nhsuk-heading-l': 'nhsuk-heading-m',
        'nhsuk-heading-m': 'nhsuk-heading-s'
      }
      const container = content || this.dialog
      // Reverse so nested headings aren't double-bumped
      Array.from(container.querySelectorAll('h1, h2, h3, h4, h5'))
        .reverse()
        .forEach((heading) => {
          const newTag = headingTags[heading.tagName]
          if (!newTag) return
          const newHeading = document.createElement(newTag)
          Array.from(heading.attributes).forEach((attr) => {
            try {
              newHeading.setAttribute(attr.name, attr.value)
            } catch (e) {
              // Some attributes (e.g. certain ARIA attrs) may not be settable — skip them
            }
          })
          for (const [from, to] of Object.entries(headingSizes)) {
            if (newHeading.classList.contains(from)) {
              newHeading.classList.replace(from, to)
              break
            }
          }
          // Mark promoted h1s as modal titles (removes top margin)
          if (heading.tagName === 'H1')
            newHeading.classList.add('app-modal__title')
          newHeading.innerHTML = heading.innerHTML
          heading.replaceWith(newHeading)
        })

      // Bump legend sizes (fieldset question headers)
      const legendSizes = {
        'nhsuk-fieldset__legend--xl': 'nhsuk-fieldset__legend--l',
        'nhsuk-fieldset__legend--l': 'nhsuk-fieldset__legend--m',
        'nhsuk-fieldset__legend--m': 'nhsuk-fieldset__legend--s'
      }
      container.querySelectorAll('legend').forEach((legend) => {
        for (const [from, to] of Object.entries(legendSizes)) {
          if (legend.classList.contains(from)) {
            legend.classList.replace(from, to)
            break
          }
        }
      })

      // Bump label sizes
      const labelSizes = {
        'nhsuk-label--xl': 'nhsuk-label--l',
        'nhsuk-label--l': 'nhsuk-label--m',
        'nhsuk-label--m': 'nhsuk-label--s'
      }
      container.querySelectorAll('label').forEach((label) => {
        for (const [from, to] of Object.entries(labelSizes)) {
          if (label.classList.contains(from)) {
            label.classList.replace(from, to)
            break
          }
        }
      })

      // Bump caption sizes
      const captionSizes = {
        'nhsuk-caption-xl': 'nhsuk-caption-l',
        'nhsuk-caption-l': 'nhsuk-caption-m'
        // 'nhsuk-caption-m': 'nhsuk-caption-s' // no such thing as caption-s
      }
      container
        .querySelectorAll(
          '.nhsuk-caption-xl, .nhsuk-caption-l, .nhsuk-caption-m'
        )
        .forEach((el) => {
          for (const [from, to] of Object.entries(captionSizes)) {
            if (el.classList.contains(from)) {
              el.classList.replace(from, to)
              break
            }
          }
        })

      // Bump non-heading elements carrying NHS heading size classes (e.g. <p class="nhsuk-heading-l">)
      container
        .querySelectorAll(
          '.nhsuk-heading-xl, .nhsuk-heading-l, .nhsuk-heading-m'
        )
        .forEach((el) => {
          if (/^H[1-6]$/.test(el.tagName)) return // already handled by tag replacement above
          for (const [from, to] of Object.entries(headingSizes)) {
            if (el.classList.contains(from)) {
              el.classList.replace(from, to)
              break
            }
          }
        })
    } catch (e) {
      console.warn('Modal: heading bump failed', e)
    }

    // Keep aria-labelledby pointing at the first heading in injected content
    const heading = this.dialog.querySelector('h1, h2, h3')
    if (heading) {
      if (!heading.id) heading.id = this.modal.id + '-content-title'
      this.dialog.setAttribute('aria-labelledby', heading.id)
    }

    // Focus the error summary container itself (not a child link).
    // Mirrors NHS Frontend's setFocus pattern: add tabindex="-1" temporarily,
    // focus it, then remove tabindex on blur so it's no longer a focus target.
    const errorSummary = this.dialog.querySelector('.nhsuk-error-summary')
    if (errorSummary) {
      errorSummary.setAttribute('tabindex', '-1')
      errorSummary.addEventListener(
        'blur',
        () => {
          errorSummary.removeAttribute('tabindex')
        },
        { once: true }
      )
      errorSummary.focus()
    } else {
      // Once content is loaded, remove tabindex from the dialog so that clicks
      // on non-interactive areas don't pull focus back to the dialog container.
      // The dialog only needs tabindex="-1" to receive programmatic focus on open.
      this.dialog.addEventListener(
        'blur',
        () => {
          this.dialog.removeAttribute('tabindex')
        },
        { once: true }
      )
      this.dialog.focus()
    }

    // Re-initialise NHS Frontend components (radios, checkboxes etc.) for the
    // newly injected content — initAll scoped to the dialog only.
    initAll({ scope: this.dialog })

    // Trim trailing margin so only the modal's own padding provides bottom spacing.
    this.trimBottomSpacing()
  }

  // Walk the last-visible-child chain and zero margins at each level, so that
  // whatever ends up at the bottom of the content doesn't double up with the
  // modal's own padding. If a button is at the bottom, add 4px back for its
  // drop shadow ($nhsuk-button-shadow-size) which extends beyond the element.
  trimBottomSpacing() {
    const contentEl = this.dialog.querySelector('.app-modal__content')
    if (!contentEl) return

    // Reset any inline padding-bottom from a previous call
    contentEl.style.paddingBottom = ''

    let hasButton = false
    let el = contentEl

    while (el) {
      const visibleChildren = Array.from(el.children).filter(
        (child) => child.offsetHeight > 0
      )
      if (!visibleChildren.length) break

      const last = visibleChildren[visibleChildren.length - 1]
      last.style.marginBottom = '0'

      if (
        last.matches('.nhsuk-button') ||
        last.querySelector('.nhsuk-button')
      ) {
        hasButton = true
      }

      el = last
    }

    // Add 4px back for the NHS button drop shadow
    if (hasButton) {
      const currentPadding = parseInt(
        getComputedStyle(contentEl).paddingBottom,
        10
      )
      contentEl.style.paddingBottom = `${currentPadding + 4}px`
    }
  }

  // Wire up plain <a> links inside the dialog so they load their target as a
  // modal step rather than navigating the full page. Only intercepts links that
  // are same-origin and don't explicitly opt out via data-modal-link="false".
  // Links that resolve to a _modal_breakout URL are left alone — they will
  // trigger a full-page navigation when clicked (handled by submitForm's
  // breakout logic does not apply here, so we let the browser navigate).
  bindLinkNavigation() {
    const container =
      this.dialog.querySelector('.app-modal__content') || this.dialog
    container.querySelectorAll('a[href]').forEach((link) => {
      // Skip already-bound links, action links (data-modal-action), and opt-outs
      if (
        link._modalBound ||
        link.hasAttribute('data-modal-action') ||
        link.getAttribute('data-modal-link') === 'false'
      )
        return

      const href = link.getAttribute('href')
      // Skip hash-only and external links
      if (!href || href.startsWith('#') || href.startsWith('http')) return

      link._modalBound = true
      link.addEventListener('click', (e) => {
        e.preventDefault()
        const absoluteUrl = new URL(
          link.getAttribute('href'),
          window.location.href
        ).href
        if (absoluteUrl.includes('_modal_breakout')) {
          window.location.href = absoluteUrl
        } else {
          this.loadContent(absoluteUrl)
          this.bindFormSubmit()
        }
      })
    })
  }

  // Wire up form submission handling inside the dialog.
  // Prefers a [data-form-action] container over a <form> element — necessary when
  // the fragment is injected into a page that already has an outer <form>, because
  // browsers make nested <form> elements invalid: inputs and buttons end up owned
  // by the outer form, so the inner form's submit event never fires and FormData
  // on it is empty. Using a <div data-form-action> sidesteps this entirely.
  bindFormSubmit() {
    const container =
      this.dialog.querySelector('[data-form-action]') ||
      this.dialog.querySelector('form')
    if (!container) return

    // Resolve relative action URLs (e.g. './save') against the fragment's original URL,
    // not the current page URL. Falls back to the current page if no fragment was loaded.
    const rawAction = container.dataset.formAction || container.action
    const baseUrl = this._loadUrl || window.location.href
    const action = new URL(rawAction, baseUrl).href
    const method = (
      container.dataset.formMethod ||
      container.method ||
      'POST'
    ).toUpperCase()

    // Intercept clicks on submit buttons rather than listening for the form's
    // submit event — button clicks are reliable whether or not the form is nested.
    container.querySelectorAll('[type="submit"]').forEach((button) => {
      button.addEventListener('click', (e) => {
        e.preventDefault()
        this.submitForm(container, action, method, button)
      })
    })
  }

  // Submit injected form content via fetch. On 422 re-injects the response HTML
  // so errors are shown inside the modal. On success, closes and reloads.
  submitForm(container, action, method, clickedButton) {
    if (clickedButton) clickedButton.disabled = true

    // Serialize inputs manually — works for both <form> and non-form containers,
    // and avoids the empty-FormData problem with nested forms.
    const body = new URLSearchParams()
    container.querySelectorAll('input, select, textarea').forEach((el) => {
      if (!el.name || el.disabled) return
      if (el.type === 'checkbox' || el.type === 'radio') {
        if (el.checked) body.append(el.name, el.value)
      } else {
        body.append(el.name, el.value)
      }
    })
    // Include the clicked button's name/value (e.g. action: 'save')
    if (clickedButton?.name) {
      body.append(clickedButton.name, clickedButton.value || '')
    }

    // Use redirect: 'follow' so we can read the final URL and response body after
    // any server-side redirects. This allows multi-step flows (e.g. a warning page
    // after saving a recent mammogram) to continue inside the modal rather than
    // silently closing it.
    fetch(action, {
      method,
      body,
      redirect: 'follow',
      headers: { 'X-Requested-With': 'XMLHttpRequest' }
    })
      .then((response) => {
        if (response.status === 422) {
          // Validation failure — re-render the current step inside the modal.
          return response.text().then((html) => {
            this._loadUrl = response.url
            this.setContent(html)
            this.bindFormSubmit()
          })
        }

        if (!response.ok) {
          throw new Error(`Form submission failed: ${response.status}`)
        }

        // The server may have redirected us. Detect the outcome from the response HTML:
        // - data-modal-navigate: server intercepted a breakout redirect and sent a
        //   navigation instruction — navigate the full browser to the destination URL.
        //   The flash was NOT consumed because express-flash is bypassed for these responses.
        // - Response HTML contains a modal form body: another step in the flow —
        //   inject it into the modal and continue.
        // - Otherwise: success — close the modal and reload (or invoke callback).
        const finalUrl = response.url

        return response.text().then((html) => {
          // Check for a breakout navigation instruction first
          const tempDiv = document.createElement('div')
          tempDiv.innerHTML = html
          const navEl = tempDiv.querySelector('[data-modal-navigate]')
          if (navEl) {
            const dest = new URL(
              navEl.dataset.modalNavigate,
              window.location.href
            )
            dest.searchParams.delete('_modal')
            dest.searchParams.delete('_modal_breakout')
            this.close()
            window.location.href = dest.toString()
            return
          }

          if (
            html.includes('app-modal__body') ||
            html.includes('data-form-action')
          ) {
            // Another modal step — update _loadUrl so relative links/actions resolve correctly,
            // then inject and rewire the form and any plain links.
            this._loadUrl = finalUrl
            this.setContent(html)
            this.bindFormSubmit()
            this.bindLinkNavigation()
          } else {
            // Flow complete — close and refresh
            this.close()
            if (this._onSuccessCallback) {
              this._onSuccessCallback()
            } else {
              window.location.reload()
            }
          }
        })
      })
      .catch((error) => {
        console.error('Modal form submission error:', error)
        if (clickedButton) clickedButton.disabled = false
        this.setContent(
          '<p class="nhsuk-body">Sorry, there was a problem submitting the form. Please try again.</p>'
        )
      })
  }

  handleAction(action, event, actionElement) {
    switch (action) {
      case 'close':
        event.preventDefault()
        this.close()
        break

      case 'navigate':
        if (actionElement.tagName === 'A') {
          const method = actionElement.getAttribute('data-method')
          if (method && method.toUpperCase() === 'POST') {
            event.preventDefault()
            this.navigateViaPost(actionElement.href)
          }
        }
        break

      case 'ajax':
        event.preventDefault()
        this.handleAjax(actionElement)
        break

      default:
        // Fire custom event for other action types (e.g. the check-in 'custom' action)
        this.modal.dispatchEvent(
          new CustomEvent('modal:action', {
            detail: {
              action,
              target: actionElement,
              originalEvent: event,
              modal: this
            }
          })
        )
    }
  }

  handleAjax(target) {
    const href = target.getAttribute('data-href')
    const method = target.getAttribute('data-method') || 'GET'
    const closeOnSuccess =
      target.getAttribute('data-close-on-success') === 'true'

    if (!href) return

    this.setButtonLoading(target, true)

    const modalData = this.getModalData()

    fetch(href, {
      method,
      headers: {
        'Content-Type': 'application/json',
        'X-Requested-With': 'XMLHttpRequest'
      },
      body: method !== 'GET' ? JSON.stringify(modalData) : null
    })
      .then((response) => {
        if (response.ok) {
          if (closeOnSuccess) this.close()
          this.modal.dispatchEvent(
            new CustomEvent('modal:ajax:success', {
              detail: { response, target, modal: this }
            })
          )
        } else {
          throw new Error('Request failed')
        }
      })
      .catch((error) => {
        this.modal.dispatchEvent(
          new CustomEvent('modal:ajax:error', {
            detail: { error, target, modal: this }
          })
        )
      })
      .finally(() => {
        this.setButtonLoading(target, false)
      })
  }

  setButtonLoading(button, isLoading) {
    if (isLoading) {
      button.disabled = true
      button.setAttribute('data-original-text', button.textContent)
      button.textContent = button.textContent + ' …'
    } else {
      button.disabled = false
      const originalText = button.getAttribute('data-original-text')
      if (originalText) button.textContent = originalText
    }
  }

  getModalData() {
    const data = {}
    Object.keys(this.modal.dataset).forEach((key) => {
      data[key] = this.modal.dataset[key]
    })
    return data
  }

  // Create and submit a temporary form for POST-based navigation
  navigateViaPost(url) {
    const form = document.createElement('form')
    form.method = 'POST'
    form.action = url
    document.body.appendChild(form)
    form.submit()
  }
}

// Initialize modals on page load
document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('.app-modal').forEach((modal) => {
    modal.appModal = new AppModal(modal)
  })

  // Global delegated click handler for [data-load-modal-url] — used by the
  // openInModal filter to progressively enhance action links and buttons.
  // The real href is preserved for non-JS navigation; this intercepts clicks
  // with JS to open the modal instead.
  // Skips clicks inside .app-modal__dialog — those are handled by bindLinkNavigation.
  document.addEventListener('click', (e) => {
    const link = e.target.closest('[data-load-modal-url]')
    if (!link) return
    if (link.closest('.app-modal__dialog')) return

    e.preventDefault()
    const url = link.dataset.loadModalUrl
    const modalId = link.dataset.modalId || 'app-form-modal'
    window.openModal(modalId, { loadUrl: url })
  })
})

// Global helpers — openModal accepts an optional options object (see AppModal.open)
window.openModal = function (modalId, options = {}) {
  const modal = document.getElementById(modalId)
  if (modal && modal.appModal) {
    modal.appModal.open(options)
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
