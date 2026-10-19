// app/assets/javascript/waiting-time.js
//
// Ticks the "(N mins ago)" waiting time on the clinic appointment list up in
// real time. The server renders a minute-granular initial value and a
// data-waiting-since timestamp anchored to now minus that value, so the figure
// is correct without JavaScript. Re-read the DOM each tick so rows swapped in
// by live filtering or check-in are picked up.

const label = (value, unit) => `${value} ${unit}${value === 1 ? '' : 's'}`

const formatWaitingTime = (totalMinutes) => {
  if (typeof totalMinutes !== 'number' || isNaN(totalMinutes)) return ''

  return label(totalMinutes, 'min')
}

const update = () => {
  document.querySelectorAll('.js-waiting-time').forEach((element) => {
    const since = element.dataset.waitingSince
    if (!since) return

    const minutes = Math.max(
      0,
      Math.floor((Date.now() - Date.parse(since)) / 60000)
    )
    element.textContent = `${formatWaitingTime(minutes)} ago`
  })
}

document.addEventListener('DOMContentLoaded', () => {
  update()
  window.setInterval(update, 60000)
})
