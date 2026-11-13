// app/lib/real-images.js
//
// Reads a real image pack: de-identified mammograms as JPEGs, with a
// manifest.json describing participants, studies and cases. The pack lives
// outside app/assets and public, which the prototype kit serves before the
// password check, and its images are served by the /real-images/ route in
// app/routes.js. See docs/mammogram-images.md.
//
// Not in app/lib/utils, so none of this becomes a Nunjucks filter. Pages get
// real images through the helpers in app/lib/utils/mammogram-images.js.

const fs = require('fs')
const path = require('path')
const config = require('../config')

const STANDARD_VIEWS = ['rcc', 'lcc', 'rmlo', 'lmlo']

// The URL the route serves a pack's images/ folder at
const URL_PREFIX = '/real-images/'

// Only images are served, whatever else ends up in the images folder
const SERVABLE_EXTENSIONS = ['.jpg', '.jpeg', '.png']

const getPackPath = () => config.paths.realImages

const readJson = (filePath) => JSON.parse(fs.readFileSync(filePath, 'utf8'))

const getModifiedTime = (filePath) => {
  try {
    return fs.statSync(filePath).mtimeMs
  } catch (error) {
    return null
  }
}

/**
 * The URL a page uses for a file in the pack
 *
 * @param {string} packFile - Path from the manifest, eg "images/p-…/s-…/i-…-display.jpg"
 * @returns {string} URL under /real-images/
 */
