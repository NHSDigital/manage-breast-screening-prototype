// app/assets/javascript/started-time.js
//
// Ticks the "N mins ago" started time on the clinic In progress appointment
// list up in real time. The server renders a minute-granular initial value and
// a data-started-since timestamp anchored to now minus that value, so the
// figure is correct without JavaScript. Re-read the DOM each tick so rows
// swapped in by live filtering are picked up.

const update = () => {
  document.querySelectorAll('.js-started-time').forEach((element) => {
    const since = element.dataset.startedSince
    if (!since) return

    const minutes = Math.max(
      0,
      Math.floor((Date.now() - Date.parse(since)) / 60000)
    )
    element.textContent = `${minutes} mins ago`
  })
}

document.addEventListener('DOMContentLoaded', () => {
  update()
  window.setInterval(update, 60000)
})

