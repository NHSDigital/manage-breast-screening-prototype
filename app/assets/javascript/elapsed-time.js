// app/assets/javascript/elapsed-time.js
//
// Ticks the "N mins ago" figures on the clinic appointment list up in real
// time: how long a participant has been waiting, and how long ago screening
// started. The server renders a minute-granular initial value and a
// data-elapsed-since timestamp anchored to now minus that value, so the figure
// is correct without JavaScript. Re-read the DOM each tick so rows swapped in
// by live filtering or check-in are picked up.

const label = (value, unit) => `${value} ${unit}${value === 1 ? '' : 's'}`

const formatElapsedTime = (totalMinutes) => {
  if (typeof totalMinutes !== 'number' || isNaN(totalMinutes)) return ''

  return label(totalMinutes, 'min')
}

const update = () => {
  document.querySelectorAll('.js-elapsed-time').forEach((element) => {
    const since = element.dataset.elapsedSince
    if (!since) return

    const minutes = Math.max(
      0,
      Math.floor((Date.now() - Date.parse(since)) / 60000)
    )
    element.textContent = `${formatElapsedTime(minutes)} ago`
  })
}

document.addEventListener('DOMContentLoaded', () => {
  update()
  window.setInterval(update, 60000)
})
