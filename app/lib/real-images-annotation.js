// app/lib/real-images-annotation.js
//
// The real case annotator (/admin/real-cases): the cases it lists, with what
// NBSS says about each, and saving its markers to the pack's annotations.json.
// Local use only - app/routes/admin-real-cases.js refuses to run it deployed,
// where nothing private may be written to disk. See docs/mammogram-images.md.

const fs = require('fs')
const path = require('path')
const config = require('../config')
const abnormalityTypes = require('../data/abnormality-types')
const {
  STANDARD_VIEWS,
  getImageUrl,
  getStandardViewImages,
  readersDisagreed
} = require('./real-images')

const DAYS_PER_YEAR = 365.25

// Filters on the case list. A case can be in several.
const ANNOTATION_GROUPS = [
  { id: 'cancer', label: 'Cancer' },
  { id: 'normal-at-assessment', label: 'Recalled, normal at assessment' },
  { id: 'biopsy-not-cancer', label: 'Recalled, biopsy not cancer' },
  { id: 'disagreement', label: 'Readers disagreed or arbitration' },
  { id: 'interval', label: 'Interval cancer, last screen' },
  { id: 'technical', label: 'Technical' }
]

// What a marker turned out to be. Markers are what a screen reader would mark;
// this says what assessment found there.
const FINDINGS = [
  { id: 'cancer', label: 'Cancer' },
  { id: 'interval-cancer', label: 'Interval cancer, visible in hindsight' },
  { id: 'biopsy-not-cancer', label: 'Biopsied, not cancer' },
  { id: 'normal-at-assessment', label: 'Normal at assessment' },
  { id: 'not-assessed', label: 'Not assessed' }
]

const REVIEW_STATUSES = [
  { id: 'done', label: 'Done' },
  { id: 'revisit', label: 'Come back to this' },
  { id: 'nothing-visible', label: 'Nothing visible' }
]

// NBSS LesionPosition: side letter, column A (axilla) to E (inner edge), row
// 1 (top) to 4 (bottom), or M for the nipple
const LESION_COLUMNS = {
  A: 'axilla or outer edge',
  B: 'outer',
  C: 'central',
  D: 'inner',
  E: 'inner edge'
}
const LESION_ROWS = {
  1: 'top',
  2: 'upper middle',
  3: 'lower middle',
  4: 'bottom'
}

// Abnormality types a NBSS lesion description clearly means. "Mass" alone is
// left out: NBSS doesn't say whether it's well or ill defined.
const LESION_ABNORMALITY_TYPES = [
  { pattern: /calcification/i, type: 'Microcalcification' },
  { pattern: /cyst/i, type: 'Well-defined mass' },
  { pattern: /distortion/i, type: 'Architectural distortion' },
  { pattern: /asymmetr/i, type: 'Asymmetric density' },
  { pattern: /lymph/i, type: 'Lymph node' }
]

const MAX_TEXT_LENGTH = 500

const getPackFilePath = (fileName) =>
  path.join(config.paths.realImages, fileName)

const readPackJson = (fileName, fallback) => {
  const filePath = getPackFilePath(fileName)
  if (!fs.existsSync(filePath)) return fallback
  return JSON.parse(fs.readFileSync(filePath, 'utf8'))
}

/**
 * The annotation groups a case is in
 *
 * @param {object} readingCase - Case from the manifest
 * @param {object} study - The case's study
 * @param {object} participant - The case's participant
 * @param {boolean} isLastNormalScreen - The participant's latest case read normal
 * @returns {Array<string>} Group IDs
 */
const getCaseGroups = (readingCase, study, participant, isLastNormalScreen) => {
  const nbss = study.nbss
  const groups = []

  if (readingCase.result === 'cancer') groups.push('cancer')
  if (readingCase.result === 'recalled-not-cancer') {
    groups.push(
      nbss?.assessment?.biopsyOpinion
        ? 'biopsy-not-cancer'
        : 'normal-at-assessment'
    )
  }
  if (nbss && readersDisagreed(nbss)) groups.push('disagreement')
  if (participant.classification === 'CI' && isLastNormalScreen) {
    groups.push('interval')
  }
  if (readingCase.tag === 'technical') groups.push('technical')

  return groups
}

/**
 * The finding to suggest for a case's markers
 *
 * @param {Array<string>} groups - From getCaseGroups
 * @returns {string} Finding ID
 */
const getSuggestedFinding = (groups) => {
  if (groups.includes('cancer')) return 'cancer'
  if (groups.includes('interval')) return 'interval-cancer'
  if (groups.includes('biopsy-not-cancer')) return 'biopsy-not-cancer'
  if (groups.includes('normal-at-assessment')) return 'normal-at-assessment'
  return 'not-assessed'
}

/**
 * The level of concern to suggest for a case's markers: the assessment's
 * imaging opinion (I1-I5), at least 3 as screen readers recalled it, or 5 for
 * a cancer that has none
 *
 * @param {object} nbss - A study's nbss from the manifest
 * @param {Array<string>} groups - From getCaseGroups
 * @returns {string} Level of concern, "1" to "5"
 */
