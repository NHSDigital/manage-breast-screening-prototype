// app/assets/javascript/workflow-scroll.js

// Scroll the status bar into view on page load for any workflow.
// Uses getBoundingClientRect for an exact pixel position rather than
// scrollIntoView, which can behave oddly near sticky/fixed elements.

document.addEventListener('DOMContentLoaded', () => {
  const statusBar = document.querySelector('.app-status-bar')
  if (!statusBar) return
  const top = statusBar.getBoundingClientRect().top + window.scrollY
  window.scrollTo({ top, behavior: 'instant' })
})
