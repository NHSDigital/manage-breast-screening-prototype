// reference/breast-diagram/process-exported-svg.js
//
// Processes the exported SVG from Illustrator to add required data attributes
// and clean up for use in the breast features component.
//
// Usage: node process-exported-svg.js <input-file.svg>
// Output: Creates <input-file>-processed.svg in the same directory

const fs = require('fs')
const path = require('path')

// BEM block name - the SVG elements are all children of this block
const BEM_BLOCK = 'app-breast-diagram'

// Get input file from command line
const inputFile = process.argv[2]

if (!inputFile) {
  console.error('Usage: node process-exported-svg.js <input-file.svg>')
  process.exit(1)
}

if (!fs.existsSync(inputFile)) {
  console.error(`File not found: ${inputFile}`)
  process.exit(1)
}

// Read the SVG file
const svgContent = fs.readFileSync(inputFile, 'utf8')

// Process the SVG
const processedSvg = processSvg(svgContent)

// Generate output filename
const ext = path.extname(inputFile)
const basename = path.basename(inputFile, ext)
const dirname = path.dirname(inputFile)
const outputFile = path.join(dirname, `${basename}-processed${ext}`)

// Write the processed SVG
fs.writeFileSync(outputFile, processedSvg)

console.log(`Processed SVG written to: ${outputFile}`)

// ============ Processing Functions ============

function processSvg(svg) {
  // Track stats for reporting
  const stats = {
    regionsProcessed: 0,
    leftRegions: 0,
    rightRegions: 0
  }

  // Add BEM class to root SVG element and remove fixed dimensions
  svg = processSvgElement(svg)

  // Process region paths inside left and right groups
  svg = processRegionGroup(svg, 'left', stats)
  svg = processRegionGroup(svg, 'right', stats)

  // Wrap the left and right groups in a regions container
  svg = wrapRegionsInContainer(svg)

  // Add BEM classes to outline elements
  svg = processOutlineGroup(svg)

  // Remove inline styles from region paths (fill: none will be handled by CSS)
  svg = removeInlineStylesFromRegions(svg)

  // Clean up unnecessary attributes from defs
  svg = cleanupDefs(svg)

  // Clean up the XML declaration and add a comment
  svg = addProcessedComment(svg)

  // Validate the processed SVG
  const validation = validateProcessedSvg(svg, stats)
  if (!validation.valid) {
    console.error('\n❌ Validation failed:')
    validation.errors.forEach((err) => console.error(`   - ${err}`))
    process.exit(1)
  }
  if (validation.warnings.length > 0) {
    console.warn('\n⚠️  Warnings:')
    validation.warnings.forEach((warn) => console.warn(`   - ${warn}`))
  }

  console.log(
    `\n✅ Processed ${stats.regionsProcessed} regions (${stats.leftRegions} left, ${stats.rightRegions} right)`
  )

  return svg
}

function processSvgElement(svg) {
  // Add class attribute and remove fixed width/height from the root SVG element
  // The viewBox will handle aspect ratio, CSS will handle sizing

  // Remove XML declaration if present
  svg = svg.replace(/<\?xml[^?]*\?>\s*/g, '')

  // Match the opening SVG tag
  const svgTagRegex = /<svg\s+([^>]*)>/
  const match = svg.match(svgTagRegex)

  if (!match) {
    console.warn('Warning: Could not find <svg> element')
    return svg
  }

  let attributes = match[1]

  // Remove width and height attributes (let CSS handle sizing)
  attributes = attributes.replace(/\s*width="[^"]*"/g, '')
  attributes = attributes.replace(/\s*height="[^"]*"/g, '')

  // Remove xmlns:xlink (not used), but keep xmlns for standalone SVG viewing
  attributes = attributes.replace(/\s*xmlns:xlink="[^"]*"/g, '')

  // Remove id and data-name (class is already added above)
  attributes = attributes.replace(/\s*id="[^"]*"/g, '')
  attributes = attributes.replace(/\s*data-name="[^"]*"/g, '')

  // Add class attribute
  if (attributes.includes('class="')) {
    // Append to existing class
    attributes = attributes.replace(
      /class="([^"]*)"/,
      `class="$1 ${BEM_BLOCK}__svg"`
    )
  } else {
    // Add new class attribute
    attributes = `class="${BEM_BLOCK}__svg" ${attributes}`
  }

  // Clean up any double spaces
  attributes = attributes.replace(/\s+/g, ' ').trim()

  return svg.replace(svgTagRegex, `<svg ${attributes}>`)
}

