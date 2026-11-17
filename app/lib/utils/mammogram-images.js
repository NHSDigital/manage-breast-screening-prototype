// app/lib/utils/mammogram-images.js

const path = require('path')
const fs = require('fs')
const config = require('../../config')
const { isMedicalHistoryItemRemoved } = require('./medical-information')
const { getImagedSides } = require('./expected-views')
const { formatDate, formatRelativeDate } = require('./dates')
const realImages = require('../real-images')

// Image sources. Diagrams are in app/assets; real images come from a pack
// outside the app (app/lib/real-images.js).
const IMAGE_SOURCES = {
  diagrams: 'mammogram-diagrams',
  real: 'real-images'
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
 * Extract context flags from appointment data for smart set selection
 * @param {object} appointment - The appointment object
 * @returns {object} - Context flags: hasSymptoms, symptomSides, hasImplants, isImperfect, hasRepeat, hasExtraImages, repeatViews, notImagedSides
 */
const extractAppointmentContext = (appointment) => {
  if (!appointment) return {}

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
  const symptoms = appointment.medicalInformation?.symptoms || []
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

  // Check for breast implants still in place - removed implants do not need
  // the implant image sets
  const implants =
    appointment.medicalInformation?.medicalHistory
      ?.breastImplantsAugmentation || []
  if (implants.length > 0) {
    context.hasImplants = implants.some(
      (implant) => !isMedicalHistoryItemRemoved(implant)
    )
  }

  // Check for imperfect images
  // Value can be array ['yes'] or string 'yes' depending on source
  const imperfectValue = appointment.mammogramData?.isImperfectButBestPossible
  if (
    imperfectValue === 'yes' ||
    (Array.isArray(imperfectValue) && imperfectValue.includes('yes'))
  ) {
    context.isImperfect = true
  }

  // Check for repeat/retake images (technical issues)
  if (appointment.mammogramData?.metadata?.hasRepeat) {
    context.hasRepeat = true

    // Extract which views have repeats
    const views = appointment.mammogramData?.views
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
  if (appointment.mammogramData?.metadata?.hasExtraImages) {
    context.hasExtraImages = true
  }

  // Breasts with no images, for example after a mastectomy
  if (appointment.mammogramData?.views) {
    const imagedSides = getImagedSides(appointment.mammogramData)
    context.notImagedSides = ['right', 'left'].filter(
      (side) => !imagedSides.includes(side)
    )
  }

  return context
}

/**
 * Get appropriate tag weights based on appointment context
 * @param {object} context - Context from extractAppointmentContext
 * @param {object} configWeights - Weights from config (optional override)
 * @returns {object} - Tag weights
 */
const getContextualWeights = (context, options = {}) => {
  const { defaultWeights, contextualWeights } = options

  const fallbackDefaultWeights =
    defaultWeights || config.reading?.mammogramTagWeights || DEFAULT_TAG_WEIGHTS

  // If no context flags, use config or defaults
  if (!context.hasSymptoms && !context.isImperfect) {
    return contextualWeights?.default || fallbackDefaultWeights
  }

  // Both symptoms and imperfect
  if (context.hasSymptoms && context.isImperfect) {
    return (
      contextualWeights?.symptomsAndImperfect || SYMPTOM_AND_IMPERFECT_WEIGHTS
    )
  }

  // Just symptoms
  if (context.hasSymptoms) {
    return contextualWeights?.symptoms || SYMPTOM_WEIGHTS
  }

  // Just imperfect
  if (context.isImperfect) {
    return contextualWeights?.imperfect || IMPERFECT_WEIGHTS
  }

  return contextualWeights?.default || fallbackDefaultWeights
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
 * @param {object} context - Context from extractAppointmentContext
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
      // If appointment has extra images, only use extra image sets
      if (set.hasExtraImages !== true) return false
    } else {
      // If appointment doesn't have extra images, exclude extra image sets
      if (set.hasExtraImages) return false
    }

    // Technical repeats: must match
    if (context.hasRepeat) {
      // If appointment has repeat images, only use repeat sets
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
      // If appointment doesn't have repeats, exclude repeat sets
      if (set.hasRepeat) return false
    }

    // A breast with no images can't show a finding
    if (
      context.notImagedSides?.some((side) =>
        ['abnormal', 'technical'].includes(set[side]?.status)
      )
    ) {
      return false
    }

    return true
  })
}