const getSuggestedLevelOfConcern = (nbss, groups) => {
  const assessmentLevel = Number(nbss?.assessment?.opinion?.match(/\d/)?.[0])
  if (assessmentLevel) return String(Math.max(3, assessmentLevel))
  return groups.includes('cancer') ? '5' : '3'
}

/**
 * A NBSS lesion position in words, eg "RB2" as "outer, upper middle"
 *
 * @param {string} position - LesionPosition code
 * @returns {string} Description, or the code if it can't be read
 */
const describeLesionPosition = (position) => {
  const match = /^[RL]([A-E])?([1-4])?(M)?$/.exec(position || '')
  if (!match) return position || ''
  if (match[3]) return 'nipple'
  return [LESION_COLUMNS[match[1]], LESION_ROWS[match[2]]]
    .filter(Boolean)
    .join(', ')
}

/**
 * Everything the annotator page needs, or null if there's no pack
 *
 * @returns {object|null} Cases, the groups, findings and statuses to offer,
 *   and the annotations and reviews saved so far
 */
const getAnnotatorData = () => {
  const manifest = readPackJson('manifest.json', null)
  if (!manifest) return null
  const annotations = readPackJson('annotations.json', {})
  const curation = readPackJson('curation.json', {})

  const studiesById = new Map()
  const participantsById = new Map()
  for (const participant of manifest.participants || []) {
    participantsById.set(participant.id, participant)
    for (const study of participant.studies || []) {
      studiesById.set(study.id, study)
    }
  }

  // Each participant's latest case read normal, for interval cancers
  const lastNormalScreenByParticipant = new Map()
  for (const readingCase of manifest.cases || []) {
    if (readingCase.result !== 'normal') continue
    const study = studiesById.get(readingCase.currentStudyId)
    if (!study) continue
    const latest = lastNormalScreenByParticipant.get(readingCase.participantId)
    if (!latest || study.daysFromFirst > latest.daysFromFirst) {
      lastNormalScreenByParticipant.set(readingCase.participantId, study)
    }
  }

  const cases = (manifest.cases || [])
    .filter(
      (readingCase) => !curation.studies?.[readingCase.currentStudyId]?.exclude
    )
    .map((readingCase) => {
      const study = studiesById.get(readingCase.currentStudyId)
      const participant = participantsById.get(readingCase.participantId)
      if (!study || !participant) return null

      const imagesByView = getStandardViewImages(study)
      const images = Object.fromEntries(
        STANDARD_VIEWS.map((view) => [
          view,
          imagesByView[view].map((image) => ({
            id: image.id,
            url: getImageUrl(image.files.display),
            fullUrl: image.files.full ? getImageUrl(image.files.full) : null
          }))
        ])
      )
      if (!STANDARD_VIEWS.some((view) => images[view].length)) return null

      const groups = getCaseGroups(
        readingCase,
        study,
        participant,
        lastNormalScreenByParticipant.get(participant.id) === study
      )

      return {
        id: readingCase.id,
        studyId: study.id,
        participantId: participant.id,
        classification: participant.classification,
        higherRisk: Boolean(participant.higherRisk),
        age: readingCase.ageAtCurrent,
        yearsFromFirst:
          Math.round((study.daysFromFirst / DAYS_PER_YEAR) * 10) / 10,
        manufacturer: study.manufacturer,
        tag: readingCase.tag,
        result: readingCase.result,
        groups,
        suggestedFinding: getSuggestedFinding(groups),
        suggestedLevelOfConcern: getSuggestedLevelOfConcern(study.nbss, groups),
        nbss: study.nbss && {
          ...study.nbss,
          lesions: (study.nbss.lesions || []).map((lesion) => ({
            ...lesion,
            positionText: describeLesionPosition(lesion.position),
            abnormalityTypes: LESION_ABNORMALITY_TYPES.filter(({ pattern }) =>
              pattern.test(lesion.description || '')
            ).map(({ type }) => type)
          }))
        },
        images
      }
    })
    .filter(Boolean)
    .sort(
      (a, b) =>
        a.participantId.localeCompare(b.participantId) ||
        a.yearsFromFirst - b.yearsFromFirst
    )

  return {
    cases,
    groups: ANNOTATION_GROUPS,
    findings: FINDINGS,
    reviewStatuses: REVIEW_STATUSES,
    abnormalityTypes,
    annotations: annotations.studies || {},
    reviews: annotations.reviews || {}
  }
}

const cleanText = (value, maxLength = MAX_TEXT_LENGTH) =>
  typeof value === 'string' ? value.trim().slice(0, maxLength) : ''

const cleanFraction = (value) =>
  Math.round(Math.min(1, Math.max(0, Number(value) || 0)) * 1000) / 1000

const isDate = (value) =>
  typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)

const today = () => new Date().toISOString().slice(0, 10)