function processRegionGroup(svg, side, stats) {
  // Find the group for this side
  // Match: <g id="left"> or <g id="right">
  const groupRegex = new RegExp(`(<g id="${side}">)([\\s\\S]*?)(</g>)`, 'm')
  const groupMatch = svg.match(groupRegex)

  if (!groupMatch) {
    console.warn(`Warning: Could not find <g id="${side}"> group`)
    return svg
  }

  let groupContent = groupMatch[2]

  // Process each path in this group
  // Match path elements with id and data-name attributes
  const pathRegex =
    /<path\s+id="([^"]+)"(?:\s+data-name="([^"]+)")?\s+d="([^"]+)"([^>]*)\/>/g

  groupContent = groupContent.replace(
    pathRegex,
    (match, id, dataName, dPath, rest) => {
      stats.regionsProcessed++
      if (side === 'left') stats.leftRegions++
      if (side === 'right') stats.rightRegions++

      // Use data-name if available, otherwise convert id from snake_case
      const humanName = dataName || id.replace(/_/g, ' ').replace(/-\d+$/, '')

      // Create the id: side_snake_case_name
      // Remove any trailing -2, -3 etc from the id first
      const cleanId = id.replace(/-\d+$/, '')
      const regionId = `${side}_${cleanId}`

      // aria-label: "right upper inner" for sided regions, just "pre-sternal" for center
      const ariaLabel =
        humanName === 'pre-sternal' ? humanName : `${side} ${humanName}`

      // Build the new path element - minimal attributes
      // Use class instead of id for reusability (multiple diagrams on page)
      return `<path class="${regionId}" aria-label="${ariaLabel}" d="${dPath}"${rest}/>`
    }
  )

  // Also handle polygon elements if any exist
  const polygonRegex =
    /<polygon\s+id="([^"]+)"(?:\s+data-name="([^"]+)")?\s+points="([^"]+)"([^>]*)\/>/g

  groupContent = groupContent.replace(
    polygonRegex,
    (match, id, dataName, points, rest) => {
      stats.regionsProcessed++
      if (side === 'left') stats.leftRegions++
      if (side === 'right') stats.rightRegions++

      const humanName = dataName || id.replace(/_/g, ' ').replace(/-\d+$/, '')
      const cleanId = id.replace(/-\d+$/, '')
      const regionId = `${side}_${cleanId}`

      // aria-label: "right upper inner" for sided regions, just "pre-sternal" for center
      const ariaLabel =
        humanName === 'pre-sternal' ? humanName : `${side} ${humanName}`

      // Build the new polygon element - minimal attributes
      // Use class instead of id for reusability (multiple diagrams on page)
      return `<polygon class="${regionId}" aria-label="${ariaLabel}" points="${points}"${rest}/>`
    }
  )

  // Replace the group content in the SVG, using BEM class for the group
  const groupOpenTag = `<g class="${BEM_BLOCK}__regions-${side}">`
  svg = svg.replace(groupRegex, `${groupOpenTag}${groupContent}$3`)

  return svg
}