/**
 * Score sets by how well they match the repeat views context
 * Higher score = better match
 * @param {array} sets - Sets to score
 * @param {object} context - Context from extractAppointmentContext
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
  if (source === 'real') return realImages.getManifest()

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
 * Which image source to show: 'diagrams' or 'real'. Real images are for image
 * reading only, and are used only when the "Mammogram images" setting
 * (`data.settings.reading.mammogramImageSource`) is 'real' and a pack with
 * usable cases is present. Otherwise, diagrams. Outside a template, or when
 * the session has no setting, `config.reading.mammogramImageSource` decides.
 *
 * Screening pages, and the set stored on appointments
 * (`mammogramData.selectedSetId`, chosen when images are taken or seed data is
 * generated), are always diagrams. Reading pages choose a real case at render
 * time when real images are on.
 *
 * @param {string} [area] - 'reading' (default) or 'screening'
 * @returns {string} 'diagrams' or 'real'
 * @example
 * getMammogramImageSource() // 'real' when configured and a pack is present
 * getMammogramImageSource('screening') // always 'diagrams'
 */
function getMammogramImageSource(area = 'reading') {
  if (area !== 'reading') return 'diagrams'
  const setting =
    (this &&
      this.ctx &&
      this.ctx.data?.settings?.reading?.mammogramImageSource) ||
    config.reading?.mammogramImageSource
  if (setting !== 'real') return 'diagrams'
  return hasImageSets('real') ? 'real' : 'diagrams'
}

// The real case tag that best stands in for a diagram set's tag. Real cases
// have no 'indeterminate'; those were recalled, so they are 'abnormal'.
const DIAGRAM_TAG_TO_REAL_TAG = {
  normal: 'normal',
  abnormal: 'abnormal',
  indeterminate: 'abnormal',
  technical: 'technical'
}

/**
 * The real case tag to choose for an appointment, from its stored diagram
 * set, so the images agree roughly with the seed data's reads.
 *
 * @param {object} appointment - Appointment with mammogramData
 * @returns {string|null} Tag, or null if it has no stored set
 */
const getRealTagForAppointment = (appointment) => {
  const setId = appointment?.mammogramData?.selectedSetId
  const diagramSet = setId ? getSetById(setId, 'diagrams') : null
  return diagramSet ? DIAGRAM_TAG_TO_REAL_TAG[diagramSet.tag] || null : null
}

/**
 * Whether a real case is abnormal on the same breasts as an appointment's
 * stored diagram set, so earlier readers' recalls and markers in the seed data
 * land on the breast that's abnormal in the real images. Any status other
 * than normal counts as abnormal.
 *
 * @param {object} set - Real image set
 * @param {object} appointment - Appointment with mammogramData
 * @returns {boolean} True if the sides match, or there's nothing to match
 */
const realSetMatchesSides = (set, appointment) => {
  const setId = appointment?.mammogramData?.selectedSetId
  const diagramSet = setId ? getSetById(setId, 'diagrams') : null
  if (!diagramSet || diagramSet.tag === 'normal') return true

  const isAbnormal = (side) => side?.status && side.status !== 'normal'
  return ['left', 'right'].every(
    (side) => isAbnormal(set[side]) === isAbnormal(diagramSet[side])
  )
}

const MS_PER_DAY = 24 * 60 * 60 * 1000
const DAYS_PER_YEAR = 365.25

// A woman's images look alike from one study to the next, so a real
// participant isn't used again until this share of the pack's participants
// have been used since (where the case mix allows). Reading sessions take
// appointments close together in time, so they don't meet her twice.
const REAL_PARTICIPANT_REST_SHARE = 0.75

// Keep the candidates that pass, unless none do
const narrowTo = (candidates, keep) => {
  const kept = candidates.filter(keep)
  return kept.length > 0 ? kept : candidates
}

// The candidate with the lowest cost
const cheapest = (candidates, cost) => {
  let best = null
  let bestCost = Infinity
  for (const candidate of candidates) {
    const candidateCost = cost(candidate)
    if (candidateCost < bestCost) {
      best = candidate
      bestCost = candidateCost
    }
  }
  return best
}