/**
 * One annotation as posted by the page, keeping only known fields
 *
 * @param {object} annotation - Annotation from the page
 * @param {number} index - Its place in the study's list
 * @param {Set<string>} imageIds - The study's image IDs
 * @returns {object|null} The annotation, or null if it has no side
 * @throws {Error} If it's positioned on an image from another study
 */
const cleanAnnotation = (annotation, index, imageIds) => {
  if (!['left', 'right'].includes(annotation?.side)) return null

  const positions = {}
  for (const [imageId, position] of Object.entries(
    annotation.positions || {}
  )) {
    if (!imageIds.has(imageId)) {
      throw new Error(`Image ${imageId} is not in this study`)
    }
    positions[imageId] = {
      x: cleanFraction(position?.x),
      y: cleanFraction(position?.y)
    }
  }

  const types = Array.isArray(annotation.abnormalityType)
    ? annotation.abnormalityType
    : [annotation.abnormalityType]
  const size = Number(annotation.size)

  return {
    id: /^a-[\w-]{1,40}$/.test(annotation.id)
      ? annotation.id
      : `a-${index + 1}`,
    side: annotation.side,
    positions,
    // Diameter as a fraction of the image's width; not shown when reading yet
    ...(size > 0 && size <= 1 && { size: Math.round(size * 1000) / 1000 }),
    abnormalityType: types.filter((type) => abnormalityTypes.includes(type)),
    levelOfConcern: ['1', '2', '3', '4', '5'].includes(
      annotation.levelOfConcern
    )
      ? annotation.levelOfConcern
      : '',
    finding: FINDINGS.some((finding) => finding.id === annotation.finding)
      ? annotation.finding
      : 'not-assessed',
    notes: cleanText(annotation.notes),
    annotatedBy: cleanText(annotation.annotatedBy, 20),
    annotatedAt: isDate(annotation.annotatedAt)
      ? annotation.annotatedAt
      : today()
  }
}

/**
 * Write a file by writing a copy alongside and renaming it, so a crash can't
 * leave it half written
 */
const writeFileSafely = (filePath, contents) => {
  const temporaryPath = `${filePath}.saving`
  fs.writeFileSync(temporaryPath, contents, 'utf8')
  fs.renameSync(temporaryPath, filePath)
}

/**
 * Keep the annotations as they were before this save, and the first version
 * of each day, in case a save goes wrong
 */
const backUpAnnotations = (annotationsPath) => {
  if (!fs.existsSync(annotationsPath)) return

  fs.copyFileSync(annotationsPath, getPackFilePath('annotations.previous.json'))

  const backupsPath = getPackFilePath('annotation-backups')
  const dailyPath = path.join(backupsPath, `annotations-${today()}.json`)
  if (!fs.existsSync(dailyPath)) {
    fs.mkdirSync(backupsPath, { recursive: true })
    fs.copyFileSync(annotationsPath, dailyPath)
  }
}

/**
 * Save one study's annotations and review to the pack's annotations.json,
 * leaving every other study as it is
 *
 * @param {string} studyId - Study ID
 * @param {Array} annotations - The study's annotations, from the page
 * @param {object|null} review - { status, notes, reviewedBy }, or null for
 *   not reviewed
 * @returns {{ annotations: Array, review: object|null }} What was saved
 * @throws {Error} If there's no pack, no such study, or an image from another study
 */
const saveStudyAnnotations = (studyId, annotations, review) => {
  const manifest = readPackJson('manifest.json', null)
  const study = manifest?.participants
    ?.flatMap((participant) => participant.studies || [])
    .find((candidate) => candidate.id === studyId)
  if (!study) throw new Error(`No study ${studyId} in the pack`)

  const imageIds = new Set(study.images.map((image) => image.id))
  const cleanAnnotations = (Array.isArray(annotations) ? annotations : [])
    .map((annotation, index) => cleanAnnotation(annotation, index, imageIds))
    .filter(Boolean)

  const cleanReview = REVIEW_STATUSES.some(
    (status) => status.id === review?.status
  )
    ? {
        status: review.status,
        notes: cleanText(review.notes),
        reviewedBy: cleanText(review.reviewedBy, 20),
        reviewedAt: today()
      }
    : null

  const annotationsPath = getPackFilePath('annotations.json')
  const saved = readPackJson('annotations.json', {})
  saved.studies = saved.studies || {}
  saved.reviews = saved.reviews || {}

  if (cleanAnnotations.length) {
    saved.studies[studyId] = cleanAnnotations
  } else {
    delete saved.studies[studyId]
  }
  if (cleanReview) {
    saved.reviews[studyId] = cleanReview
  } else {
    delete saved.reviews[studyId]
  }

  backUpAnnotations(annotationsPath)
  writeFileSafely(annotationsPath, JSON.stringify(saved, null, 2) + '\n')

  return { annotations: cleanAnnotations, review: cleanReview }
}

module.exports = {
  getAnnotatorData,
  saveStudyAnnotations
}
