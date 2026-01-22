// app/lib/utils/mammogram-images.js

const path = require("path")
const fs = require("fs")

// Image sources
const IMAGE_SOURCES = {
  diagrams: "mammogram-diagrams",
  real: "mammogram-sets"
}

// Standard view names
const VIEWS = ["rcc", "lcc", "rmlo", "lmlo"]

// Path to assets folder
const ASSETS_PATH = path.join(__dirname, "../../assets/images")

/**
 * Simple seeded random number generator
 * Returns a number between 0 and 1 based on the seed
 */
const seededRandom = (seed) => {
  let numericSeed
  if (typeof seed === "string") {
    numericSeed = seed.split("").reduce((acc, char, i) => {
      return acc + char.charCodeAt(0) * (i + 1)
    }, 0)
  } else {
    numericSeed = seed
  }

  const m = 2147483647
  const a = 1103515245
  const c = 12345

  let state = numericSeed || 1
  state = (a * state + c) % m
  return state / m
}

/**
 * Get the manifest for an image source
 * @param {string} source - "diagrams" or "real"
 * @returns {object|null} - The manifest object or null if not found
 */
const getManifest = (source = "diagrams") => {
  const sourceFolder = IMAGE_SOURCES[source]
  if (!sourceFolder) return null

  const manifestPath = path.join(ASSETS_PATH, sourceFolder, "manifest.json")

  try {
    const manifestContent = fs.readFileSync(manifestPath, "utf8")
    return JSON.parse(manifestContent)
  } catch (error) {
    // Manifest doesn't exist or is invalid
    return null
  }
}

/**
 * Get list of available image sets for a source
 * @param {string} source - "diagrams" or "real"
 * @returns {Array} - Array of set objects with id, tag, description
 */
const getAvailableSets = (source = "diagrams") => {
  const manifest = getManifest(source)
  if (manifest && manifest.sets) {
    return manifest.sets
  }
  return []
}

/**
 * Select an image set for an event using seeded random
 * Returns the same set for the same eventId
 * @param {string} eventId - The event ID to use as seed
 * @param {string} source - "diagrams" or "real"
 * @param {object} options - Optional filtering options
 * @param {string} options.tag - Filter to sets with this tag (normal/abnormal/technical)
 * @returns {object|null} - The selected set object or null if none available
 */
const getImageSetForEvent = (eventId, source = "diagrams", options = {}) => {
  let sets = getAvailableSets(source)

  if (sets.length === 0) return null

  // Filter by tag if specified
  if (options.tag) {
    const filteredSets = sets.filter(set => set.tag === options.tag)
    if (filteredSets.length > 0) {
      sets = filteredSets
    }
    // If no sets match the tag, fall back to all sets
  }

  // Use seeded random to pick a set
  const randomValue = seededRandom(eventId)
  const index = Math.floor(randomValue * sets.length)

  return sets[index]
}

/**
 * Get image paths for a specific set
 * @param {string} setId - The set ID (e.g., "set-01")
 * @param {string} source - "diagrams" or "real"
 * @returns {object} - Object with paths for each view (rcc, lcc, rmlo, lmlo)
 */
const getImagePaths = (setId, source = "diagrams") => {
  const sourceFolder = IMAGE_SOURCES[source]
  if (!sourceFolder) return null

  const basePath = `/images/${sourceFolder}/${setId}`

  // Try to detect file extension by checking what exists
  const setFolderPath = path.join(ASSETS_PATH, sourceFolder, setId)
  let extension = "png" // default

  try {
    const files = fs.readdirSync(setFolderPath)
    // Check first view file to determine extension
    const rccFile = files.find(f => f.startsWith("rcc."))
    if (rccFile) {
      extension = rccFile.split(".").pop()
    }
  } catch (error) {
    // Folder doesn't exist, use default extension
  }

  const paths = {}
  for (const view of VIEWS) {
    paths[view] = `${basePath}/${view}.${extension}`
  }

  return paths
}

/**
 * Get image paths for an event (convenience function)
 * Combines getImageSetForEvent and getImagePaths
 * @param {string} eventId - The event ID
 * @param {string} source - "diagrams" or "real"
 * @param {object} options - Options passed to getImageSetForEvent
 * @returns {object|null} - Object with set info and paths, or null if no sets available
 */
const getImagesForEvent = (eventId, source = "diagrams", options = {}) => {
  const set = getImageSetForEvent(eventId, source, options)
  if (!set) return null

  const paths = getImagePaths(set.id, source)

  return {
    set,
    paths
  }
}

/**
 * Check if an image source has any available sets
 * @param {string} source - "diagrams" or "real"
 * @returns {boolean}
 */
const hasImageSets = (source = "diagrams") => {
  return getAvailableSets(source).length > 0
}

module.exports = {
  IMAGE_SOURCES,
  VIEWS,
  getManifest,
  getAvailableSets,
  getImageSetForEvent,
  getImagePaths,
  getImagesForEvent,
  hasImageSets
}