/**
 * What a real case should fit about an appointment's participant, from the
 * seed data: her age at the appointment, how many days before it each of her
 * earlier mammograms was taken (most recent first), and whether she's on a
 * higher-risk protocol.
 *
 * @param {object} appointment - Appointment
 * @returns {{ age: number|null, priorDaysBefore: number[], higherRisk: boolean }}
 */
const getParticipantProfile = (appointment) => {
  // Required here rather than at the top: the generators use this file, and
  // loading the store reads the generated data
  const dataStore = require('../data-store')
  const { getAge, getCurrentRiskLevel } = require('./participants')

  const participant = dataStore.state.participantsById.get(
    appointment?.participantId
  )
  const startTime = appointment?.timing?.startTime
  if (!participant || !startTime) {
    return { age: null, priorDaysBefore: [], higherRisk: false }
  }

  const appointmentDate = new Date(startTime)
  const priorDaysBefore = (
    dataStore.state.episodeIdsByParticipant.get(participant.id) || []
  )
    .filter((episodeId) => episodeId !== appointment.episodeId)
    .flatMap(
      (episodeId) =>
        dataStore.state.episodesById.get(episodeId)?.mammograms || []
    )
    .map(
      (mammogram) =>
        (appointmentDate - new Date(mammogram.takenDate)) / MS_PER_DAY
    )
    .filter((daysBefore) => daysBefore > 0)
    .sort((a, b) => a - b)

  return {
    age: getAge(participant, appointmentDate),
    priorDaysBefore,
    higherRisk: getCurrentRiskLevel(participant, appointmentDate) !== 'routine'
  }
}

/**
 * How badly a real case fits a participant: years between their ages, a
 * different number of priors (up to the number the viewer shows), years
 * between their most recent priors, and a different screening protocol.
 * Lower is better; 0 is a perfect fit.
 *
 * @param {object} set - Real image set
 * @param {object} profile - From getParticipantProfile
 * @returns {number} Cost
 */
const getRealCaseFitCost = (set, profile) => {
  const maxPriors = config.reading?.maxPriorStudiesInViewer ?? 3
  const casePriors = set.priors || []
  let cost = 0

  if (profile.age !== null && set.ageAtCurrent != null) {
    cost += Math.abs(profile.age - set.ageAtCurrent)
  }
  cost +=
    3 *
    Math.abs(
      Math.min(casePriors.length, maxPriors) -
        Math.min(profile.priorDaysBefore.length, maxPriors)
    )
  if (casePriors.length > 0 && profile.priorDaysBefore.length > 0) {
    cost +=
      (2 * Math.abs(casePriors[0].daysBefore - profile.priorDaysBefore[0])) /
      DAYS_PER_YEAR
  }
  if (Boolean(set.higherRisk) !== profile.higherRisk) cost += 5

  return cost
}

/**
 * Real cases that could stand in for an appointment's images: matching its
 * context (implants, repeats), its diagram set's tag and, where possible,
 * which breasts are abnormal, so seeded reads mark the right breast.
 *
 * @param {Array} sets - Real image sets
 * @param {object} appointment - Appointment
 * @returns {Array} Candidate sets, never empty if sets isn't
 */
const getRealCandidates = (sets, appointment) => {
  const fitting = filterSetsByContext(
    sets,
    extractAppointmentContext(appointment)
  )
  let candidates = fitting.length > 0 ? fitting : sets
  const tag = getRealTagForAppointment(appointment)
  candidates = narrowTo(candidates, (set) => !tag || set.tag === tag)
  return narrowTo(candidates, (set) => realSetMatchesSides(set, appointment))
}

// Real cases assigned to seed appointments, rebuilt when the seed data or the
// pack changes
let realAssignments = {
  manifest: null,
  generationId: null,
  setsById: new Map(),
  caseIdsByAppointmentId: new Map(),
  usedParticipantIds: new Set(),
  datesOfBirth: new Map()
}

/**
 * Assign a real case to every imaged seed appointment, if the seed data or
 * pack has changed since last time.
 *
 * Appointments are assigned in order of appointment time. Each gets an unused
 * case from getRealCandidates, from a participant not used recently (see
 * REAL_PARTICIPANT_REST_SHARE), that best fits the participant's age and
 * screening history. Deterministic for the same seed data and pack.
 *
 * @returns {object|null} The assignments, or null if there's no pack
 */