function wrapRegionsInContainer(svg) {
  // Find both left and right groups and wrap them in a container
  // We need to find where the groups are and wrap them

  // Match the left group (including its content) - uses BEM class
  const leftGroupRegex = /(\s*)(<g class="app-breast-diagram__regions-left"[^>]*>[\s\S]*?<\/g>)/m
  const rightGroupRegex = /(\s*)(<g class="app-breast-diagram__regions-right"[^>]*>[\s\S]*?<\/g>)/m

  const leftMatch = svg.match(leftGroupRegex)
  const rightMatch = svg.match(rightGroupRegex)

  if (!leftMatch || !rightMatch) {
    console.warn(
      'Warning: Could not find both left and right groups for wrapping'
    )
    return svg
  }

  // Check if already wrapped
  if (svg.includes(`class="${BEM_BLOCK}__regions"`)) {
    return svg
  }

  // Find the position of the first group (should be left or right)
  const leftIndex = svg.indexOf(leftMatch[2])
  const rightIndex = svg.indexOf(rightMatch[2])
  const firstIndex = Math.min(leftIndex, rightIndex)
  const lastIndex = Math.max(leftIndex, rightIndex)

  // Find where the last group ends
  const lastGroup = lastIndex === leftIndex ? leftMatch[2] : rightMatch[2]
  const endOfLastGroup = lastIndex + lastGroup.length

  // Get the indentation
  const indent = leftMatch[1] || '  '

  // Extract the region groups
  const beforeGroups = svg.substring(0, firstIndex)
  const regionGroups = svg.substring(firstIndex, endOfLastGroup)
  const afterGroups = svg.substring(endOfLastGroup)

  // Wrap with the container, adding indentation
  const indentedGroups = regionGroups
    .split('\n')
    .map((line) => indent + line)
    .join('\n')
  const wrappedGroups = `${indent}<g class="${BEM_BLOCK}__regions">\n${indentedGroups}\n${indent}</g>`

  return beforeGroups + wrappedGroups + afterGroups
}

function processOutlineGroup(svg) {
  // Find all breast and nipple outline elements and extract them
  // We want to flatten the nested structure into a single group with clip-path

  // Extract the clip-path URL from presentation attribute
  let clipPathUrl = '#clippath'
  const clipPathMatch = svg.match(/clip-path="url\(([^)]+)\)"/)
  if (clipPathMatch) {
    clipPathUrl = clipPathMatch[1]
  }

  // Find left side elements
  const leftBreastMatch = svg.match(
    /<path id="Breast_outline"([^>]*)d="([^"]+)"([^/]*)\/>/s
  )
  const leftNippleMatch = svg.match(/<circle id="Nipple_outline"([^>]*)\/>/s)

  // Find right side elements
  const rightBreastMatch = svg.match(
    /<path id="Breast_outline-2"([^>]*)d="([^"]+)"([^/]*)\/>/s
  )
  const rightNippleMatch = svg.match(/<circle id="Nipple_outline-2"([^>]*)\/>/s)

  if (
    !leftBreastMatch ||
    !leftNippleMatch ||
    !rightBreastMatch ||
    !rightNippleMatch
  ) {
    console.warn('Warning: Could not find all outline elements for flattening')
    svg = svg.replace(
      /<g id="diagram">/,
      `<g class="${BEM_BLOCK}__diagram">`
    )
    return svg
  }

  // Helper to strip data-name from captured attributes
  const stripDataName = (str) => str.replace(/\s*data-name="[^"]*"/g, '')

  // Helper to strip attributes that have no effect on circles (closed paths)
  const stripCircleOnlyAttrs = (str) =>
    str.replace(/\s*stroke-linecap="[^"]*"/g, '')
       .replace(/\s*stroke-miterlimit="[^"]*"/g, '')
       .replace(/\s*stroke-linejoin="[^"]*"/g, '')

  // Build the flattened structure - minimal attributes on children
  const flattenedDiagram = `<g class="${BEM_BLOCK}__diagram" clip-path="url(${clipPathUrl})">
      <path data-side="left" aria-label="left breast outline" vector-effect="non-scaling-stroke"${stripDataName(leftBreastMatch[1])}d="${leftBreastMatch[2]}"${stripDataName(leftBreastMatch[3])}/>
      <circle data-side="left" aria-label="left nipple outline" vector-effect="non-scaling-stroke"${stripCircleOnlyAttrs(stripDataName(leftNippleMatch[1]))}/>
      <path data-side="right" aria-label="right breast outline" vector-effect="non-scaling-stroke"${stripDataName(rightBreastMatch[1])}d="${rightBreastMatch[2]}"${stripDataName(rightBreastMatch[3])}/>
      <circle data-side="right" aria-label="right nipple outline" vector-effect="non-scaling-stroke"${stripCircleOnlyAttrs(stripDataName(rightNippleMatch[1]))}/>
    </g>`

  // Replace the entire diagram group structure
  // Match from <g id="diagram"> through all its nested closing </g> tags
  const outlineGroupRegex =
    /<g id="diagram">[\s\S]*?<\/g>\s*<\/g>\s*<\/g>\s*<\/g>/

  if (outlineGroupRegex.test(svg)) {
    svg = svg.replace(outlineGroupRegex, flattenedDiagram)
  } else {
    console.warn(
      'Warning: Could not match diagram group structure for replacement'
    )
  }

  return svg
}

