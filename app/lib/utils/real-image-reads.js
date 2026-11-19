// app/lib/utils/real-image-reads.js
//
// While real mammogram images are on, the seed data's readers mark what
// clinicians marked on the real case shown, rather than where the diagram set
// the reads were generated from had its abnormality. The real case for each
// seed appointment comes from getRealAssignments (mammogram-images.js), and the
// clinicians' markers from the pack's annotations.json - see
// docs/mammogram-images.md.
//
// Like the real image ages (withRealImageDateOfBirth), this is derived per
// request and never saved: app/routes.js sets `data._realImageReads` only when
// real images are on, and recordEpisodeChange puts the seeded reads back
// before an episode is saved.

const dataStore = require('../data-store')

// How far, as a fraction of the image, a seeded reader's marker can sit from
// the clinician's, so two readers' markers don't land exactly on top of each
// other
const MARKER_SPREAD = 0.02

// Episode copies made here, so each episode is copied once per pack and seed
// data
const episodeCopies = new WeakMap()

// A number from 0 to 1 that's always the same for the same text
const getStableFraction = (text) => {
  let hash = 0
  for (const character of text) {
    hash = (hash * 31 + character.charCodeAt(0)) | 0
  }
  return (Math.abs(hash) % 10000) / 10000
}

const nudge = (value, seed) => {
  const offset = (getStableFraction(seed) - 0.5) * 2 * MARKER_SPREAD
  return Math.round(Math.min(1, Math.max(0, value + offset)) * 1000) / 1000
}

/**
 * A clinician's marker on a real case as a seeded reader's annotation, nudged a
 * little so each reader's markers differ
 *
 * @param {object} annotation - From the real image set's annotations
 * @param {string} readerKey - Who made the seeded read
 * @returns {object} Read annotation
 */
const toReadAnnotation = (annotation, readerKey) => {
  const types = [annotation.abnormalityType].flat().filter(Boolean)
  return {
    id: `${annotation.id}-${readerKey}`,
    side: annotation.side,
    abnormalityTypes: types.length > 0 ? types : ['Other'],
    levelOfConcern: annotation.levelOfConcern || '4',
    positions: Object.fromEntries(
      Object.entries(annotation.positions).map(([view, position]) => [
        view,
        {
          x: nudge(position.x, `${readerKey}${annotation.id}${view}x`),
          y: nudge(position.y, `${readerKey}${annotation.id}${view}y`)
        }
      ])
    ),
    comment: ''
  }
}

/**
 * A seeded recall for assessment, showing the real case's clinician markers
 * in place of its own on each breast it calls abnormal that clinicians marked.
 * Which breasts are abnormal doesn't change, as that decides whether reads
 * disagree. Unchanged if clinicians marked none of those breasts.
 *
 * @param {object} read - Seeded read
 * @param {Array} annotations - The real image set's annotations
 * @returns {object} The read, or an overlaid copy
 */
const withRealCaseMarkers = (read, annotations) => {
  // Arbitration reads have arbitrators rather than a reader
  const readerKey =
    read.readerId || read.arbitratorIds?.join('-') || 'arbitration'
  const copy = { ...read }
  let changed = false

  for (const side of ['left', 'right']) {
    if (read[side]?.breastAssessment !== 'abnormal') continue

    const sideAnnotations = annotations.filter(
      (annotation) =>
        annotation.side === side &&
        Object.keys(annotation.positions || {}).length > 0
    )
    if (sideAnnotations.length === 0) continue

    copy[side] = {
      ...read[side],
      annotations: sideAnnotations.map((annotation) =>
        toReadAnnotation(annotation, readerKey)
      )
    }
    changed = true
  }

  return changed ? copy : read
}

// Reads made this session are new, so a read is identified by who made it
// and when
const getReadKey = (read) => `${read.readerId}|${read.timestamp}`

/**
 * The seeded reads of a reading case: those in the shared store's copy of the
 * episode, as reads made this session only exist in the session's changes
 *
 * @param {string} episodeId - Episode ID
 * @param {string} readingCaseId - Reading case ID
 * @returns {Map<string, object>} The seeded reads, by getReadKey
 */
const getSeededReads = (episodeId, readingCaseId) =>
  new Map(
    (
      dataStore.state.episodesById
        .get(episodeId)
        ?.readingCases?.find((readingCase) => readingCase.id === readingCaseId)
        ?.reads || []
    ).map((read) => [getReadKey(read), read])
  )

/**
 * An episode as shown while real images are on: its seeded recalls for
 * assessment mark the clinicians' markers on the real case shown. Unchanged
 * when real images are off, or nothing needs changing.
 *
 * @param {object} data - Session data
 * @param {object | null} episode - Episode
 * @returns {object | null} The episode, or an overlaid copy
 */
const withRealImageReads = (data, episode) => {
  const assignments = data?._realImageReads
  if (!assignments || !episode?.readingCases?.length) return episode

  const cached = episodeCopies.get(episode)
  if (cached?.assignments === assignments) return cached.copy

  // Required here rather than at the top: mammogram-images.js loads the store
  const { getAssignedRealSet } = require('./mammogram-images')

  let changed = false
  const readingCases = episode.readingCases.map((readingCase) => {
    const annotations = getAssignedRealSet(
      readingCase.appointmentId
    )?.annotations
    if (!annotations?.length) return readingCase

    const seededReads = getSeededReads(episode.id, readingCase.id)
    let caseChanged = false
    const reads = (readingCase.reads || []).map((read) => {
      if (
        read.opinion !== 'recall_for_assessment' ||
        !seededReads.has(getReadKey(read))
      ) {
        return read
      }
      const overlaid = withRealCaseMarkers(read, annotations)
      if (overlaid !== read) caseChanged = true
      return overlaid
    })
    if (!caseChanged) return readingCase

    changed = true
    return { ...readingCase, reads }
  })

  const copy = changed ? { ...episode, readingCases } : episode
  episodeCopies.set(episode, { assignments, copy })
  return copy
}

/**
 * An episode with its seeded reads' markers put back as the seed data has
 * them, for saving. Seeded reads are found by who made them and when, not by
 * object, as finalising a read copies it. Other changes to them, such as
 * finalising, are kept.
 *
 * @param {object} episode - Episode, possibly from withRealImageReads
 * @returns {object} The episode as it should be saved
 */
const withoutRealImageReads = (episode) => {
  if (!episode?.readingCases?.length) return episode

  let changed = false
  const readingCases = episode.readingCases.map((readingCase) => {
    const seededReads = getSeededReads(episode.id, readingCase.id)
    let caseChanged = false
    const reads = (readingCase.reads || []).map((read) => {
      const seeded = seededReads.get(getReadKey(read))
      const overlaidSides = ['left', 'right'].filter(
        (side) =>
          seeded &&
          read[side]?.annotations !== seeded[side]?.annotations &&
          JSON.stringify(read[side]?.annotations) !==
            JSON.stringify(seeded[side]?.annotations)
      )
      if (overlaidSides.length === 0) return read

      caseChanged = true
      const restored = { ...read }
      for (const side of overlaidSides) {
        restored[side] = {
          ...read[side],
          annotations: seeded[side]?.annotations
        }
      }
      return restored
    })
    if (!caseChanged) return readingCase

    changed = true
    return { ...readingCase, reads }
  })

  return changed ? { ...episode, readingCases } : episode
}

module.exports = {
  withRealImageReads,
  withoutRealImageReads
}
