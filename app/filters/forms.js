// app/filters/forms.js

/**
 * Add error messages to form components based on flash messages
 *
 * @param {object} component - The form component configuration object
 * @returns {object} Updated component configuration with error details if applicable
 */
const populateErrors = function (component) {
  // Get flash messages from template context
  const flash = this.ctx.flash || {}
  // console.log({flash})
  const errors = flash.error || []

  // console.log({errors})

  // Find error matching this component's name
  const error = Array.isArray(errors)
    ? errors.find((err) => err.name === component.name)
    : errors.name === component.name
      ? errors
      : null

  if (!error) return component

  // Add error configuration to component
  return {
    ...component,
    errorMessage: {
      text: error.text,
      href: error.href
    }
  }
}

/**
 * Transform a button, summary list action item, or full summary list component
 * to open links in a modal when modal forms are enabled, otherwise return unchanged.
 *
 * Accepts three shapes:
 * - Button config object (has `href`) — rewires for modal
 * - Action item config object (has `href`) — rewires for modal
 * - Summary list config object (has `rows`) — rewires all action item hrefs in all rows
 *
 * In most cases the existing `href` is used as the modal loadUrl. Pass a second
 * `loadUrl` argument when they differ — for example when the standard-mode href
 * includes a referrer chain that the modal fragment doesn't need.
 *
 * @param {object} component - Button, action item, or summary list config
 * @param {string} modalId - The id of the modal to open
 * @param {string} [loadUrl] - Override URL for the modal loadUrl (defaults to href, ignored for summary lists)
 * @returns {object} Updated config wired for modal, or the original if modal mode is off
 * @example
 * {{ button({ text: "Add", href: addUrl } | openInModal(modalId)) }}
 * {% set item = { href: linkedUrl, text: "Change" } | openInModal("my-modal", bareUrl) %}
 * {{ summaryList(params | openInModal("my-modal")) }}
 */
const openInModal = function (component, modalId, loadUrl) {
  const isModalEnabled = this.ctx?.data?.settings?.modalForms === 'true'

  if (!isModalEnabled) return component

  const id = modalId || 'app-form-modal'

  // Add data attributes for modal behaviour while keeping the real href intact.
  // This is progressively enhanced — without JS the link navigates normally;
  // with JS a global delegated listener (in modal.js) intercepts [data-load-modal-url]
  // clicks and opens the modal instead.
  const rewireItem = (item, overrideUrl) => {
    if (!item || !item.href) return item
    const url = overrideUrl || item.href
    return {
      ...item,
      attributes: {
        ...(item.attributes || {}),
        'data-load-modal-url': url,
        'data-modal-id': id
      }
    }
  }

  // Summary list — rewire all action items across all rows
  if (component.rows && Array.isArray(component.rows)) {
    return {
      ...component,
      rows: component.rows.map((row) => {
        if (!row?.actions?.items) return row
        return {
          ...row,
          actions: {
            ...row.actions,
            items: row.actions.items.map((item) => rewireItem(item))
          }
        }
      })
    }
  }

  // Single summary list row (has actions.items but no top-level href)
  if (component.actions?.items && Array.isArray(component.actions.items)) {
    return {
      ...component,
      actions: {
        ...component.actions,
        items: component.actions.items.map((item) => rewireItem(item))
      }
    }
  }

  // Single button or action item
  return rewireItem(component, loadUrl)
}

/**
 * Get a flash error object for a specific field name from the template context.
 * Useful for components like dateInput that use namePrefix rather than name.
 *
 * @param {string} name - The field name to look up
 * @returns {object|null} The matching error object or null if not found
 */
const getFlashError = function (name) {
  const flash = this.ctx.flash || {}
  const errors = flash.error || []
  if (Array.isArray(errors)) {
    return errors.find((err) => err.name === name) || null
  }
  return errors.name === name ? errors : null
}

module.exports = {
  populateErrors,
  getFlashError,
  openInModal
}
