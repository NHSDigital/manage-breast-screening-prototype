// app/assets/javascript/reading-scroll.js

// Reading workflow: scroll the status bar into view on page load.
// Uses getBoundingClientRect for an exact pixel position rather than
// scrollIntoView, which can behave oddly near sticky/fixed elements.

document.addEventListener('DOMContentLoaded', () => {
  const statusBar = document.querySelector('.app-status-bar')
  if (!statusBar) return
  const top = statusBar.getBoundingClientRect().top + window.scrollY
  window.scrollTo({ top, behavior: 'instant' })
})
