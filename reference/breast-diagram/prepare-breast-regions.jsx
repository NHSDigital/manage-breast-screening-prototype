// scripts/illustrator/prepare-breast-regions.jsx
//
// Illustrator ExtendScript to prepare breast diagram regions for export
//
// This script (run twice):
// Step 1: Duplicates Live Paint group, prompts for manual expand
// Step 2: Labels paths, mirrors to create left side, cleans up
//
// Run this in Illustrator via File > Scripts > Other Script...

;(function () {
  // Check we have a document open
  if (app.documents.length === 0) {
    alert('Please open a document first.')
    return
  }

  var doc = app.activeDocument

  // Layer names
  var REGIONS_LAYER_NAME = 'Regions'
  var LABELS_LAYER_NAME = 'Region labels'
  var OUTPUT_LAYER_NAME = 'Breast diagram to export'
  var BREAST_DIAGRAM_LAYER_NAME = 'Breast diagram'

  // Artboard dimensions (for mirroring)
  var ARTBOARD_WIDTH = 800
  var MIRROR_CENTER_X = ARTBOARD_WIDTH / 2 // 400

  // Track which layers we unlocked so we can re-lock them
  var layersToRelock = []
  var layersToHide = []

  // Unlock layers if needed
  var regionsLayer = findLayer(doc, REGIONS_LAYER_NAME)
  var labelsLayer = findLayer(doc, LABELS_LAYER_NAME)
  var outputLayer = findLayer(doc, OUTPUT_LAYER_NAME)
  var breastDiagramLayer = findLayer(doc, BREAST_DIAGRAM_LAYER_NAME)

  if (regionsLayer && regionsLayer.locked) {
    regionsLayer.locked = false
    layersToRelock.push(regionsLayer)
  }
  if (labelsLayer && labelsLayer.locked) {
    labelsLayer.locked = false
    layersToRelock.push(labelsLayer)
  }
  if (outputLayer && outputLayer.locked) {
    outputLayer.locked = false
    layersToRelock.push(outputLayer)
  }
  if (breastDiagramLayer && breastDiagramLayer.locked) {
    breastDiagramLayer.locked = false
    layersToRelock.push(breastDiagramLayer)
  }

  // Validate required layers exist
  if (!regionsLayer) {
    alert('Could not find layer: ' + REGIONS_LAYER_NAME)
    relockLayers(layersToRelock)
    return
  }

  if (!labelsLayer) {
    alert('Could not find layer: ' + LABELS_LAYER_NAME)
    relockLayers(layersToRelock)
    return
  }

  // Find the live paint group in the Regions layer
  var livePaintGroup = findLivePaintGroup(regionsLayer)

  // Collect all text labels and their bounds
  var labels = collectLabels(labelsLayer)

  if (labels.length === 0) {
    alert("No text labels found in '" + LABELS_LAYER_NAME + "' layer.")
    relockLayers(layersToRelock)
    return
  }

  // Create or get output layer
  if (!outputLayer) {
    outputLayer = doc.layers.add()
    outputLayer.name = OUTPUT_LAYER_NAME
    outputLayer.move(regionsLayer, ElementPlacement.PLACEBEFORE)
  }

  // Make sure output layer is visible and unlocked for our work
  outputLayer.visible = true
  outputLayer.locked = false

  // Check if there's already expanded content in output layer
  var existingPaths = []
  collectPathItems(outputLayer, existingPaths)

  // Determine which step we're on
  var hasLivePaint = livePaintGroup !== null
  var hasExpandedPaths = existingPaths.length > 0

  // ============ STEP 1: Duplicate and prompt for expand ============
  if (!hasExpandedPaths) {
    if (hasLivePaint) {
      var duplicatedGroup = livePaintGroup.duplicate(
        outputLayer,
        ElementPlacement.PLACEATBEGINNING
      )

      // Deselect everything, then select the duplicated Live Paint group
      doc.selection = null
      duplicatedGroup.selected = true
      doc.selection = [duplicatedGroup]

      var instructions = 'STEP 1: Expand Live Paint\n\n'
      instructions +=
        "The Live Paint group has been duplicated and selected in the '" +
        OUTPUT_LAYER_NAME +
        "' layer.\n\n"
      instructions += 'Now please:\n'
      instructions += '1. Go to Object > Live Paint > Expand\n'
      instructions += '2. Run this script again to label and mirror the paths'

      alert(instructions)

      // Re-lock the source layers
      if (regionsLayer) regionsLayer.locked = true
      if (labelsLayer) labelsLayer.locked = true
      return
    } else {
      alert(
        "Could not find Live Paint group or expanded paths.\n\nMake sure the '" +
          REGIONS_LAYER_NAME +
          "' layer contains a Live Paint group, or the '" +
          OUTPUT_LAYER_NAME +
          "' layer contains expanded paths."
      )
      relockLayers(layersToRelock)
      return
    }
  }

  // ============ STEP 2: Label, mirror, and clean up ============

  // Find and process groups in the output layer
  // After Live Paint expand, there may be a "Live Paint" group with the paths
  // We want to keep only one group (renamed to "right") and delete any extras

  var rightGroup = null
  var groupsToDelete = []

  for (var i = 0; i < outputLayer.groupItems.length; i++) {
    var grp = outputLayer.groupItems[i]
    // Skip if it's already our "left" group from a previous run
    if (grp.name === 'left') {
      continue
    }
    // Take the first suitable group as our "right" group
    if (
      !rightGroup &&
      (grp.name === 'Live Paint' || grp.name === '' || grp.name === 'right')
    ) {
      rightGroup = grp
    } else if (grp.name !== 'left') {
      // Mark other groups for deletion (duplicates)
      groupsToDelete.push(grp)
    }
  }

  // Delete any extra groups
  for (var d = 0; d < groupsToDelete.length; d++) {
    groupsToDelete[d].remove()
  }

  // If paths aren't in a group, create one
  if (!rightGroup && existingPaths.length > 0) {
    rightGroup = outputLayer.groupItems.add()
    rightGroup.name = 'right'
    // Move all paths into the group
    for (var i = existingPaths.length - 1; i >= 0; i--) {
      existingPaths[i].move(rightGroup, ElementPlacement.PLACEATBEGINNING)
    }
    // Re-collect paths from the group
    existingPaths = []
    collectPathItemsFromGroup(rightGroup, existingPaths)
  } else if (rightGroup) {
    rightGroup.name = 'right'
    // Re-collect paths from the group to ensure we have them
    existingPaths = []
    collectPathItemsFromGroup(rightGroup, existingPaths)
  }

  // Label the paths
  var labelledCount = 0
  var unlabelledCount = 0
  var labelledNames = []

  // First, check for potential label overlap issues
  var overlapWarnings = checkForLabelOverlaps(labels, existingPaths)
  if (overlapWarnings.length > 0) {
    var warningMsg = 'WARNING: Potential label conflicts detected!\n\n'
    warningMsg += 'Multiple labels are claiming the same path.\n'
    warningMsg += 'Check that each label is inside its region.\n\n'
    for (var w = 0; w < overlapWarnings.length; w++) {
      warningMsg += '- ' + overlapWarnings[w] + '\n'
    }
    warningMsg += '\nContinue anyway?'

    if (!confirm(warningMsg)) {
      relockLayers(layersToRelock)
      return
    }
  }

  // First pass: for each label, find the best path and assign
  var usedNames = {}
  var duplicateNames = []

  for (var i = 0; i < labels.length; i++) {
    var label = labels[i]
    var bestPath = findBestPathForLabel(label, existingPaths)

    if (bestPath) {
      // Only assign if not already labelled
      var existingName = bestPath.name
      if (
        !existingName ||
        existingName === '' ||
        existingName.indexOf('<') === 0
      ) {
        bestPath.name = label.text
        bestPath.stroked = false
        bestPath.filled = false
        labelledCount++
        labelledNames.push(label.text)

        // Track for duplicate detection
        if (usedNames[label.text]) {
          duplicateNames.push(label.text)
        }
        usedNames[label.text] = true
      }
    }
  }

  // Warn about duplicate names
  if (duplicateNames.length > 0) {
    var dupMsg = 'WARNING: Duplicate path names detected!\n\n'
    dupMsg += 'The following names were assigned to multiple paths:\n'
    for (var d = 0; d < duplicateNames.length; d++) {
      dupMsg += '- ' + duplicateNames[d] + '\n'
    }
    dupMsg += '\nThis may indicate duplicate labels in the artwork.'
    alert(dupMsg)
  }

  // Second pass: mark any remaining unlabelled paths
  for (var i = 0; i < existingPaths.length; i++) {
    var pathItem = existingPaths[i]
    var existingName = pathItem.name

    // Skip if already labelled
    if (
      existingName &&
      existingName !== '' &&
      existingName.indexOf('<') !== 0
    ) {
      continue
    }

    // Remove stroke, set no fill
    pathItem.stroked = false
    pathItem.filled = false

    pathItem.name = 'unlabelled-' + (unlabelledCount + 1)
    unlabelledCount++
  }

  // ============ MIRROR TO CREATE LEFT SIDE ============

  // Check if left group already exists
  var leftGroup = null
  for (var i = 0; i < outputLayer.groupItems.length; i++) {
    if (outputLayer.groupItems[i].name === 'left') {
      leftGroup = outputLayer.groupItems[i]
      break
    }
  }

  // Only create mirror if it doesn't exist
  if (!leftGroup && rightGroup) {
    // Duplicate the right group
    leftGroup = rightGroup.duplicate(outputLayer, ElementPlacement.PLACEATEND)
    leftGroup.name = 'left'

    // Mirror horizontally around the center (x = 400)
    // We need to reflect each point. For a simple approach, we can:
    // 1. Move the group so its left edge is at the mirror point
    // 2. Reflect it
    // 3. This effectively mirrors around x = MIRROR_CENTER_X

    // Get the bounds of the left group
    var groupBounds = leftGroup.geometricBounds // [left, top, right, bottom]
    var groupWidth = groupBounds[2] - groupBounds[0]

    // Reflect horizontally (scale -100% on X axis)
    // The transformation matrix for horizontal flip around a point:
    // We'll use resize with negative scale

    // First, create a transformation matrix for reflection around x = 400
    // Reflect: new_x = 2 * center - old_x = 800 - old_x

    // Apply horizontal flip using transform
    // Arguments: scaleX, scaleY, changePositions, changeFillPatterns, changeFillGradients, changeStrokePattern, changeLineWidths, scaleAbout
    var flipMatrix = app.getScaleMatrix(-100, 100)
    leftGroup.transform(
      flipMatrix,
      true,
      true,
      true,
      true,
      true,
      Transformation.CENTER
    )

    // Now move it to the correct position
    // After flipping around its center, we need to position it correctly
    // The right group spans from ~400 to ~800 (right side of artboard)
    // The left group should span from ~0 to ~400 (left side of artboard)

    var newBounds = leftGroup.geometricBounds
    var currentCenterX = (newBounds[0] + newBounds[2]) / 2
    var rightGroupBounds = rightGroup.geometricBounds
    var rightCenterX = (rightGroupBounds[0] + rightGroupBounds[2]) / 2

    // The left group's center should be at (ARTBOARD_WIDTH - rightCenterX)
    var targetCenterX = ARTBOARD_WIDTH - rightCenterX
    var moveX = targetCenterX - currentCenterX

    leftGroup.translate(moveX, 0)
  }

  // ============ COPY BREAST DIAGRAM ============

  // Check if we already have breast diagram content in output layer
  var hasBreastDiagram = false
  for (var i = 0; i < outputLayer.groupItems.length; i++) {
    if (outputLayer.groupItems[i].name === 'outline') {
      hasBreastDiagram = true
      break
    }
  }

  // Copy breast diagram layer contents if not already done
  if (!hasBreastDiagram && breastDiagramLayer) {
    // Create a group to hold the breast diagram content
    var outlineGroup = outputLayer.groupItems.add()
    outlineGroup.name = 'outline'

    // Copy all items from breast diagram layer
    for (var i = breastDiagramLayer.pageItems.length - 1; i >= 0; i--) {
      var item = breastDiagramLayer.pageItems[i]
      var copiedItem = item.duplicate(
        outlineGroup,
        ElementPlacement.PLACEATBEGINNING
      )
    }

    // Move outline group to the front (above regions)
    outlineGroup.zOrder(ZOrderMethod.BRINGTOFRONT)
  }

  // ============ CLEAN UP ============

  // Hide ALL layers except the output layer
  for (var i = 0; i < doc.layers.length; i++) {
    var layer = doc.layers[i]
    if (layer.name !== OUTPUT_LAYER_NAME) {
      layer.visible = false
      layer.locked = true
    }
  }

  // Make sure output layer is visible
  outputLayer.visible = true

  // Switch to wireframe/outline view
  // Try different command names for different Illustrator versions
  var outlineCommands = [
    'preview',
    'outline',
    'View Outline',
    'ai_plugin_Layer'
  ]
  for (var c = 0; c < outlineCommands.length; c++) {
    try {
      app.executeMenuCommand(outlineCommands[c])
      break
    } catch (e) {
      // Try next command
    }
  }

  // Deselect everything
  doc.selection = null

  // Report results
  var message = 'STEP 2 Complete!\n\n'
  message += 'Labelled ' + labelledCount + " paths in 'right' group.\n"
  if (unlabelledCount > 0) {
    message +=
      'Unlabelled: ' + unlabelledCount + " (check for 'unlabelled-X' names)\n"
  }
  message += "\nMirrored to create 'left' group.\n"
  message += "Copied breast diagram to 'outline' group.\n"
  message += '\nAll other layers have been hidden.\n'
  message += 'Press Cmd+Y to switch to Outline mode if needed.\n'
  message += '\nExport via File > Export > Export As...\n'
  message += 'Filename: breast-features-diagram-<version>.svg\n'
  message += '\nIMPORTANT: Tick "Use Artboards" in the export dialog.'

  alert(message)

  // ============ HELPER FUNCTIONS ============

  function relockLayers(layers) {
    for (var i = 0; i < layers.length; i++) {
      layers[i].locked = true
    }
  }

  function findLayer(doc, name) {
    for (var i = 0; i < doc.layers.length; i++) {
      if (doc.layers[i].name === name) {
        return doc.layers[i]
      }
    }
    return null
  }

  function findLivePaintGroup(layer) {
    for (var i = 0; i < layer.pageItems.length; i++) {
      var item = layer.pageItems[i]
      if (item.typename === 'PluginItem') {
        return item
      }
      if (item.typename === 'GroupItem') {
        var found = findLivePaintInGroup(item)
        if (found) return found
      }
    }
    return null
  }

  function findLivePaintInGroup(group) {
    for (var i = 0; i < group.pageItems.length; i++) {
      var item = group.pageItems[i]
      if (item.typename === 'PluginItem') {
        return item
      }
      if (item.typename === 'GroupItem') {
        var found = findLivePaintInGroup(item)
        if (found) return found
      }
    }
    return null
  }

  function collectLabels(layer) {
    var labels = []
    collectTextItems(layer, labels)
    return labels
  }

  function collectTextItems(container, results) {
    var items = container.pageItems || container
    for (var i = 0; i < items.length; i++) {
      var item = items[i]
      if (item.typename === 'TextFrame') {
        var rawText = String(item.contents)
        rawText = rawText.replace(/\r/g, ' ')
        rawText = rawText.replace(/\n/g, ' ')
        rawText = rawText.replace(/\s+/g, ' ')
        rawText = rawText.replace(/^\s+/, '').replace(/\s+$/, '')
        rawText = rawText.toLowerCase()

        // Use the center of the bounding box
        var bounds = item.geometricBounds
        var centerX = (bounds[0] + bounds[2]) / 2
        var centerY = (bounds[1] + bounds[3]) / 2

        results.push({
          text: rawText,
          bounds: bounds,
          centerX: centerX,
          centerY: centerY
        })
      } else if (item.typename === 'GroupItem') {
        collectTextItems(item, results)
      }
    }
  }

  function collectPathItems(layer, results) {
    for (var i = 0; i < layer.pageItems.length; i++) {
      var item = layer.pageItems[i]
      if (item.typename === 'PathItem') {
        results.push(item)
      } else if (item.typename === 'CompoundPathItem') {
        results.push(item)
      } else if (item.typename === 'GroupItem') {
        collectPathItemsFromGroup(item, results)
      }
    }
  }

  function collectPathItemsFromGroup(group, results) {
    for (var i = 0; i < group.pageItems.length; i++) {
      var item = group.pageItems[i]
      if (item.typename === 'PathItem') {
        results.push(item)
      } else if (item.typename === 'CompoundPathItem') {
        results.push(item)
      } else if (item.typename === 'GroupItem') {
        collectPathItemsFromGroup(item, results)
      }
    }
  }

  function findLabelForPath(pathItem, labels) {
    var bounds = pathItem.geometricBounds
    var pathArea = (bounds[2] - bounds[0]) * (bounds[1] - bounds[3])

    // Find all labels whose center is within this path's bounding box
    var candidateLabels = []
    for (var i = 0; i < labels.length; i++) {
      var label = labels[i]
      if (pointInBounds(label.centerX, label.centerY, bounds)) {
        candidateLabels.push(label)
      }
    }

    // If exactly one match, use it
    if (candidateLabels.length === 1) {
      return candidateLabels[0].text
    }

    // If no matches, return null
    if (candidateLabels.length === 0) {
      return null
    }

    // Multiple matches - this path's bbox contains multiple labels
    // This is expected for larger regions. Return null and let the
    // reverse lookup (label looking for smallest containing path) handle it.
    return null
  }

  // For each label, find the path whose center is closest to the label
  // This works better than "smallest containing bbox" for arc-shaped regions
  function findBestPathForLabel(label, paths) {
    var bestPath = null
    var smallestDistance = Infinity

    for (var i = 0; i < paths.length; i++) {
      var pathItem = paths[i]
      var bounds = pathItem.geometricBounds

      // First check: label must be within the path's bounding box
      if (!pointInBounds(label.centerX, label.centerY, bounds)) {
        continue
      }

      // Calculate distance from label to path's bbox center
      var pathCenterX = (bounds[0] + bounds[2]) / 2
      var pathCenterY = (bounds[1] + bounds[3]) / 2

      var dx = label.centerX - pathCenterX
      var dy = label.centerY - pathCenterY
      var distance = Math.sqrt(dx * dx + dy * dy)

      if (distance < smallestDistance) {
        smallestDistance = distance
        bestPath = pathItem
      }
    }

    return bestPath
  }

  // Check for potential issues - labels that don't have a clear best path
  function checkForLabelOverlaps(labels, paths) {
    var warnings = []

    // For each path, count how many labels consider it their "best" match
    var pathLabelCounts = {}

    for (var i = 0; i < labels.length; i++) {
      var label = labels[i]
      var bestPath = findBestPathForLabel(label, paths)

      if (bestPath) {
        // Use path index as key since paths don't have reliable IDs yet
        var pathIndex = -1
        for (var j = 0; j < paths.length; j++) {
          if (paths[j] === bestPath) {
            pathIndex = j
            break
          }
        }

        if (!pathLabelCounts[pathIndex]) {
          pathLabelCounts[pathIndex] = []
        }
        pathLabelCounts[pathIndex].push(label.text)
      }
    }

    // Check for paths with multiple labels claiming them
    for (var pathIndex in pathLabelCounts) {
      if (pathLabelCounts[pathIndex].length > 1) {
        warnings.push(
          'Path has ' +
            pathLabelCounts[pathIndex].length +
            ' labels claiming it: ' +
            pathLabelCounts[pathIndex].join(', ')
        )
      }
    }

    return warnings
  }

  function pointInBounds(x, y, bounds) {
    var left = bounds[0]
    var top = bounds[1]
    var right = bounds[2]
    var bottom = bounds[3]
    return x >= left && x <= right && y <= top && y >= bottom
  }
})()
