// app/assets/javascript/scroll-to-section.js

// Generic scroll-to handling for all pages
document.addEventListener('DOMContentLoaded', function () {
  const urlParams = new URLSearchParams(window.location.search)
  const scrollTo = urlParams.get('scrollTo')

  if (scrollTo) {
    const targetSection = document.getElementById(scrollTo)
    if (targetSection) {
      // Open the section if it's a details element
      if (targetSection.tagName === 'DETAILS') {
        targetSection.setAttribute('open', 'open')
      }

      // Scroll to the section
      setTimeout(() => {
        targetSection.scrollIntoView({ behavior: 'smooth', block: 'start' })
      }, 100)

      // Clean up the URL (remove scrollTo parameter)
      const url = new URL(window.location)
      url.searchParams.delete('scrollTo')
      window.history.replaceState({}, '', url.pathname + url.search + url.hash)
    }
  }
})
