// reference/breast-diagram/process-svg.js
//
// Processes the exported SVG from Illustrator to add required data attributes
// and clean up for use in the breast features component.
//
// Usage: node process-svg.js <input-file.svg>
// Output: Creates <input-file>-processed.svg in the same directory

const fs = require('fs')
const path = require('path')

// BEM block name - the SVG elements are all children of this block
const BEM_BLOCK = 'app-breast-diagram'

// Get input file from command line
const inputFile = process.argv[2]

if (!inputFile) {
  console.error('Usage: node process-svg.js <input-file.svg>')
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

  // Remove inline styles from region paths (fill: none will be handled by CSS)
  svg = removeInlineStylesFromRegions(svg)

  // Clean up the XML declaration and add a comment
  svg = addProcessedComment(svg)

  console.log(
    `Processed ${stats.regionsProcessed} regions (${stats.leftRegions} left, ${stats.rightRegions} right)`
  )

  return svg
}

function processSvgElement(svg) {
  // Add class attribute and remove fixed width/height from the root SVG element
  // The viewBox will handle aspect ratio, CSS will handle sizing

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

      // Create the data-key: side_snake_case_name
      // Remove any trailing -2, -3 etc from the id first
      const cleanId = id.replace(/-\d+$/, '')
      const dataKey = `${side}_${cleanId}`

      // Build the new path element
      return `<path class="${BEM_BLOCK}__region" data-name="${humanName}" data-key="${dataKey}" data-side="${side}" d="${dPath}"${rest}/>`
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
      const dataKey = `${side}_${cleanId}`

      return `<polygon class="${BEM_BLOCK}__region" data-name="${humanName}" data-key="${dataKey}" data-side="${side}" points="${points}"${rest}/>`
    }
  )

  // Replace the group content in the SVG
  svg = svg.replace(groupRegex, `$1${groupContent}$3`)

  return svg
}

function wrapRegionsInContainer(svg) {
  // Find both left and right groups and wrap them in a container
  // We need to find where the groups are and wrap them

  // Match the left group (including its content)
  const leftGroupRegex = /(\s*)(<g id="left">[\s\S]*?<\/g>)/m
  const rightGroupRegex = /(\s*)(<g id="right">[\s\S]*?<\/g>)/m

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

function removeInlineStylesFromRegions(svg) {
  // Remove style="fill: none;" from region elements
  // This will be handled by CSS instead
  return svg.replace(
    /(<[^>]*class="[^"]*__region"[^>]*)\s+style="[^"]*fill:\s*none;?[^"]*"([^>]*>)/g,
    '$1$2'
  )
}

function addProcessedComment(svg) {
  // Add a comment indicating this file was processed
  const comment =
    '<!-- Processed by process-svg.js - do not edit manually -->\n'

  // Insert after the XML declaration if present, otherwise at the start
  if (svg.startsWith('<?xml')) {
    const endOfDeclaration = svg.indexOf('?>') + 2
    return (
      svg.substring(0, endOfDeclaration) +
      '\n' +
      comment +
      svg.substring(endOfDeclaration)
    )
  } else {
    return comment + svg
  }
}