const getImageUrl = (packFile) => URL_PREFIX + packFile.replace(/^images\//, '')

/**
 * A study's standard views, in the shape image sets use: a URL per view, or
 * an array of URLs ordered by instance when the view was taken more than once.
 * Assessment views (spot compression and so on) and C-View images are left out
 * unless they are all there is for a view.
 *
 * @param {object} study - Study from the manifest
 * @returns {{ paths: object, imageViewKeys: Map<string, string> }} Paths per
 *   view, and the view key (eg "rmlo" or "rmlo-2") for each image ID, used to
 *   place annotations
 */
const getStudyViews = (study) => {
  const paths = {}
  const imageViewKeys = new Map()

  for (const view of STANDARD_VIEWS) {
    const viewImages = study.images.filter(
      (image) => image.view === view && image.files?.display
    )
    const plainImages = viewImages.filter(
      (image) => !image.synthetic2D && !image.modifiers?.length
    )
    const images = (plainImages.length ? plainImages : viewImages).sort(
      (a, b) => a.instance - b.instance
    )

    if (images.length === 0) {
      paths[view] = null
    } else if (images.length === 1) {
      paths[view] = getImageUrl(images[0].files.display)
      imageViewKeys.set(images[0].id, view)
    } else {
      paths[view] = images.map((image) => getImageUrl(image.files.display))
      images.forEach((image, index) =>
        imageViewKeys.set(image.id, `${view}-${index + 1}`)
      )
    }
  }

  return { paths, imageViewKeys }
}

/**
 * A study's hand-made annotations, with positions keyed by view rather than
 * image ID, as the reading pages use them
 *
 * @param {Array} annotations - The study's entries from annotations.json
 * @param {Map<string, string>} imageViewKeys - From getStudyViews
 * @returns {Array} Annotations
 */
const getStudyAnnotations = (annotations = [], imageViewKeys) =>
  annotations.map((annotation) => {
    const positions = {}
    for (const [imageId, position] of Object.entries(
      annotation.positions || {}
    )) {
      const viewKey = imageViewKeys.get(imageId)
      if (viewKey) positions[viewKey] = position
    }
    return { ...annotation, positions }
  })

/**
 * Turn the pack's cases into image sets, the shape the diagram manifest uses,
 * so the existing selection code can choose between them. Cases with no known
 * outcome, excluded studies and studies with no standard views are left out.
 *
 * @param {object} manifest - The pack's manifest.json
 * @param {object} annotations - The pack's annotations.json
 * @param {object} curation - The pack's curation.json
 * @returns {Array} Image sets
 */
const buildSets = (manifest, annotations, curation) => {
  const studiesById = new Map()
  for (const participant of manifest.participants || []) {
    for (const study of participant.studies || []) {
      studiesById.set(study.id, study)
    }
  }

  return (manifest.cases || [])
    .filter((readingCase) => readingCase.tag !== 'unknown')
    .filter(
      (readingCase) => !curation.studies?.[readingCase.currentStudyId]?.exclude
    )
    .map((readingCase) => {
      const study = studiesById.get(readingCase.currentStudyId)
      if (!study) return null

      const { paths, imageViewKeys } = getStudyViews(study)
      if (!STANDARD_VIEWS.some((view) => paths[view])) return null

      return {
        id: readingCase.id,
        tag: readingCase.tag,
        description: `Real images, ${readingCase.result}`,
        right: readingCase.right,
        left: readingCase.left,
        hasRepeat: STANDARD_VIEWS.some((view) => Array.isArray(paths[view])),
        hasImplants: readingCase.hasImplants,
        higherRisk: readingCase.higherRisk,
        participantId: readingCase.participantId,
        currentStudyId: readingCase.currentStudyId,
        priorStudyIds: readingCase.priorStudyIds,
        result: readingCase.result,
        ageAtCurrent: readingCase.ageAtCurrent,
        paths,
        annotations: getStudyAnnotations(
          annotations.studies?.[readingCase.currentStudyId],
          imageViewKeys
        )
      }
    })
    .filter(Boolean)
}

// The pack as last read, rebuilt when manifest.json or annotations.json change
let cache = { key: null, manifest: null }

/**
 * The pack's cases as an image set manifest ({ sets }), or null when there's
 * no pack or its manifest can't be read. The same object is returned until the
 * pack's files change.
 *
 * @returns {object|null} Manifest with a sets array
 */
const getManifest = () => {
  const packPath = getPackPath()
  const manifestPath = path.join(packPath, 'manifest.json')
  const annotationsPath = path.join(packPath, 'annotations.json')
  const curationPath = path.join(packPath, 'curation.json')

  const manifestTime = getModifiedTime(manifestPath)
  if (manifestTime === null) return null

  const key = [
    packPath,
    manifestTime,
    getModifiedTime(annotationsPath),
    getModifiedTime(curationPath)
  ].join('|')
  if (cache.key === key) return cache.manifest

  let manifest = null
  try {
    const packManifest = readJson(manifestPath)
    const annotations = fs.existsSync(annotationsPath)
      ? readJson(annotationsPath)
      : {}
    const curation = fs.existsSync(curationPath) ? readJson(curationPath) : {}
    manifest = { sets: buildSets(packManifest, annotations, curation) }
  } catch (error) {
    console.warn('Real images: could not read the pack:', error.message)
  }

  cache = { key, manifest }
  return manifest
}

/**
 * Where to get a pack image from, for the /real-images/ route. Returns a local
 * file today. Remote storage would return { redirectUrl } (or a stream) here
 * instead, and pages would not change.
 *
 * @param {string} imagePath - Path within the pack's images/ folder
 * @returns {{ filePath: string } | null} The file, or null if there's no such
 *   image or the path leads outside the images folder
 */
const getImageSource = (imagePath) => {
  const imagesRoot = path.resolve(getPackPath(), 'images')
  const filePath = path.resolve(imagesRoot, imagePath)

  if (!filePath.startsWith(imagesRoot + path.sep)) return null
  if (!SERVABLE_EXTENSIONS.includes(path.extname(filePath).toLowerCase())) {
    return null
  }

  try {
    if (!fs.statSync(filePath).isFile()) return null
  } catch (error) {
    return null
  }

  return { filePath }
}

module.exports = {
  getManifest,
  getImageSource
}