const getRealAssignments = () => {
  const manifest = getManifest('real')
  if (!manifest) return null

  const dataStore = require('../data-store')
  const { generationId, appointments } = dataStore.state

  if (
    realAssignments.manifest === manifest &&
    realAssignments.generationId === generationId
  ) {
    return realAssignments
  }

  const sets = getAvailableSets('real')
  const setsById = new Map(sets.map((set) => [set.id, set]))
  const caseIdsByAppointmentId = new Map()
  const datesOfBirth = new Map()
  const usedCaseIds = new Set()
  const lastUsedByParticipant = new Map()
  const timesUsedByParticipant = new Map()

  const participantCount = new Set(sets.map((set) => set.participantId)).size
  const restLength = Math.floor(participantCount * REAL_PARTICIPANT_REST_SHARE)

  const imagedAppointments = appointments
    .filter((appointment) => appointment.mammogramData && sets.length > 0)
    .sort(
      (a, b) =>
        new Date(a.timing?.startTime) - new Date(b.timing?.startTime) ||
        a.id.localeCompare(b.id)
    )

  imagedAppointments.forEach((appointment, index) => {
    let candidates = getRealCandidates(sets, appointment)
    candidates = narrowTo(candidates, (set) => !usedCaseIds.has(set.id))

    // Participants not used recently, or if there are none, those used
    // longest ago
    const lastUsed = (set) =>
      lastUsedByParticipant.get(set.participantId) ?? -Infinity
    const rested = candidates.filter(
      (set) => index - lastUsed(set) > restLength
    )
    if (rested.length > 0) {
      candidates = rested
    } else {
      const longestAgo = Math.min(...candidates.map(lastUsed))
      candidates = candidates.filter((set) => lastUsed(set) === longestAgo)
    }

    const profile = getParticipantProfile(appointment)
    const chosen = cheapest(
      candidates,
      (set) =>
        getRealCaseFitCost(set, profile) +
        2 * (timesUsedByParticipant.get(set.participantId) || 0) +
        seededRandom(appointment.id + set.id)
    )

    caseIdsByAppointmentId.set(appointment.id, chosen.id)
    usedCaseIds.add(chosen.id)
    lastUsedByParticipant.set(chosen.participantId, index)
    timesUsedByParticipant.set(
      chosen.participantId,
      (timesUsedByParticipant.get(chosen.participantId) || 0) + 1
    )

    const participant = dataStore.state.participantsById.get(
      appointment.participantId
    )
    const dateOfBirth = getDateOfBirthForAge(
      participant?.demographicInformation?.dateOfBirth,
      appointment.timing?.startTime,
      chosen.ageAtCurrent
    )
    if (dateOfBirth) {
      datesOfBirth.set(participant.id, {
        from: participant.demographicInformation.dateOfBirth,
        to: dateOfBirth
      })
    }
  })

  realAssignments = {
    manifest,
    generationId,
    setsById,
    caseIdsByAppointmentId,
    usedParticipantIds: new Set(lastUsedByParticipant.keys()),
    datesOfBirth
  }
  return realAssignments
}

/**
 * A date of birth on the same day of the year as an existing one, giving the
 * age wanted on a date.
 *
 * @param {string} dateOfBirth - Existing date of birth, YYYY-MM-DD or an ISO
 *   date and time
 * @param {string} onDate - Date the age applies on
 * @param {number} age - Age wanted
 * @returns {string|null} Date of birth in the existing one's format, or null
 *   if any input is missing or the existing date of birth gives that age
 */
const getDateOfBirthForAge = (dateOfBirth, onDate, age) => {
  if (!dateOfBirth || !onDate || !Number.isInteger(age)) return null

  const birth = new Date(dateOfBirth)
  const date = new Date(onDate)
  if (isNaN(birth) || isNaN(date)) return null

  // UTC throughout, so the day of the year never moves with daylight saving
  const month = birth.getUTCMonth()
  const day = birth.getUTCDate()
  const hadBirthday =
    date.getUTCMonth() > month ||
    (date.getUTCMonth() === month && date.getUTCDate() >= day)
  const year = date.getUTCFullYear() - age - (hadBirthday ? 0 : 1)
  if (year === birth.getUTCFullYear()) return null

  // 29 February only exists in leap years
  const isLeapYear = new Date(Date.UTC(year, 1, 29)).getUTCMonth() === 1
  if (month === 1 && day === 29 && !isLeapYear) birth.setUTCDate(28)
  birth.setUTCFullYear(year)

  return /^\d{4}-\d{2}-\d{2}$/.test(dateOfBirth)
    ? birth.toISOString().slice(0, 10)
    : birth.toISOString()
}

