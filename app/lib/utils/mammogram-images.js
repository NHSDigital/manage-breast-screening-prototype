// app/lib/utils/mammogram-images.js

const path = require('path')
const fs = require('fs')
const config = require('../../config')

// Image sources
const IMAGE_SOURCES = {
  diagrams: 'mammogram-diagrams',
  real: 'mammogram-sets'
}

// Standard view names
const VIEWS = ['rcc', 'lcc', 'rmlo', 'lmlo']

// Path to assets folder
const ASSETS_PATH = path.join(__dirname, '../../assets/images')

// Default tag weights if not configured
const DEFAULT_TAG_WEIGHTS = {
  normal: 0.75,
  abnormal: 0.15,
  indeterminate: 0.05,
  technical: 0.05
}

// Adjusted weights when participant has symptoms
const SYMPTOM_WEIGHTS = {
  normal: 0.3,
  abnormal: 0.5,
  indeterminate: 0.1,
  technical: 0.1
}

// Adjusted weights when images are marked as imperfect
const IMPERFECT_WEIGHTS = {
  normal: 0.1,
  abnormal: 0.1,
  indeterminate: 0,
  technical: 0.8
}

// Adjusted weights when both symptoms and imperfect images
const SYMPTOM_AND_IMPERFECT_WEIGHTS = {
  normal: 0.15,
  abnormal: 0.35,
  indeterminate: 0.05,
  technical: 0.45
}

/**
 * Simple seeded random number generator
 * Returns a number between 0 and 1 based on the seed
 */
