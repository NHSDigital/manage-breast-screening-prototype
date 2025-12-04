// app/assets/javascript/breast-features.js

// Breast features diagram interaction
// Configurable via window.breastFeaturesConfig

function initializeBreastFeatures() {
  // Get configuration or use defaults
  const config = window.breastFeaturesConfig || {}
  const readOnly = config.readOnly || false
  const hiddenFieldName =
    config.hiddenFieldName || 'event[medicalInformation][breastFeaturesRaw]'
  const hiddenFieldId = config.hiddenFieldId || 'breastFeaturesRaw'
  const existingFeatures = config.existingFeatures || []
  const featureTypes = config.featureTypes || [
    { value: 'mole', text: 'Mole' },
    { value: 'wart', text: 'Wart' },
    { value: 'non-surgical-scar', text: 'Non-surgical scar' },
    { value: 'bruising-or-trauma', text: 'Bruising or trauma' },
    { value: 'other-feature', text: 'Other feature' }
  ]

  let diagramContainer
  let svg
  let popover
  let addBtn, cancelBtn, removeBtn, saveBtn, clearAllBtn, toggleBordersBtn
  let featuresListContainer
  let featuresList
  let statusMessage
  let editingFeature = null
  let currentRegion = null
  let markerCounter = 1
  let allFeatures = []
  let temporaryMarker = null

  // Prevent multiple initializations in NHS Prototype Kit environment
  if (window.breastFeaturesInitialized) {
    console.warn('Breast features already initialized. Skipping.')
    return
  }
  window.breastFeaturesInitialized = true

  // Get DOM elements using new BEM class names
  diagramContainer = document.querySelector('.breast-features__diagram')
  svg = diagramContainer ? diagramContainer.querySelector('svg') : null
  popover = document.querySelector('.breast-features__popover')
  // console.log(
  //   'DEBUG initializeBreastFeatures: diagramContainer:',
  //   diagramContainer
  // )
  // console.log('DEBUG initializeBreastFeatures: svg:', svg)
  addBtn = popover
    ? popover.querySelector('.nhsuk-button[data-action="add"]')
    : null
  cancelBtn = popover
    ? popover.querySelector('.nhsuk-button[data-action="cancel"]')
    : null
  removeBtn = popover
    ? popover.querySelector('.nhsuk-button[data-action="remove"]')
    : null
  saveBtn = document.querySelector('#saveBtn')
  toggleBordersBtn = document.querySelector('#toggleBordersBtn')
  clearAllBtn = document.querySelector('#clearAllFeaturesLink')
  featuresListContainer = document.querySelector('#featuresListContainer')
  featuresList = document.querySelector('#featuresList')
  statusMessage = document.querySelector('#status-message')

  // Essential elements check - adjust for read-only mode
  if (!svg || !diagramContainer) {
    console.error('Essential elements not found:', {
      svg: !!svg,
      diagramContainer: !!diagramContainer
    })
    return
  }

  // Popover is only required for interactive mode
  if (!readOnly && !popover) {
    console.error('Popover required for interactive mode but not found')
    return
  }

  // Set appropriate cursor and modifier classes for read-only mode
  if (readOnly) {
    svg.style.cursor = 'default'
    diagramContainer.classList.add('breast-features__diagram--read-only')
    // console.log('Read-only mode: set cursor to default')
  } else {
    svg.style.cursor = 'crosshair'
  }

  // Create hidden input for form data (skip in read-only mode)
  if (!readOnly) {
    createHiddenInput()
  }

  // Setup interactive elements (skip in read-only mode)
  if (!readOnly) {
    // Event listener for SVG clicks (replaces region-based clicking)
    svg.addEventListener('click', handleSvgClick)

    // Popover action button listeners
    if (addBtn) addBtn.addEventListener('click', addFeature)
    if (cancelBtn) cancelBtn.addEventListener('click', closePopover)
    if (removeBtn) removeBtn.addEventListener('click', removeFeature)
    if (saveBtn) saveBtn.addEventListener('click', saveAllFeatures)
    if (clearAllBtn) clearAllBtn.addEventListener('click', clearAllFeatures)

    // Close popover if click outside
    document.addEventListener('click', function (e) {
      if (
        popover &&
        popover.style.display === 'block' &&
        !popover.contains(e.target) &&
        !svg.contains(e.target) &&
        !e.target.classList.contains('breast-features__marker')
      ) {
        closePopover()
      }
    })

    // Prevent form submission on Enter key in popover
    if (popover) {
      popover.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') {
          e.preventDefault()
          addFeature()
        }
      })
    }

    // Keyboard accessibility
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && popover && popover.style.display === 'block') {
        closePopover()
      }
    })
  } else {
    // console.log('Read-only mode: skipping interactive setup')
  }

  // Toggle borders button listener
  // console.log('DEBUG: toggleBordersBtn found:', toggleBordersBtn)
  if (toggleBordersBtn) {
    // console.log('DEBUG: Adding click listener to borders button')
    toggleBordersBtn.addEventListener('click', function (e) {
      e.preventDefault()
      e.stopPropagation()
      // console.log('DEBUG: Borders button clicked!')
      const anatomicalRegions = document.querySelector(
        '.app-breast-diagram__regions'
      )
      // console.log('DEBUG: anatomicalRegions found:', anatomicalRegions)
      // console.log(
      //   'DEBUG: anatomicalRegions current classes:',
      //   anatomicalRegions.className
      // )

      if (
        anatomicalRegions.classList.contains(
          'app-breast-diagram__regions--visible'
        )
      ) {
        anatomicalRegions.classList.remove(
          'app-breast-diagram__regions--visible'
        )
        this.textContent = 'Show location borders'
        // console.log('DEBUG: Hiding location borders - removed visible class')

        // Force hide all regions by setting style directly
        const allRegions = anatomicalRegions.querySelectorAll(
          '.app-breast-diagram__region'
        )
        allRegions.forEach((region) => {
          region.style.opacity = '0'
        })
      } else {
        anatomicalRegions.classList.add('app-breast-diagram__regions--visible')
        this.textContent = 'Hide location borders'
        // console.log('DEBUG: Showing location borders - added visible class')

        // Force show all regions by setting style directly
        const allRegions = anatomicalRegions.querySelectorAll(
          '.app-breast-diagram__region'
        )
        allRegions.forEach((region) => {
          region.style.opacity = '1'
          region.style.strokeDasharray = '5,5'
          region.style.strokeWidth = '1px'
          region.style.stroke = '#4c6272'
          region.style.fill = 'none'
        })
      }

      // Force check all individual regions
      const allRegions = anatomicalRegions.querySelectorAll(
        '.app-breast-diagram__region'
      )
      // console.log('DEBUG: Found', allRegions.length, 'anatomical regions')
      allRegions.forEach((region, index) => {
        // console.log(
        //   `DEBUG: Region ${index}:`,
        //   region.getAttribute('data-region'),
        //   region.getAttribute('data-side')
        // )
        // console.log(
        //   `DEBUG: Region ${index} computed style:`,
        //   window.getComputedStyle(region).opacity
        // )
      })
    })
  } else {
    // console.log('DEBUG: toggleBordersBtn NOT found')
  }

  // --- Setup Functions ---

  function createHiddenInput() {
    // Create hidden input for form submission if it doesn't exist
    let hiddenField = document.getElementById(hiddenFieldId)
    if (!hiddenField) {
      const form = document.querySelector('form')
      if (form) {
        hiddenField = document.createElement('input')
        hiddenField.type = 'hidden'
        hiddenField.id = hiddenFieldId
        hiddenField.name = hiddenFieldName
        hiddenField.value = ''
        form.appendChild(hiddenField)
        // console.log('Created hidden input:', hiddenFieldName)
      } else {
        console.warn('No form found to add hidden input')
      }
    }
  }

  // --- Core Functions ---

  function createTemporaryMarker(svgX, svgY) {
    // Remove any existing temporary marker
    removeTemporaryMarker()

    temporaryMarker = document.createElement('div')
    temporaryMarker.className =
      'breast-features__marker breast-features__marker--temporary'
    temporaryMarker.innerText = '?'
    temporaryMarker.style.cursor = 'grab'

    positionMarkerAtSvgCoords(temporaryMarker, svgX, svgY)
    diagramContainer.appendChild(temporaryMarker)

    // Add drag functionality to temporary marker
    setupTemporaryMarkerDrag(temporaryMarker)

    // console.log('Temporary marker created at:', svgX, svgY)
  }

  function setupTemporaryMarkerDrag(markerElement) {
    let isDragging = false
    let dragStartX, dragStartY
    let elementStartX, elementStartY
    const dragThreshold = 5

    markerElement.addEventListener('mousedown', function (e) {
      e.preventDefault()
      e.stopPropagation()

      // Prevent text selection during drag
      document.body.style.userSelect = 'none'
      markerElement.style.cursor = 'grabbing'

      isDragging = false
      dragStartX = e.clientX
      dragStartY = e.clientY
      elementStartX = parseInt(markerElement.style.left) || 0
      elementStartY = parseInt(markerElement.style.top) || 0

      document.addEventListener('mousemove', handleMouseMove)
      document.addEventListener('mouseup', handleMouseUp)

      markerElement.classList.add('breast-features__marker--dragging')
    })

    function handleMouseMove(e) {
      const currentX = e.clientX
      const currentY = e.clientY

      const dx = Math.abs(currentX - dragStartX)
      const dy = Math.abs(currentY - dragStartY)

      if (!isDragging && (dx > dragThreshold || dy > dragThreshold)) {
        isDragging = true
      }

      if (isDragging) {
        // Update marker position
        const newLeft = elementStartX + (currentX - dragStartX)
        const newTop = elementStartY + (currentY - dragStartY)
        markerElement.style.left = newLeft + 'px'
        markerElement.style.top = newTop + 'px'

        // Update popover position to follow the marker
        const markerRect = markerElement.getBoundingClientRect()
        const markerCenterX = markerRect.left + markerRect.width / 2
        const markerCenterY = markerRect.top + markerRect.height / 2
        positionPopover(markerCenterX, markerCenterY)

        // Update currentRegion coordinates
        updateCurrentRegionFromMarker(markerElement)
      }
    }

    function handleMouseUp(e) {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
      markerElement.classList.remove('breast-features__marker--dragging')
      markerElement.style.cursor = 'grab'

      // Restore text selection
      document.body.style.userSelect = ''

      if (isDragging) {
        // Final update of region after drag ends
        updateCurrentRegionFromMarker(markerElement)
      }

      isDragging = false
    }
  }

  function updateCurrentRegionFromMarker(markerElement) {
    // Convert marker position back to SVG coordinates
    const containerRect = diagramContainer.getBoundingClientRect()
    const svgRect = svg.getBoundingClientRect()
    const markerRect = markerElement.getBoundingClientRect()

    // Get marker center position relative to container
    const markerCenterX = markerRect.left + markerRect.width / 2 - containerRect.left
    const markerCenterY = markerRect.top + markerRect.height / 2 - containerRect.top

    // Convert to SVG coordinates
    const svgOffsetX = svgRect.left - containerRect.left
    const svgOffsetY = svgRect.top - containerRect.top

    const relativeX = markerCenterX - svgOffsetX
    const relativeY = markerCenterY - svgOffsetY

    const svgX = (relativeX / svgRect.width) * 800
    const svgY = (relativeY / svgRect.height) * 400

    // Determine the new region
    const regionInfo = determineRegionFromCoordinates(svgX, svgY)

    if (regionInfo && currentRegion) {
      currentRegion.name = regionInfo.region
      currentRegion.side = regionInfo.side
      currentRegion.centerX = svgX
      currentRegion.centerY = svgY

      // Update the region label in the popover
      updateRegionLabel()
    }
  }

  function removeTemporaryMarker() {
    if (temporaryMarker) {
      temporaryMarker.remove()
      temporaryMarker = null
      // console.log('Temporary marker removed')
    }
  }

  function handleSvgClick(e) {
    // Allow border toggle to work - don't interfere with anatomical region visibility
    if (e.target.classList.contains('app-breast-diagram__region')) {
      // console.log(
      //   'DEBUG: Clicked on anatomical region:',
      //   e.target.getAttribute('data-region')
      // )
      // Don't return early - let the region click through for adding features
    }

    // Only handle clicks directly on the SVG or anatomical regions, not on existing markers
    if (e.target.classList.contains('breast-features__marker')) {
      return // Let marker handle its own clicks
    }

    e.preventDefault()
    e.stopPropagation()

    // Get the exact click coordinates relative to the SVG
    const svgRect = svg.getBoundingClientRect()
    const clickX = e.clientX - svgRect.left
    const clickY = e.clientY - svgRect.top

    // Convert to SVG coordinate system (800 x 400 viewBox - 2:1 aspect ratio)
    const svgX = (clickX / svgRect.width) * 800
    const svgY = (clickY / svgRect.height) * 400

    console.log('SVG clicked at pixel coords:', clickX, clickY)
    console.log('Converted to SVG coords:', svgX, svgY)

    // Determine which anatomical region this click falls into
    const regionInfo = determineRegionFromCoordinates(svgX, svgY)

    if (!regionInfo) {
      console.warn('Click outside valid breast areas')
      return
    }

    currentRegion = {
      name: regionInfo.region,
      side: regionInfo.side,
      centerX: svgX, // Use exact click position
      centerY: svgY, // Use exact click position
      element: null
    }

    // console.log('Region determined:', regionInfo.region, regionInfo.side)
    // console.log('Exact position will be:', svgX, svgY)

    // Create temporary marker
    createTemporaryMarker(svgX, svgY)

    // Show popover at mouse position
    showPopover(e.clientX, e.clientY)
    editingFeature = null
  }

  function determineRegionFromCoordinates(svgX, svgY) {
    const regions = svg.querySelectorAll('.app-breast-diagram__region')
    const point = new DOMPoint(svgX, svgY)

    // Find region containing the point using isPointInFill
    for (const region of regions) {
      if (region.isPointInFill(point)) {
        return {
          region: region.getAttribute('data-name'),
          side: region.getAttribute('data-side')
        }
      }
    }

    console.warn(`No region found for coordinates (${svgX}, ${svgY})`)
    return null
  }

  function showPopover(clickX, clickY) {
    // console.log('DEBUG: showPopover called with:', clickX, clickY)
    if (!popover || !currentRegion) {
      // console.log('DEBUG: Missing popover or currentRegion:', {
      //   popover: !!popover,
      //   currentRegion: !!currentRegion
      // })
      return
    }

    // console.log('DEBUG: Setting popover visible')
    // Force the popover to be visible
    popover.style.display = 'block'
    popover.style.visibility = 'visible'
    popover.style.opacity = '1'
    popover.style.position = 'fixed'
    popover.style.zIndex = '9999'

    resetPopoverForm()

    // Update region label
    updateRegionLabel()

    // Wait a moment for the popover to render, then position it
    setTimeout(() => {
      positionPopover(clickX, clickY)

      // Focus the popover to ensure it's accessible
      popover.focus()
    }, 10)
  }

  function positionPopover(clickX, clickY) {
    if (!popover) return

    const popoverRect = popover.getBoundingClientRect()
    const gap = 20 // Gap between marker and popover

    // Check if there's enough space on the right
    const spaceOnRight = window.innerWidth - clickX - gap
    const fitsOnRight = spaceOnRight >= popoverRect.width

    let popoverLeft
    if (fitsOnRight) {
      // Position to the right of the marker
      popoverLeft = clickX + gap
    } else {
      // Position to the left of the marker
      popoverLeft = clickX - popoverRect.width - gap
      // If it still doesn't fit, align to left edge
      if (popoverLeft < 10) {
        popoverLeft = 10
      }
    }

    // Vertically center on the click point
    let popoverTop = clickY - popoverRect.height / 2

    // Adjust vertical position to stay within viewport
    if (popoverTop < 10) {
      popoverTop = 10
    }
    if (popoverTop + popoverRect.height > window.innerHeight - 10) {
      popoverTop = window.innerHeight - popoverRect.height - 10
    }

    popover.style.left = popoverLeft + 'px'
    popover.style.top = popoverTop + 'px'
  }

  function updateRegionLabel() {
    const regionLabel = document.querySelector('#regionLabel')
    if (!regionLabel || !currentRegion) return

    if (currentRegion.side === 'center') {
      regionLabel.textContent =
        currentRegion.name.charAt(0).toUpperCase() + currentRegion.name.slice(1)
    } else {
      regionLabel.textContent = `${currentRegion.side.charAt(0).toUpperCase() + currentRegion.side.slice(1)} ${currentRegion.name}`
    }
  }

  function resetPopoverForm() {
    if (!popover) return

    const popoverCaption = popover.querySelector('#popoverCaption')
    const popoverHeading = popover.querySelector('#popoverHeading')

    if (popoverCaption) {
      popoverCaption.innerText = 'Add new feature'
    }
    if (popoverHeading) {
      popoverHeading.innerText = 'What is the feature?'
    }

    addBtn.innerText = 'Add'
    removeBtn.style.display = 'none'

    const radios = popover.querySelectorAll('input[name="feature"]')
    radios.forEach((radio) => (radio.checked = false))

    const customInput = document.querySelector('#customLabel')
    if (customInput) {
      customInput.value = ''
    }

    const conditionalDiv = document.querySelector('.nhsuk-radios__conditional')
    if (conditionalDiv) {
      conditionalDiv.classList.remove('nhsuk-radios__conditional--revealed')
    }
  }

  function createPermanentMarker(
    region,
    side,
    text,
    number,
    featureId,
    exactX,
    exactY
  ) {
    // console.log('=== createPermanentMarker START ===')
    // console.log('Received parameters:', {region, side, text, number, featureId, exactX, exactY})

    const marker = document.createElement('div')
    marker.className = 'breast-features__marker'
    marker.innerText = number
    marker.setAttribute('data-id', number)
    marker.setAttribute('data-name', region)
    marker.setAttribute('data-side', side)
    marker.setAttribute('data-feature-id', featureId)

    // Prevent text selection when dragging
    marker.style.userSelect = 'none'
    marker.style.webkitUserSelect = 'none'
    marker.style.mozUserSelect = 'none'

    // Ensure no transform is applied (stick to pixel positioning)
    marker.style.transform = 'none'

    // Use exact coordinates if provided, otherwise fall back to region center
    if (exactX !== undefined && exactY !== undefined) {
      positionMarkerAtSvgCoords(marker, exactX, exactY)
    } else {
      positionMarkerInRegion(marker, region, side)
    }

    diagramContainer.appendChild(marker)

    // Only setup interaction if not in read-only mode
    if (!readOnly) {
      setupMarkerInteraction(marker)
    } else {
      // In read-only mode, markers are just visual - no interaction
      marker.classList.add('breast-features__marker--read-only')
      marker.style.cursor = 'default'
    }

    // console.log('=== createPermanentMarker END ===')
    return marker
  }

  function positionMarkerInRegion(marker, regionName, side) {
    // Find the corresponding region element and use its bounding box center
    const regionElement = svg.querySelector(
      `[data-name="${regionName}"][data-side="${side}"]`
    )
    if (!regionElement) {
      console.warn('Region element not found:', regionName, side)
      return
    }

    // Get the center of the region's bounding box
    const bbox = regionElement.getBBox()
    const centerX = bbox.x + bbox.width / 2
    const centerY = bbox.y + bbox.height / 2

    positionMarkerAtSvgCoords(marker, centerX, centerY)
  }

  function positionMarkerAtSvgCoords(marker, svgX, svgY) {
    // console.log('--- positionMarkerAtSvgCoords function called ---')
    const containerRect = diagramContainer.getBoundingClientRect()
    const svgRect = svg.getBoundingClientRect()

    // console.log('Input svgX:', svgX, 'svgY:', svgY)

    const svgOffsetX = svgRect.left - containerRect.left
    const svgOffsetY = svgRect.top - containerRect.top

    const pixelX = (svgX / 800) * svgRect.width
    const pixelY = (svgY / 400) * svgRect.height

    // Account for marker size including borders (40px + 2px border each side = 44px total)
    const markerSizeOffset = 23
    const finalLeft = svgOffsetX + pixelX - markerSizeOffset
    const finalTop = svgOffsetY + pixelY - markerSizeOffset

    // Round to integer pixels to prevent 1-3px drift from floating point precision
    marker.style.left = Math.round(finalLeft) + 'px'
    marker.style.top = Math.round(finalTop) + 'px'
    marker.style.position = 'absolute'
    marker.style.zIndex = '50' // Below sticky nav (999) but above diagram content

    // console.log('Final marker position (rounded):', marker.style.left, marker.style.top)
  }

  function setupMarkerInteraction(markerElement) {
    let isDragging = false
    let dragStartX, dragStartY
    let elementStartX, elementStartY
    let dragThreshold = 5

    markerElement.addEventListener('mousedown', function (e) {
      e.preventDefault()
      e.stopPropagation()

      // Prevent text selection during drag
      document.body.style.userSelect = 'none'

      isDragging = false
      dragStartX = e.clientX
      dragStartY = e.clientY
      elementStartX = parseInt(markerElement.style.left) || 0
      elementStartY = parseInt(markerElement.style.top) || 0

      document.addEventListener('mousemove', handleMouseMove)
      document.addEventListener('mouseup', handleMouseUp)

      markerElement.classList.add('breast-features__marker--dragging')
    })

    function handleMouseMove(e) {
      const currentX = e.clientX
      const currentY = e.clientY

      const dx = Math.abs(currentX - dragStartX)
      const dy = Math.abs(currentY - dragStartY)

      if (!isDragging && (dx > dragThreshold || dy > dragThreshold)) {
        isDragging = true
      }

      if (isDragging) {
        const newLeft = elementStartX + (currentX - dragStartX)
        const newTop = elementStartY + (currentY - dragStartY)
        markerElement.style.left = newLeft + 'px'
        markerElement.style.top = newTop + 'px'
      }
    }

    function handleMouseUp(e) {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
      markerElement.classList.remove('breast-features__marker--dragging')

      // Restore text selection
      document.body.style.userSelect = ''

      if (isDragging) {
        updateFeaturePosition(markerElement)
      } else {
        // Prevent the click from bubbling up to document level
        e.preventDefault()
        e.stopPropagation()

        const featureId = parseInt(
          markerElement.getAttribute('data-feature-id')
        )
        const feature = allFeatures.find((f) => f.id === featureId)
        if (feature) {
          editFeature(feature, e.clientX, e.clientY)
        }
      }
      isDragging = false
    }
  }

  function updateFeaturePosition(markerElement) {
    // Convert marker position back to SVG coordinates
    const containerRect = diagramContainer.getBoundingClientRect()
    const svgRect = svg.getBoundingClientRect()
    const markerRect = markerElement.getBoundingClientRect()

    // Get marker center position relative to container
    const markerCenterX =
      markerRect.left + markerRect.width / 2 - containerRect.left
    const markerCenterY =
      markerRect.top + markerRect.height / 2 - containerRect.top

    // Convert to SVG coordinates
    const svgOffsetX = svgRect.left - containerRect.left
    const svgOffsetY = svgRect.top - containerRect.top

    const relativeX = markerCenterX - svgOffsetX
    const relativeY = markerCenterY - svgOffsetY

    const svgX = (relativeX / svgRect.width) * 800
    const svgY = (relativeY / svgRect.height) * 400

    // Determine new region
    const regionInfo = determineRegionFromCoordinates(svgX, svgY)

    if (regionInfo) {
      const featureId = parseInt(markerElement.getAttribute('data-feature-id'))
      const feature = allFeatures.find((f) => f.id === featureId)

      if (feature) {
        feature.region = regionInfo.region
        feature.side = regionInfo.side
        feature.centerX = svgX
        feature.centerY = svgY

        // Snap to exact position
        positionMarkerAtSvgCoords(markerElement, svgX, svgY)
        updateFeaturesList()
        updateHiddenField()
        console.log(
          `Feature ${feature.number} moved to ${regionInfo.side} ${regionInfo.region}`
        )
      }
    } else {
      // console.log(
      //   'Marker dragged outside valid area - reverting to original position'
      // )
      const featureId = parseInt(markerElement.getAttribute('data-feature-id'))
      const feature = allFeatures.find((f) => f.id === featureId)
      if (feature) {
        positionMarkerAtSvgCoords(
          markerElement,
          feature.centerX,
          feature.centerY
        )
      }
    }
  }

  function editFeature(feature, clickX, clickY) {
    // console.log('DEBUG: editFeature called with:', feature, clickX, clickY)

    // Remove any temporary marker since we're editing an existing feature
    removeTemporaryMarker()

    editingFeature = feature
    currentRegion = {
      name: feature.region,
      side: feature.side,
      centerX: feature.centerX,
      centerY: feature.centerY
    }
    // console.log('DEBUG: Set currentRegion:', currentRegion)

    if (!popover) {
      console.error('Popover not found in editFeature')
      return
    }

    // console.log('DEBUG: About to call showPopover')
    showPopover(clickX, clickY)

    const popoverCaption = popover.querySelector('#popoverCaption')
    const popoverHeading = popover.querySelector('#popoverHeading')

    if (popoverCaption) {
      popoverCaption.innerText = `Editing feature ${feature.number}`
    }
    if (popoverHeading) {
      popoverHeading.innerText = 'What is the feature?'
    }

    if (addBtn) addBtn.innerText = 'Save changes'
    if (removeBtn) removeBtn.style.display = 'inline-block'

    const radios = popover.querySelectorAll('input[name="feature"]')
    radios.forEach((radio) => (radio.checked = false))

    let featureFound = false
    const featureTextLower = feature.text.toLowerCase()

    // Handle "Other: " prefixed features first
    if (feature.text && feature.text.startsWith('Other: ')) {
      const otherRadio = document.getElementById('feature-other-feature')
      const customInput = document.querySelector('#customLabel')
      const conditionalDiv = document.querySelector(
        '.nhsuk-radios__conditional'
      )

      if (otherRadio) {
        otherRadio.checked = true
        featureFound = true

        if (conditionalDiv) {
          conditionalDiv.classList.add('nhsuk-radios__conditional--revealed')
        }
        if (customInput) {
          customInput.value = feature.text.replace('Other: ', '')
        }
      }
    } else {
      // Match standard feature types using the configured feature types
      radios.forEach((radio) => {
        let shouldCheck = false

        // Find matching feature type from configuration
        const featureType = featureTypes.find((ft) => ft.value === radio.value)
        if (
          featureType &&
          featureTextLower === featureType.text.toLowerCase()
        ) {
          shouldCheck = true
        }

        if (shouldCheck) {
          radio.checked = true
          featureFound = true
        }
      })

      // If no standard match found, treat as "other feature"
      if (!featureFound) {
        const otherRadio = document.getElementById('feature-other-feature')
        const customInput = document.querySelector('#customLabel')
        const conditionalDiv = document.querySelector(
          '.nhsuk-radios__conditional'
        )

        if (otherRadio) {
          otherRadio.checked = true
          featureFound = true

          if (conditionalDiv) {
            conditionalDiv.classList.add('nhsuk-radios__conditional--revealed')
          }
          if (customInput) {
            customInput.value = feature.text
          }
        }
      }
    }
  }

  function addFeature() {
    const selectedFeatureRadio = popover.querySelector(
      'input[name="feature"]:checked'
    )
    let featureText = ''

    if (!selectedFeatureRadio) {
      showStatusMessage('Please select a feature type.', 'error')
      return
    }

    if (selectedFeatureRadio.value === 'other-feature') {
      const customLabel = document.querySelector('#customLabel')
        ? document.querySelector('#customLabel').value.trim()
        : ''
      if (!customLabel) {
        showStatusMessage('Please enter text for "Other" feature.', 'error')
        return
      }
      featureText = `Other: ${customLabel}`
    } else {
      // Find the feature type in configuration
      const featureType = featureTypes.find(
        (ft) => ft.value === selectedFeatureRadio.value
      )
      featureText = featureType
        ? featureType.text
        : selectedFeatureRadio.value.charAt(0).toUpperCase() +
          selectedFeatureRadio.value.slice(1)
    }

    if (editingFeature) {
      editingFeature.text = featureText
      updateFeaturesList()
      updateHiddenField()
      editingFeature = null
    } else if (currentRegion) {
      // Remove temporary marker before creating permanent one
      removeTemporaryMarker()

      const newFeatureNumber = markerCounter++
      const newFeature = {
        id:
          allFeatures.length > 0
            ? Math.max(...allFeatures.map((f) => f.id)) + 1
            : 1,
        number: newFeatureNumber,
        text: featureText,
        region: currentRegion.name,
        side: currentRegion.side,
        centerX: currentRegion.centerX, // Exact click coordinates
        centerY: currentRegion.centerY // Exact click coordinates
      }

      allFeatures.push(newFeature)
      updateFeaturesCount()

      // Pass exact coordinates to createPermanentMarker
      const markerElement = createPermanentMarker(
        newFeature.region,
        newFeature.side,
        newFeature.text,
        newFeature.number,
        newFeature.id,
        newFeature.centerX, // exact X coordinate
        newFeature.centerY // exact Y coordinate
      )
      newFeature.element = markerElement

      updateFeaturesList()
      updateHiddenField()

      currentRegion = null
    }

    closePopover()
  }

  function removeFeature() {
    if (!editingFeature) return

    allFeatures = allFeatures.filter((f) => f.id !== editingFeature.id)
    updateFeaturesCount()
    if (editingFeature.element) {
      editingFeature.element.remove()
    }
    updateFeaturesList()
    updateHiddenField()
    closePopover()
    editingFeature = null
  }

  function closePopover() {
    if (popover) {
      popover.style.display = 'none'
      popover.style.visibility = 'hidden'
      popover.style.opacity = '0'
    }

    // Remove temporary marker when closing popover
    removeTemporaryMarker()

    currentRegion = null
    editingFeature = null
  }

  function updateFeaturesList() {
    if (!featuresListContainer || !featuresList) {
      console.warn('Features list container or list element not found.')
      return
    }

    if (allFeatures.length === 0) {
      featuresListContainer.style.display = 'none'
      return
    }

    featuresListContainer.style.display = 'block'
    featuresList.innerHTML = ''

    allFeatures.sort((a, b) => a.number - b.number)

    const ul = document.createElement('ul')
    ul.className = 'nhsuk-list breast-features__list-items'

    allFeatures.forEach((feature) => {
      const listItem = document.createElement('li')
      listItem.className = 'breast-features__item'

      // Only add interactive modifier and click handling if not read-only
      if (!readOnly) {
        listItem.classList.add('breast-features__item--interactive')
        listItem.setAttribute('data-feature-id', feature.id)
      }

      let locationText = ''
      if (feature.side === 'center') {
        locationText =
          feature.region.charAt(0).toUpperCase() + feature.region.slice(1)
      } else {
        locationText = `${feature.side.charAt(0).toUpperCase() + feature.side.slice(1)} ${feature.region}`
      }

      listItem.innerHTML = `
                <div class="breast-features__item-left">
                    <div class="breast-features__item-number">${feature.number}</div>
                    <div class="breast-features__item-label">${feature.text}</div>
                </div>
                <div class="breast-features__item-position"><span class="nhsuk-tag nhsuk-tag--white">${locationText}</span></div>
            `

      // Only add click interaction if not in read-only mode
      if (!readOnly) {
        listItem.addEventListener('click', function (e) {
          // console.log('DEBUG: Key item clicked!')
          e.preventDefault()
          e.stopPropagation()

          const featureId = parseInt(this.getAttribute('data-feature-id'))
          const feature = allFeatures.find((f) => f.id === featureId)
          // console.log('DEBUG: Found feature:', feature)

          if (feature) {
            let centerX, centerY

            // Try to get marker position, fall back to click position if not available
            if (feature.element) {
              try {
                const markerRect = feature.element.getBoundingClientRect()
                centerX = markerRect.left + markerRect.width / 2
                centerY = markerRect.top + markerRect.height / 2
                // console.log('DEBUG: Using marker position:', centerX, centerY)
              } catch (error) {
                console.warn('Could not get marker position, using fallback')
                centerX = e.clientX
                centerY = e.clientY
                // console.log('DEBUG: Using fallback position:', centerX, centerY)
              }
            } else {
              // Use the click position as fallback
              centerX = e.clientX
              centerY = e.clientY
              console.log(
                'DEBUG: No marker element, using click position:',
                centerX,
                centerY
              )
            }

            // console.log('DEBUG: About to call editFeature')
            editFeature(feature, centerX, centerY)
          }
        })
      }

      ul.appendChild(listItem)

      if (feature.element) {
        feature.element.innerText = feature.number
      }
    })

    featuresList.appendChild(ul)
  }

  function clearAllFeatures(e) {
    e.preventDefault()

    if (allFeatures.length === 0) {
      return
    }

    if (
      confirm(
        `Are you sure you want to remove all ${allFeatures.length} features? This cannot be undone.`
      )
    ) {
      allFeatures.forEach((feature) => {
        if (feature.element) {
          feature.element.remove()
        }
      })

      allFeatures = []
      markerCounter = 1
      updateFeaturesCount()
      updateFeaturesList()
      updateHiddenField()
    }
  }

  function saveAllFeatures() {
    // Features are automatically saved to hidden field, no need for manual save
    updateHiddenField()

    // No redirect needed - form submission handles navigation
    showStatusMessage('Features saved successfully!', 'success')
  }

  function showStatusMessage(message, type) {
    if (!statusMessage) {
      console.warn('Status message element not found.')
      return
    }
    statusMessage.innerText = message
    statusMessage.classList.remove(
      'nhsuk-u-visually-hidden',
      'status-success',
      'status-error'
    )
    if (type === 'success') {
      statusMessage.classList.add('status-success')
    } else if (type === 'error') {
      statusMessage.classList.add('status-error')
    }
    statusMessage.focus()
    setTimeout(() => {
      statusMessage.classList.add('nhsuk-u-visually-hidden')
    }, 5000)
  }

  function updateFeaturesCount() {
    const countInput = document.querySelector('#breastFeaturesCount')
    if (countInput) {
      countInput.value = allFeatures.length
      console.log('Updated features count to:', allFeatures.length)
    }
  }

  function updateHiddenField() {
    const hiddenField = document.getElementById(hiddenFieldId)
    if (hiddenField) {
      const featuresData = allFeatures.map((f) => ({
        id: f.id,
        number: f.number,
        text: f.text,
        region: f.region,
        side: f.side,
        centerX: f.centerX,
        centerY: f.centerY
      }))
      hiddenField.value = JSON.stringify(featuresData)
      console.log('Updated hidden field with:', featuresData.length, 'features')
    } else {
      console.warn('Hidden field not found:', hiddenFieldId)
    }
  }

  function loadExistingFeatures() {
    // Load features from configuration (passed from server)
    if (
      existingFeatures &&
      Array.isArray(existingFeatures) &&
      existingFeatures.length > 0
    ) {
      // console.log(
      //   'Loading',
      //   existingFeatures.length,
      //   'existing features from config'
      // )

      allFeatures = existingFeatures.filter(
        (f) => f.region !== undefined && f.side !== undefined
      )

      allFeatures.forEach((savedFeature) => {
        // Use exact coordinates if available, otherwise fall back to region centers
        const markerElement = createPermanentMarker(
          savedFeature.region,
          savedFeature.side,
          savedFeature.text,
          savedFeature.number,
          savedFeature.id,
          savedFeature.centerX, // exact coordinates
          savedFeature.centerY
        )
        savedFeature.element = markerElement
        if (savedFeature.id >= markerCounter) {
          markerCounter = savedFeature.id + 1
        }
      })

      if (allFeatures.length > 0) {
        updateFeaturesList()
        updateFeaturesCount()
        updateHiddenField()
      }
    } else {
      // console.log('No existing features to load')
    }
  }

  // Initialize: Load any existing features
  loadExistingFeatures()

  // Handle window resize to reposition markers
  window.addEventListener('resize', function () {
    allFeatures.forEach((feature) => {
      if (
        feature.element &&
        feature.centerX !== undefined &&
        feature.centerY !== undefined
      ) {
        positionMarkerAtSvgCoords(
          feature.element,
          feature.centerX,
          feature.centerY
        )
      }
    })
  })

  // Prevent form submission on Enter key in popover
  if (popover) {
    popover.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') {
        e.preventDefault()
        addFeature()
      }
    })
  }

  // Keyboard accessibility
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && popover && popover.style.display === 'block') {
      closePopover()
    }
  })
} // End of initializeBreastFeatures

// Try multiple initialization methods for NHS Prototype Kit compatibility
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initializeBreastFeatures)
} else {
  initializeBreastFeatures()
}

// Also try after window load in case NHS scripts interfere
window.addEventListener('load', function () {
  if (!window.breastFeaturesInitialized) {
    console.log('Attempting initialization after window load...')
    initializeBreastFeatures()
  }
})