function removeInlineStylesFromRegions(svg) {
  // Keep fill="none" (or style="fill: none;") on region elements
  // This ensures the SVG displays correctly when viewed standalone (e.g. on GitHub)
  // The regions should be transparent by default, with CSS adding hover states etc.
  // With presentation attributes export, fill="none" is used instead of inline styles
  return svg
}

function cleanupDefs(svg) {
  // Remove unnecessary id and data-name from elements in defs
  // The clippath rect doesn't need these attributes
  svg = svg.replace(
    /<rect id="container_outline" data-name="container outline"/g,
    '<rect'
  )
  return svg
}

// ============ Validation ============

function validateProcessedSvg(svg, stats) {
  const errors = []
  const warnings = []
  const EXPECTED_REGIONS_PER_SIDE = 19

  // Check regions exist
  if (stats.regionsProcessed === 0) {
    errors.push('No regions were processed')
  }

  // Check left and right have equal regions
  if (stats.leftRegions !== stats.rightRegions) {
    errors.push(
      `Unequal regions: ${stats.leftRegions} left vs ${stats.rightRegions} right`
    )
  }

  // Check for expected region count (warn only)
  if (stats.leftRegions !== EXPECTED_REGIONS_PER_SIDE) {
    warnings.push(
      `Expected ${EXPECTED_REGIONS_PER_SIDE} regions per side, got ${stats.leftRegions}`
    )
  }

  // Check breast outlines exist for each side (identified by data-side within diagram group)
  const leftBreastOutline = svg.match(
    /class="app-breast-diagram__diagram"[^>]*>[\s\S]*?<path[^>]*data-side="left"/
  )
  const rightBreastOutline = svg.match(
    /class="app-breast-diagram__diagram"[^>]*>[\s\S]*?<path[^>]*data-side="right"/
  )
  if (!leftBreastOutline) {
    errors.push('Missing left breast outline')
  }
  if (!rightBreastOutline) {
    errors.push('Missing right breast outline')
  }

  // Check nipple outlines exist for each side
  const leftNippleOutline = svg.match(
    /class="app-breast-diagram__diagram"[^>]*>[\s\S]*?<circle[^>]*data-side="left"/
  )
  const rightNippleOutline = svg.match(
    /class="app-breast-diagram__diagram"[^>]*>[\s\S]*?<circle[^>]*data-side="right"/
  )
  if (!leftNippleOutline) {
    errors.push('Missing left nipple outline')
  }
  if (!rightNippleOutline) {
    errors.push('Missing right nipple outline')
  }

  // Check root SVG has viewBox
  if (!svg.match(/<svg[^>]*viewBox=/)) {
    errors.push('SVG missing viewBox attribute')
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings
  }
}

function addProcessedComment(svg) {
  // Add a comment indicating this file was processed
  const comment =
    '<!-- Processed by process-exported-svg.js - do not edit manually -->\n\n'

  // Insert at the start (XML declaration already removed)
  return comment + svg
}
