// app/assets/javascript/waiting-time.js
//
// Ticks the "(N mins M secs ago)" waiting time on the clinic appointment list
// up in real time. The server renders a minute-granular initial value and a
// data-waiting-since timestamp anchored to now minus that value, so the figure
// is correct without JavaScript - this adds live seconds and keeps it current
// while the page stays open, re-reading the DOM each tick so rows swapped in by
// live filtering or check-in are picked up.

const label = (value, unit) => `${value} ${unit}${value === 1 ? '' : 's'}`

const formatWaitingTime = (totalSeconds) => {
  if (typeof totalSeconds !== 'number' || isNaN(totalSeconds)) return ''

  // Always minutes and seconds, never hours
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60

  if (minutes > 0) return `${label(minutes, 'min')} ${label(seconds, 'sec')}`
  return label(seconds, 'sec')
}

const update = () => {
  document.querySelectorAll('.js-waiting-time').forEach((element) => {
    const since = element.dataset.waitingSince
    if (!since) return

    const seconds = Math.max(
      0,
      Math.floor((Date.now() - Date.parse(since)) / 1000)
    )
    element.textContent = `${formatWaitingTime(seconds)} ago`
  })
}

document.addEventListener('DOMContentLoaded', () => {
  update()
  window.setInterval(update, 1000)
})