const seededRandom = (seed) => {
  let numericSeed
  if (typeof seed === 'string') {
    numericSeed = seed.split('').reduce((acc, char, i) => {
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
 * Extract context flags from event data for smart set selection
 * @param {object} event - The event object
 * @returns {object} - Context flags: hasSymptoms, symptomSides, hasImplants, isImperfect, hasRepeat, hasExtraImages, repeatViews
 */
const extractEventContext = (event) => {
  if (!event) return {}

  const context = {
    hasSymptoms: false,
    symptomSides: [], // "left", "right", or both
    hasImplants: false,
    isImperfect: false,
    hasRepeat: false,
    hasExtraImages: false,
    repeatViews: [] // Which views have repeats (e.g., ['rmlo', 'lcc'])
  }

  // Check for symptoms
  const symptoms = event.medicalInformation?.symptoms || []
  if (symptoms.length > 0) {
    context.hasSymptoms = true

    // Extract sides from symptoms
    const sides = new Set()
    for (const symptom of symptoms) {
      // Check location field (most symptom types)
      if (symptom.location) {
        if (
          symptom.location === 'left breast' ||
          symptom.location === 'both breasts'
        ) {
          sides.add('left')
        }
        if (
          symptom.location === 'right breast' ||
          symptom.location === 'both breasts'
        ) {
          sides.add('right')
        }
      }
      // Check nippleChangeLocation (nipple symptoms)
      if (symptom.nippleChangeLocation) {
        for (const loc of symptom.nippleChangeLocation) {
          if (loc === 'left nipple') sides.add('left')
          if (loc === 'right nipple') sides.add('right')
        }
      }
    }
    context.symptomSides = Array.from(sides)
  }

  // Check for breast implants (array with items means has implants)
  const implants =
    event.medicalInformation?.medicalHistory?.breastImplantsAugmentation || []
  if (implants.length > 0) {
    // Check if implants have been removed
    const hasActiveImplants = implants.some(
      (implant) => !implant.hasBeenRemoved
    )
    context.hasImplants = hasActiveImplants
  }

  // Check for imperfect images
  // Value can be array ['yes'] or string 'yes' depending on source
  const imperfectValue = event.mammogramData?.isImperfectButBestPossible
  if (
    imperfectValue === 'yes' ||
    (Array.isArray(imperfectValue) && imperfectValue.includes('yes'))
  ) {
    context.isImperfect = true
  }

  // Check for repeat/retake images (technical issues)
  if (event.mammogramData?.metadata?.hasRepeat) {
    context.hasRepeat = true

    // Extract which views have repeats
    const views = event.mammogramData?.views
    if (views) {
      for (const [viewKey, viewData] of Object.entries(views)) {
        if (viewData.repeatCount > 0) {
          // Convert viewShortWithSide (e.g., "RMLO") to lowercase (e.g., "rmlo")
          const viewCode = viewData.viewShortWithSide?.toLowerCase()
          if (viewCode) {
            context.repeatViews.push(viewCode)
          }
        }
      }
    }
  }

  // Check for extra images (large breasts - not a problem)
  if (event.mammogramData?.metadata?.hasExtraImages) {
    context.hasExtraImages = true
  }

  return context
}

/**
 * Get appropriate tag weights based on event context
 * @param {object} context - Context from extractEventContext
 * @param {object} configWeights - Weights from config (optional override)
 * @returns {object} - Tag weights
 */
const getContextualWeights = (context, configWeights) => {
  // If no context flags, use config or defaults
  if (!context.hasSymptoms && !context.isImperfect) {
    return (
      configWeights ||
      config.reading?.mammogramTagWeights ||
      DEFAULT_TAG_WEIGHTS
    )
  }

  // Both symptoms and imperfect
  if (context.hasSymptoms && context.isImperfect) {
    return SYMPTOM_AND_IMPERFECT_WEIGHTS
  }

  // Just symptoms
  if (context.hasSymptoms) {
    return SYMPTOM_WEIGHTS
  }

  // Just imperfect
  if (context.isImperfect) {
    return IMPERFECT_WEIGHTS
  }

  return configWeights || DEFAULT_TAG_WEIGHTS
}

/**
 * Check if a set has multiple images for a specific view
 * @param {object} set - The set object
 * @param {string} view - The view name (e.g., 'rmlo', 'lcc')
 * @returns {boolean} - True if the view has multiple images
 */
const setHasMultipleImagesForView = (set, view) => {
  if (!set.views || !set.views[view]) return false
  return Array.isArray(set.views[view])
}

/**
 * Filter sets based on hard constraints (e.g., implants, repeats, extra images)
 * @param {array} sets - Available sets
 * @param {object} context - Context from extractEventContext
 * @returns {array} - Filtered sets
 */
const filterSetsByContext = (sets, context) => {
  return sets.filter((set) => {
    // Implants: must match
    if (context.hasImplants) {
      // If participant has implants, only use implant sets
      if (set.hasImplants !== true) return false
    } else {
      // If participant doesn't have implants, exclude implant sets
      if (set.hasImplants) return false
    }

    // Extra images (large breasts): must match
    if (context.hasExtraImages) {
      // If event has extra images, only use extra image sets
      if (set.hasExtraImages !== true) return false
    } else {
      // If event doesn't have extra images, exclude extra image sets
      if (set.hasExtraImages) return false
    }

    // Technical repeats: must match
    if (context.hasRepeat) {
      // If event has repeat images, only use repeat sets
      if (set.hasRepeat !== true) return false

      // Additionally, prefer sets that match the specific views with repeats
      // Check if the set has repeats on at least one of the same views
      if (context.repeatViews && context.repeatViews.length > 0) {
        const hasMatchingView = context.repeatViews.some((view) =>
          setHasMultipleImagesForView(set, view)
        )
        // If no matching views, still allow but deprioritise (handled by scoring later)
        // For now, just filter to matching if available
        if (!hasMatchingView) {
          // Check if ANY sets match - if not, allow this one
          // We'll handle this in the scoring phase instead of hard filtering
        }
      }
    } else {
      // If event doesn't have repeats, exclude repeat sets
      if (set.hasRepeat) return false
    }

    return true
  })
}

/**
 * Score sets by how well they match the repeat views context
 * Higher score = better match
 * @param {array} sets - Sets to score
 * @param {object} context - Context from extractEventContext
 * @returns {array} - Sets with scores attached
 */
const scoreSetsForRepeatMatch = (sets, context) => {
  if (!context.repeatViews || context.repeatViews.length === 0) {
    return sets.map((set) => ({ ...set, _matchScore: 0 }))
  }

  return sets.map((set) => {
    let score = 0
    for (const view of context.repeatViews) {
      if (setHasMultipleImagesForView(set, view)) {
        score += 1
      }
    }
    return { ...set, _matchScore: score }
  })
}

/**
 * Apply side preference when selecting from abnormal sets
 * @param {array} sets - Sets to choose from (already filtered to abnormal tag)
 * @param {array} symptomSides - Sides with symptoms ("left", "right")
 * @param {number} randomValue - Seeded random value
 * @returns {array} - Potentially filtered sets with side preference
 */
const applySidePreference = (sets, symptomSides, randomValue) => {
  if (!symptomSides || symptomSides.length === 0) {
    return sets
  }

  // 70% chance to prefer matching side
  if (randomValue > 0.7) {
    return sets // Don't apply preference
  }

  // Filter to sets that have abnormality on the symptom side
  const matchingSets = sets.filter((set) => {
    for (const side of symptomSides) {
      if (side === 'left' && set.left?.status === 'abnormal') return true
      if (side === 'right' && set.right?.status === 'abnormal') return true
    }
    return false
  })

  // Return matching sets if any, otherwise fall back to all sets
  return matchingSets.length > 0 ? matchingSets : sets
}

/**
 * Get the manifest for an image source
 * @param {string} source - "diagrams" or "real"
 * @returns {object|null} - The manifest object or null if not found
 */
const getManifest = (source = 'diagrams') => {
  const sourceFolder = IMAGE_SOURCES[source]
  if (!sourceFolder) return null

  const manifestPath = path.join(ASSETS_PATH, sourceFolder, 'manifest.json')

  try {
    const manifestContent = fs.readFileSync(manifestPath, 'utf8')
    return JSON.parse(manifestContent)
  } catch (error) {
    // Manifest doesn't exist or is invalid
    return null
  }
}

/**
 * Get list of available image sets for a source
 * @param {string} source - "diagrams" or "real"
 * @param {object} options - Optional filtering options
 * @param {boolean} options.includeDisabled - Include disabled sets (default: false)
 * @returns {Array} - Array of set objects with id, tag, description
 */
const getAvailableSets = (source = 'diagrams', options = {}) => {
  const manifest = getManifest(source)
  if (manifest && manifest.sets) {
    if (options.includeDisabled) {
      return manifest.sets
    }
    return manifest.sets.filter((set) => !set.disabled)
  }
  return []
}

/**
 * Select an image set for an event using seeded random with weighted tag distribution
 * Returns the same set for the same eventId
 * @param {string} eventId - The event ID to use as seed
 * @param {string} source - "diagrams" or "real"
 * @param {object} options - Optional filtering options
 * @param {string} options.tag - Force a specific tag (bypasses weighted selection)
 * @param {object} options.weights - Override tag weights (e.g., { normal: 0.8, abnormal: 0.2 })
 * @param {object} options.event - Event object for context-aware selection
 * @param {object} options.context - Context object directly (alternative to passing event)
 * @returns {object|null} - The selected set object or null if none available
 */
const getImageSetForEvent = (eventId, source = 'diagrams', options = {}) => {
  let allSets = getAvailableSets(source)
  if (allSets.length === 0) return null

  // Use provided context, or extract from event if provided
  const context =
    options.context || (options.event ? extractEventContext(options.event) : {})

  // Apply hard filters based on context (e.g., implants)
  if (Object.keys(context).length > 0) {
    allSets = filterSetsByContext(allSets, context)
    if (allSets.length === 0) {
      // If no sets match after filtering, fall back to unfiltered
      allSets = getAvailableSets(source)
    }
  }

  // Use seeded random for consistent selection
  const randomValue = seededRandom(eventId)

  // If a specific tag is forced, filter to that tag
  if (options.tag) {
    const filteredSets = allSets.filter((set) => set.tag === options.tag)
    if (filteredSets.length > 0) {
      const index = Math.floor(randomValue * filteredSets.length)
      return filteredSets[index]
    }
    // Fall through to weighted selection if no sets match
  }

  // Get tag weights - use contextual weights if event provided, otherwise config/options
  const weights =
    options.weights ||
    getContextualWeights(context, config.reading?.mammogramTagWeights)

  // Group sets by tag
  const setsByTag = {}
  for (const set of allSets) {
    const tag = set.tag || 'normal'
    if (!setsByTag[tag]) {
      setsByTag[tag] = []
    }
    setsByTag[tag].push(set)
  }

  // Build cumulative weight ranges for available tags
  const availableTags = Object.keys(setsByTag)
  let cumulativeWeight = 0
  const tagRanges = []

  for (const tag of availableTags) {
    const weight = weights[tag] || 0
    if (weight > 0) {
      tagRanges.push({
        tag,
        start: cumulativeWeight,
        end: cumulativeWeight + weight
      })
      cumulativeWeight += weight
    }
  }

  // Normalise if total weight doesn't equal 1
  if (cumulativeWeight > 0 && cumulativeWeight !== 1) {
    for (const range of tagRanges) {
      range.start /= cumulativeWeight
      range.end /= cumulativeWeight
    }
  }

  // Select tag based on random value
  let selectedTag = availableTags[0] // fallback
  for (const range of tagRanges) {
    if (randomValue >= range.start && randomValue < range.end) {
      selectedTag = range.tag
      break
    }
  }

  // Select a set from the chosen tag
  let setsForTag = setsByTag[selectedTag]
  if (!setsForTag || setsForTag.length === 0) {
    // Fallback to any available set
    const index = Math.floor(randomValue * allSets.length)
    return allSets[index]
  }

  // Apply side preference for abnormal sets when symptoms present
  if (selectedTag === 'abnormal' && context.symptomSides?.length > 0) {
    const sideRandomValue = seededRandom(eventId + 'side')
    setsForTag = applySidePreference(
      setsForTag,
      context.symptomSides,
      sideRandomValue
    )
  }

  // Apply repeat view scoring if we have specific views that were repeated
  if (context.hasRepeat && context.repeatViews?.length > 0) {
    const scoredSets = scoreSetsForRepeatMatch(setsForTag, context)
    const maxScore = Math.max(...scoredSets.map((s) => s._matchScore))

    // Prefer sets with the highest match score (70% of the time)
    const repeatRandomValue = seededRandom(eventId + 'repeat')
    if (maxScore > 0 && repeatRandomValue < 0.7) {
      setsForTag = scoredSets.filter((s) => s._matchScore === maxScore)
    }
  }

  // Use a second seeded random to pick within the tag
  // (different seed to avoid correlation with tag selection)
  const setRandomValue = seededRandom(eventId + selectedTag)
  const index = Math.floor(setRandomValue * setsForTag.length)
  return setsForTag[index]
}

/**
 * Get the path for a single image from the image library
 * @param {string} imageId - The image ID from the library
 * @param {string} source - "diagrams" or "real"
 * @returns {string|null} - The image path or null if not found
 */
const getImageLibraryPath = (imageId, source = 'diagrams') => {
  const sourceFolder = IMAGE_SOURCES[source]
  if (!sourceFolder) return null

  // Image library items are stored in an 'image-library' subfolder
  return `/images/${sourceFolder}/image-library/${imageId}.png`
}

/**
 * Get a set by ID from the manifest
 * @param {string} setId - The set ID
 * @param {string} source - "diagrams" or "real"
 * @returns {object|null} - The set object or null
 */
const getSetById = (setId, source = 'diagrams') => {
  const manifest = getManifest(source)
  if (!manifest || !manifest.sets) return null
  return manifest.sets.find((s) => s.id === setId) || null
}

/**
 * Resolve a single view definition to a path
 * @param {object} viewDef - View definition (e.g., { image: "blur-rmlo" } or { from: "set-17" })
 * @param {string} view - The view name (rcc, lcc, rmlo, lmlo)
 * @param {string} source - "diagrams" or "real"
 * @returns {string|null} - The resolved path or null
 */
const resolveViewPath = (viewDef, view, source) => {
  if (!viewDef) return null

  if (viewDef.image) {
    // Reference to image library
    return getImageLibraryPath(viewDef.image, source)
  } else if (viewDef.from) {
    // Reference to another set - recursively get that set's path for this view
    const referencedPaths = getImagePaths(viewDef.from, source)
    // Handle case where referenced set has multiple images for this view
    const refPath = referencedPaths ? referencedPaths[view] : null
    // If it's an array, return the last (latest) image
    return Array.isArray(refPath) ? refPath[refPath.length - 1] : refPath
  }

  return null
}

/**
 * Get image paths for a specific set, resolving composite sets
 * Supports arrays of images per view (for repeats/retakes)
 * @param {string} setId - The set ID (e.g., "set-01")
 * @param {string} source - "diagrams" or "real"
 * @returns {object} - Object with paths for each view. Path can be string or array of strings.
 */
const getImagePaths = (setId, source = 'diagrams') => {
  const sourceFolder = IMAGE_SOURCES[source]
  if (!sourceFolder) return null

  const set = getSetById(setId, source)

  // Check if this is a composite set (has views object with from/image references)
  if (set && set.views) {
    const paths = {}

    for (const view of VIEWS) {
      const viewDef = set.views[view]

      if (!viewDef) {
        // No definition for this view
        paths[view] = null
      } else if (Array.isArray(viewDef)) {
        // Multiple images for this view (e.g., retakes)
        // Array order: first attempt first, latest/best last
        paths[view] = viewDef.map((def) => resolveViewPath(def, view, source))
      } else {
        // Single image
        paths[view] = resolveViewPath(viewDef, view, source)
      }
    }

    return paths
  }

  // Standard set - images stored in set folder
  const basePath = `/images/${sourceFolder}/${setId}`

  // Try to detect file extension by checking what exists
  const setFolderPath = path.join(ASSETS_PATH, sourceFolder, setId)
  let extension = 'png' // default

  try {
    const files = fs.readdirSync(setFolderPath)
    // Check first view file to determine extension
    const rccFile = files.find((f) => f.startsWith('rcc.'))
    if (rccFile) {
      extension = rccFile.split('.').pop()
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
 * Map from internal view names to mammogramData.views property names
 */
const VIEW_TO_MAMMOGRAM_DATA_KEY = {
  rcc: 'rightCraniocaudal',
  lcc: 'leftCraniocaudal',
  rmlo: 'rightMediolateralOblique',
  lmlo: 'leftMediolateralOblique'
}

/**
 * Get the latest image path for a view (handles both string and array)
 * @param {string|array} pathOrPaths - Single path or array of paths
 * @returns {string|null} - The latest (last) image path
 */
const getLatestPath = (pathOrPaths) => {
  if (!pathOrPaths) return null
  if (Array.isArray(pathOrPaths)) {
    return pathOrPaths[pathOrPaths.length - 1]
  }
  return pathOrPaths
}

/**
 * Get image paths for an event (convenience function)
 * Combines getImageSetForEvent and getImagePaths
 * Filters paths based on which views are present in the event's mammogram data
 * Returns both latest paths (for default display) and all paths (for additional images)
 * @param {string} eventId - The event ID
 * @param {string} source - "diagrams" or "real"
 * @param {object} options - Options passed to getImageSetForEvent
 * @returns {object|null} - Object with set info, paths, allPaths, and hasAdditionalImages flag
 */
const getImagesForEvent = (eventId, source = 'diagrams', options = {}) => {
  const set = getImageSetForEvent(eventId, source, options)
  if (!set) return null

  const rawPaths = getImagePaths(set.id, source)

  // Filter paths based on which views are present in the event's mammogram data
  const event = options.event
  const mammogramViews = event?.mammogramData?.views || {}

  // If no event provided, return all paths (backwards compatibility)
  if (!event) {
    // Check if any view has multiple images
    let hasAdditionalImages = false
    const paths = {}
    for (const view of VIEWS) {
      if (Array.isArray(rawPaths[view])) {
        hasAdditionalImages = true
        paths[view] = getLatestPath(rawPaths[view])
      } else {
        paths[view] = rawPaths[view]
      }
    }

    return {
      set,
      paths,
      allPaths: rawPaths,
      hasAdditionalImages
    }
  }

  const paths = {}
  const allPaths = {}
  let hasAdditionalImages = false

  // Check if event metadata indicates repeats exist
  // This covers cases where the set's paths don't align with event's repeat views
  if (event.mammogramData?.metadata?.hasRepeat) {
    hasAdditionalImages = true
  }

  for (const view of VIEWS) {
    const mammogramDataKey = VIEW_TO_MAMMOGRAM_DATA_KEY[view]
    // Only include path if this view was captured
    if (mammogramViews[mammogramDataKey]) {
      const rawPath = rawPaths[view]

      if (Array.isArray(rawPath)) {
        hasAdditionalImages = true
        paths[view] = getLatestPath(rawPath)
        allPaths[view] = rawPath
      } else {
        paths[view] = rawPath
        allPaths[view] = rawPath
      }
    }
  }

  return {
    set,
    paths,
    allPaths,
    hasAdditionalImages
  }
}

/**
 * Check if an image source has any available sets
 * @param {string} source - "diagrams" or "real"
 * @returns {boolean}
 */
const hasImageSets = (source = 'diagrams') => {
  return getAvailableSets(source).length > 0
}

module.exports = {
  IMAGE_SOURCES,
  VIEWS,
  getManifest,
  getAvailableSets,
  getSetById,
  getImageSetForEvent,
  getImagePaths,
  getImageLibraryPath,
  getImagesForEvent,
  hasImageSets,
  extractEventContext
}