/**
 * The real case assigned to a seed data appointment, by getRealAssignments.
 *
 * @param {string} appointmentId - Appointment ID
 * @returns {object|null} The assigned set, or null if the appointment isn't in
 *   the seed data or there's no pack
 */
const getAssignedRealSet = (appointmentId) => {
  const assignments = getRealAssignments()
  const caseId = assignments?.caseIdsByAppointmentId.get(appointmentId)
  return caseId ? assignments.setsById.get(caseId) : null
}

/**
 * A real case for an appointment that isn't in the seed data, so has no
 * assigned case: one matching it as seed appointments are matched, preferring
 * cases and participants that no seed appointment uses, that best fits the
 * participant. The same appointment gets the same case.
 *
 * @param {object} appointment - Appointment with mammogramData
 * @returns {object|null} Real image set, or null if there's no pack
 */
const chooseUnassignedRealSet = (appointment) => {
  const assignments = getRealAssignments()
  const sets = getAvailableSets('real')
  if (!assignments || sets.length === 0) return null

  const assignedCaseIds = new Set(assignments.caseIdsByAppointmentId.values())
  let candidates = getRealCandidates(sets, appointment)
  candidates = narrowTo(candidates, (set) => !assignedCaseIds.has(set.id))
  candidates = narrowTo(
    candidates,
    (set) => !assignments.usedParticipantIds.has(set.participantId)
  )

  const profile = getParticipantProfile(appointment)
  return cheapest(
    candidates,
    (set) =>
      getRealCaseFitCost(set, profile) + seededRandom(appointment.id + set.id)
  )
}

/**
 * Dates of birth to show for seed participants while real images are on, so
 * a participant's age matches her real case's. Keyed by participant ID: `from`
 * the seed data's date of birth, `to` the one to show instead. Only used when
 * the date of birth hasn't been changed this session.
 *
 * @returns {Map<string, { from: string, to: string }>} Empty when there's no
 *   pack
 */
const getRealImageDatesOfBirth = () =>
  getRealAssignments()?.datesOfBirth || new Map()

/**
 * Select an image set for an appointment using seeded random with weighted tag distribution
 * Returns the same set for the same appointmentId
 * @param {string} appointmentId - The appointment ID to use as seed
 * @param {string} source - "diagrams" or "real"
 * @param {object} options - Optional filtering options
 * @param {string} options.tag - Force a specific tag (bypasses weighted selection)
 * @param {object} options.weights - Override tag weights (e.g., { normal: 0.8, abnormal: 0.2 })
 * @param {object} options.contextualWeights - Override context-specific weights ({ default, symptoms, imperfect, symptomsAndImperfect })
 * @param {object} options.appointment - Appointment object for context-aware selection
 * @param {object} options.context - Context object directly (alternative to passing appointment)
 * @returns {object|null} - The selected set object or null if none available
 */
