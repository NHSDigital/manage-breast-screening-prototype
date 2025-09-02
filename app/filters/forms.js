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

module.exports = {
  populateErrors
}
