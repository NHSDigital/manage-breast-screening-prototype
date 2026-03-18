// app/assets/javascript/image-streaming.js
// Simulates images arriving from the modality/gateway one by one.
// Reads config from a <script type="application/json" id="image-streaming-config"> block.
// Right arrow key (outside inputs) advances to the next image immediately.

const configEl = document.getElementById('image-streaming-config')
if (configEl) {
  let config
  try {
    config = JSON.parse(configEl.textContent)
  } catch (e) {
    console.warn('image-streaming: could not parse config', e)
  }

  if (config && config.enabled && config.images && config.images.length) {
    initStreaming(config)
  }
}

function initStreaming (config) {
  const { intervalMs = 3000, images = [], totalImages = images.length } = config

  // Find all view slots rendered by mammogram-image-display.njk
  const slots = document.querySelectorAll('[data-view]')
  if (!slots.length) return

  // Build a map of view code → { el, revealedCount }
  const slotMap = {}
  slots.forEach(slot => {
    const view = slot.dataset.view
    if (view) {
      slotMap[view] = { el: slot, revealedCount: 0 }
    }
  })

  // Set all slots to awaiting state before any images arrive
  slots.forEach(slot => setSlotAwaiting(slot))

  // Counter element in the inset text
  const countEl = document.getElementById('streaming-received-count')

  let nextIndex = 0
  let timer = null

  const revealNext = (immediate = false) => {
    if (nextIndex >= images.length) return
    const image = images[nextIndex]
    nextIndex++
    revealImage(image, slotMap, immediate)

    // Update received count
    if (countEl) {
      const received = nextIndex
      countEl.textContent = `${received} ${received === 1 ? 'image' : 'images'} received`
    }
  }

  const scheduleNext = () => {
    if (nextIndex >= images.length) return
    timer = setTimeout(() => {
      revealNext()
      scheduleNext()
    }, intervalMs)
  }

  // First image arrives immediately — we navigated to this page because one was received
  revealNext(true)
  scheduleNext()

  // Right arrow key immediately advances to the next image (useful for demos)
  document.addEventListener('keydown', e => {
    if (e.key !== 'ArrowRight') return
    if (e.target.matches('input, textarea, select')) return
    if (timer) {
      clearTimeout(timer)
      timer = null
    }
    revealNext()
    scheduleNext()
  })
}

// Replace a slot's content with a placeholder, collapsing to a single wrapper.
// Uses the existing missing-image markup so styles and sizing are consistent.
function setSlotAwaiting (slot) {
  const wrappers = slot.querySelectorAll('.app-mammogram-thumbnail__image-wrapper')
  if (!wrappers.length) return

  const firstWrapper = wrappers[0]

  // Remove any extra wrappers (multi-image views rendered server-side)
  for (let wrapperIndex = 1; wrapperIndex < wrappers.length; wrapperIndex++) {
    wrappers[wrapperIndex].remove()
  }

  // Capture label text before replacing inner content
  const labelEl = firstWrapper.querySelector('.app-mammogram-thumbnail__label')
  const labelText = labelEl ? labelEl.textContent.trim() : (slot.dataset.view || '')

  // Set an explicit width so the wrapper doesn't collapse when there's no image content.
  // (width: 100% on the wrapper resolves to 0 when the flex parent has no intrinsic width)
  const isLarge = firstWrapper.classList.contains('app-mammogram-thumbnail__image-wrapper--large')
  firstWrapper.style.width = isLarge ? '200px' : '120px'

  // Show a spinner on every placeholder from the start — images may load too fast
  // for a spinner added only at reveal time to be visible
  firstWrapper.innerHTML =
    `<span class="app-mammogram-thumbnail__label">${labelText}</span>` +
    `<div class="app-mammogram-thumbnail__missing">` +
    `<span class="app-mammogram-thumbnail__missing-text">No image</span>` +
    `</div>`
}

// Reveal an image in the appropriate slot.
// immediate=true skips the spinner delay (used for the first image, already received).
function revealImage (imageData, slotMap, immediate = false) {
  const slotInfo = slotMap[imageData.view]
  if (!slotInfo) return

  const { el: slot } = slotInfo

  if (slotInfo.revealedCount === 0) {
    // First image for this view — replace placeholder content in the existing wrapper
    const wrapper = slot.querySelector('.app-mammogram-thumbnail__image-wrapper')
    if (!wrapper) return

    // Re-read the label before wiping innerHTML
    const labelEl = wrapper.querySelector('.app-mammogram-thumbnail__label')
    const labelText = labelEl ? labelEl.textContent.trim() : imageData.view

    // Show a spinner briefly, then replace with the image.
    // Skip the spinner for the first image (already received when we arrived on this page).
    const showImage = () => {
      wrapper.innerHTML = `<span class="app-mammogram-thumbnail__label">${labelText}</span>`
      // Reset the explicit width we set in setSlotAwaiting
      wrapper.style.width = ''

      const img = document.createElement('img')
      img.className = 'app-mammogram-thumbnail__image app-mammogram-thumbnail__image--diagram'
      img.src = imageData.src
      img.alt = `${imageData.view} view`
      wrapper.appendChild(img)
    }

    if (immediate) {
      showImage()
    } else {
      wrapper.innerHTML =
        `<span class="app-mammogram-thumbnail__label">${labelText}</span>` +
        `<div class="app-mammogram-thumbnail__missing">` +
        `<div class="app-mammogram-thumbnail__spinner"></div>` +
        `</div>`
      setTimeout(showImage, 500)
    }
  } else {
    // Additional image for this view (repeat or extra) — append a new wrapper
    const existingWrapper = slot.querySelector('.app-mammogram-thumbnail__image-wrapper')
    const isLarge = existingWrapper && existingWrapper.classList.contains('app-mammogram-thumbnail__image-wrapper--large')

    const newWrapper = document.createElement('div')
    newWrapper.className = 'app-mammogram-thumbnail__image-wrapper' +
      (isLarge ? ' app-mammogram-thumbnail__image-wrapper--large' : '')

    const label = document.createElement('span')
    label.className = 'app-mammogram-thumbnail__label'
    label.textContent = slot.dataset.view

    const img = document.createElement('img')
    img.className = 'app-mammogram-thumbnail__image app-mammogram-thumbnail__image--diagram'
    img.src = imageData.src
    img.alt = `${imageData.view} view`

    newWrapper.appendChild(label)
    newWrapper.appendChild(img)
    slot.appendChild(newWrapper)
  }

  slotInfo.revealedCount++
}