const getImageSetForAppointment = (
  appointmentId,
  source = 'diagrams',
  options = {}
) => {
  let allSets = getAvailableSets(source)
  if (allSets.length === 0) return null

  if (source === 'real' && !options.tag && !options.weights) {
    const assignedSet = getAssignedRealSet(appointmentId)
    if (assignedSet) return assignedSet

    if (options.appointment?.mammogramData) {
      const chosenSet = chooseUnassignedRealSet(options.appointment)
      if (chosenSet) return chosenSet
    }
  }

  // If the appointment already has a stored selectedSetId, use that directly.
  // This ensures the viewer always shows the same set the reading generator used,
  // regardless of which profile weights are currently active.
  // Only bypass this if a specific tag or weights are being forced (e.g. during initial generation).
  const storedSetId = options.appointment?.mammogramData?.selectedSetId

  if (storedSetId && !options.tag && !options.weights) {
    const storedSet = getSetById(storedSetId, source)
    if (storedSet) return storedSet
  }

  // Use provided context, or extract from appointment if provided
  const context =
    options.context ||
    (options.appointment ? extractAppointmentContext(options.appointment) : {})

  // Apply hard filters based on context (e.g., implants)
  if (Object.keys(context).length > 0) {
    allSets = filterSetsByContext(allSets, context)
    if (allSets.length === 0) {
      // If no sets match after filtering, fall back to unfiltered
      allSets = getAvailableSets(source)
    }
  }

  // Use seeded random for consistent selection
  const randomValue = seededRandom(appointmentId)

  // If a specific tag is forced, filter to that tag
  if (options.tag) {
    const filteredSets = allSets.filter((set) => set.tag === options.tag)
    if (filteredSets.length > 0) {
      const index = Math.floor(randomValue * filteredSets.length)
      return filteredSets[index]
    }
    // Fall through to weighted selection if no sets match
  }

  // Get tag weights - use contextual weights if appointment provided, otherwise config/options
  const weights =
    options.weights ||
    getContextualWeights(context, {
      defaultWeights: config.reading?.mammogramTagWeights,
      contextualWeights: options.contextualWeights
    })

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
    const sideRandomValue = seededRandom(appointmentId + 'side')
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
    const repeatRandomValue = seededRandom(appointmentId + 'repeat')
    if (maxScore > 0 && repeatRandomValue < 0.7) {
      setsForTag = scoredSets.filter((s) => s._matchScore === maxScore)
    }
  }

  // Use a second seeded random to pick within the tag
  // (different seed to avoid correlation with tag selection)
  const setRandomValue = seededRandom(appointmentId + selectedTag)
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
  return `/assets/images/${sourceFolder}/image-library/${imageId}.png`
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
  const set = getSetById(setId, source)

  // Real image sets come with their paths
  if (set?.paths) return set.paths

  const sourceFolder = IMAGE_SOURCES[source]
  if (!sourceFolder) return null

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
  const basePath = `/assets/images/${sourceFolder}/${setId}`

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
 * Get image paths for an appointment (convenience function)
 * Combines getImageSetForAppointment and getImagePaths
 * Filters paths based on which views are present in the appointment's mammogram data
 * Returns both latest paths (for default display) and all paths (for additional images)
 * @param {string} appointmentId - The appointment ID
 * @param {string} source - "diagrams" or "real"
 * @param {object} options - Options passed to getImageSetForAppointment
 * @returns {object|null} - Object with set info, paths, allPaths, and hasAdditionalImages flag
 */
const getImagesForAppointment = function (
  appointmentId,
  source = 'diagrams',
  options = {}
) {
  // When called from Nunjucks (this.ctx is available) and no contextualWeights are
  // explicitly provided, look up the active seed data profile's weights so dynamic
  // set selection (for appointments without a stored selectedSetId) uses the right distribution.
  if (!options.contextualWeights && this && this.ctx) {
    const profileName = this.ctx.data?.generationInfo?.seedDataProfile
    if (profileName) {
      const profile =
        this.ctx.data?.settings?.seedProfiles?.profiles?.[profileName] ||
        this.ctx.data?.seedDataProfileSettings?.[profileName]
      const profileWeights = profile?.imageSetSelection?.contextualTagWeights
      if (profileWeights) {
        options = Object.assign({}, options, {
          contextualWeights: profileWeights
        })
      }
    }
  }

  const set = getImageSetForAppointment(appointmentId, source, options)
  if (!set) return null

  const rawPaths = getImagePaths(set.id, source)

  // Filter paths based on which views are present in the appointment's mammogram data
  const appointment = options.appointment
  const mammogramViews = appointment?.mammogramData?.views || {}

  // If no appointment provided, return all paths (backwards compatibility)
  if (!appointment) {
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

  // Check if appointment metadata indicates repeats exist
  // This covers cases where the set's paths don't align with appointment's repeat views
  if (appointment.mammogramData?.metadata?.hasRepeat) {
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
 * Split a set's paths into what a viewer shows: the latest image for each
 * view, every image for each view, and whether any view has more than one
 *
 * @param {object} rawPaths - Paths per view, from getImagePaths
 * @returns {{ paths: object, allPaths: object, hasAdditionalImages: boolean }}
 */
const splitLatestPaths = (rawPaths) => {
  const paths = {}
  for (const view of VIEWS) {
    paths[view] = getLatestPath(rawPaths[view])
  }
  return {
    paths,
    allPaths: rawPaths,
    hasAdditionalImages: VIEWS.some((view) => Array.isArray(rawPaths[view]))
  }
}

/**
 * Earlier studies (priors) to show alongside an appointment's images in the
 * PACS viewer, newest first, up to `config.reading.maxPriorStudiesInViewer`.
 *
 * - Real images: the pack case's own earlier studies, dated back from the
 *   appointment by the gap between the studies. They don't follow the
 *   participant's generated screening history.
 * - Diagrams: a normal set other than the current one, standing in for each
 *   mammogram in the participant's earlier episodes, on that mammogram's date.
 *   Needs session data, which it reads from the template context.
 *
 * Priors show whether or not the appointment is waiting for them to be
 * requested (`appointment.previousMammograms`).
 *
 * @param {object} appointment - The appointment
 * @param {string} [source] - "diagrams" or "real"
 * @param {object} [options]
 * @param {object} [options.data] - Session data, when not called from a template
 * @param {number} [options.limit] - How many priors at most
 * @returns {Array<{ date: string|null, dateText: string, label: string, paths: object, allPaths: object, fullPaths: object|null, hasAdditionalImages: boolean }>}
 * @example
 * {% set priors = getPriorImagesForAppointment(appointment, getMammogramImageSource()) %}
 */
const getPriorImagesForAppointment = function (
  appointment,
  source = 'diagrams',
  options = {}
) {
  if (!appointment) return []

  const limit = options.limit ?? config.reading?.maxPriorStudiesInViewer ?? 3
  const appointmentTime = appointment.timing?.startTime
    ? new Date(appointment.timing.startTime).getTime()
    : null
  const currentSet = getImageSetForAppointment(appointment.id, source, {
    appointment
  })

  const describe = (date, rawPaths, fullPaths = null) => ({
    date,
    dateText: date ? formatDate(date) : '',
    label: date ? formatRelativeDate(date) : 'Prior',
    ...splitLatestPaths(rawPaths),
    fullPaths
  })

  if (source === 'real') {
    return (currentSet?.priors || [])
      .slice(0, limit)
      .map((prior) =>
        describe(
          appointmentTime
            ? new Date(
                appointmentTime - prior.daysBefore * MS_PER_DAY
              ).toISOString()
            : null,
          prior.paths,
          prior.fullPaths
        )
      )
  }

  const data = options.data || this?.ctx?.data
  if (!data || !appointmentTime) return []

  // Required here rather than at the top: episodes.js loads the data store,
  // which reads the generated data, and the generators use this file
  const { getEpisodesForParticipant } = require('./episodes')

  const priorDates = getEpisodesForParticipant(data, appointment.participantId)
    .filter((episode) => episode.id !== appointment.episodeId)
    .flatMap((episode) => episode.mammograms || [])
    .map((mammogram) => mammogram.takenDate)
    .filter((date) => date && new Date(date).getTime() < appointmentTime)
    .sort((a, b) => new Date(b) - new Date(a))
    .slice(0, limit)
  if (priorDates.length === 0) return []

  // Normal sets, matching the current images' implants, not the current set
  const candidates = filterSetsByContext(
    getAvailableSets('diagrams').filter(
      (set) => set.tag === 'normal' && set.id !== currentSet?.id
    ),
    { hasImplants: extractAppointmentContext(appointment).hasImplants }
  )
  if (candidates.length === 0) return []

  const usedSetIds = new Set()
  return priorDates.map((date) => {
    const unused = candidates.filter((set) => !usedSetIds.has(set.id))
    const pool = unused.length > 0 ? unused : candidates
    const set =
      pool[
        Math.floor(seededRandom(appointment.participantId + date) * pool.length)
      ]
    usedSetIds.add(set.id)
    return describe(date, getImagePaths(set.id, 'diagrams'))
  })
}

/**
 * Check if an image source has any available sets
 * @param {string} source - "diagrams" or "real"
 * @returns {boolean}
 */
const hasImageSets = (source = 'diagrams') => {
  return getAvailableSets(source).length > 0
}

/**
 * Get resolved annotations for a set, following 'from' references if needed.
 * For composite sets that reference other sets for their views, this will
 * collect annotations from those source sets.
 * @param {object} set - The set object
 * @param {string} source - "diagrams" or "real"
 * @returns {array} - Array of annotation objects
 */
const getResolvedAnnotations = (set, source = 'diagrams') => {
  if (!set) return []

  // If set has its own annotations, use those
  if (set.annotations && set.annotations.length > 0) {
    return set.annotations
  }

  // For composite sets, look for annotations in referenced source sets
  if (set.views) {
    const collectedAnnotations = []
    const visitedSets = new Set()

    // Track which source sets we need to check for each side
    const sourceSetsBySide = { left: new Set(), right: new Set() }

    for (const view of VIEWS) {
      const viewDef = set.views[view]
      if (!viewDef) continue

      // Determine which side this view belongs to
      const side = view.startsWith('l') ? 'left' : 'right'

      // Handle array of view definitions (e.g., retakes)
      const viewDefs = Array.isArray(viewDef) ? viewDef : [viewDef]

      for (const def of viewDefs) {
        if (def.from) {
          sourceSetsBySide[side].add(def.from)
        }
      }
    }

    // Collect annotations from source sets, but only for the relevant side.
    // A set can be referenced from both sides (a retake of one view alongside
    // the other views), so track what's been taken per side rather than per
    // set - otherwise the first side consumes the set and the second loses its
    // annotations.
    for (const side of ['left', 'right']) {
      for (const sourceSetId of sourceSetsBySide[side]) {
        const visitKey = `${side}:${sourceSetId}`
        if (visitedSets.has(visitKey)) continue
        visitedSets.add(visitKey)

        const sourceSet = getSetById(sourceSetId, source)
        if (sourceSet && sourceSet.annotations) {
          // Only include annotations for the side that references this set
          const relevantAnnotations = sourceSet.annotations.filter(
            (ann) => ann.side === side
          )
          collectedAnnotations.push(...relevantAnnotations)
        }
      }
    }

    return collectedAnnotations
  }

  return []
}

// Order of views within a breast, by the mammogramViewOrder setting. Implant
// displaced views sit beside their regular counterpart.
const VIEW_ORDERS = {
  'cc-first': ['CC', 'CCID', 'MLO', 'MLOID'],
  'mlo-first': ['MLO', 'MLOID', 'CC', 'CCID']
}

/**
 * What an appointment's images are, in brief: when they were taken, how many
 * there are and which views, right breast first.
 *
 * @param {object} appointment - Appointment with mammogramData
 * @param {object} [options] - Options
 * @param {string} [options.viewOrder] - 'cc-first' (default) or 'mlo-first', as data.settings.mammogramViewOrder
 * @returns {object | null} { takenAt, imageCount, views }, where each view is a
 *   label such as 'RCC', or 'RMLO ×2' when it has more than one image. Null
 *   when the appointment has no images.
 * @example
 * summariseMammogramImages(appointment).views // ['RCC', 'RMLO', 'LCC', 'LMLO']
 */
const summariseMammogramImages = (appointment, options = {}) => {
  const mammogramData = appointment?.mammogramData
  const views = Object.values(mammogramData?.views || {}).filter(Boolean)
  if (!views.length) return null

  const order = VIEW_ORDERS[options.viewOrder] || VIEW_ORDERS['cc-first']
  // Right breast first, then by view; a view not in the order goes last
  const rank = (view) =>
    (view.side === 'right' ? 0 : order.length) +
    (order.includes(view.viewShort)
      ? order.indexOf(view.viewShort)
      : order.length - 1)

  // Manual entry records a count per view; automatic entry the images themselves
  const counted = views
    .map((view) => ({
      view,
      count:
        (mammogramData.isManualEntry ? view.count : view.images?.length) || 1
    }))
    .sort((a, b) => rank(a.view) - rank(b.view))

  return {
    takenAt:
      mammogramData.metadata?.startTime ||
      appointment.timing?.actualStartTime ||
      appointment.timing?.startTime ||
      null,
    imageCount: counted.reduce((total, { count }) => total + count, 0),
    views: counted.map(({ view, count }) =>
      count > 1 ? `${view.viewShortWithSide} ×${count}` : view.viewShortWithSide
    )
  }
}

module.exports = {
  IMAGE_SOURCES,
  VIEWS,
  getMammogramImageSource,
  getManifest,
  getAvailableSets,
  getSetById,
  getImageSetForAppointment,
  getImagePaths,
  getImageLibraryPath,
  getImagesForAppointment,
  getPriorImagesForAppointment,
  getRealImageDatesOfBirth,
  hasImageSets,
  extractAppointmentContext,
  getResolvedAnnotations,
  summariseMammogramImages
}
