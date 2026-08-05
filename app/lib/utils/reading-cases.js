// app/lib/utils/reading-cases.js
//
// A reading case is one set of mammograms being read. Taking images triggers a
// case; the reads - first, second, and later an arbitration read - belong to
// the case rather than to the episode or the appointment directly. Cases live
// on the episode as `episode.readingCases[]`, one per image set, oldest first.
//
// Most episodes have one case. A technical recall produces a second set of
// images and therefore a second case, which is why the episode's reading state
// comes from its *latest* case rather than from any appointment.
//
// The trigger rule is: new image set -> new case. `episode.mammograms[]` is
// already one entry per image set, so cases are opened alongside those entries
// (see syncReadingCasesForAppointment).
//
// Everything here takes a case, not an appointment. Resolving the case from an
// appointment happens once, at the edges - route handlers, the reading workflow
// middleware, and the list-building helpers in reading.js - via
// getReadingCase.

const generateId = require('./id-generator')

// What kind of read this was, recorded when the read is written rather than
// worked out later from its position. Once arbitration has a manual gate in
// front of it, "was this an arbitration read" depends on where the case had got
// to at the time, which nothing can recover afterwards.
const READ_TYPES = ['first', 'second', 'arbitration']

// Where a case has got to. Derived from its reads plus the acts recorded on it
// - never stored, so it can't drift from the reads it describes.
//
// Two reads are not a result by themselves: the result becomes real once the
// reads are finalised - explicitly by the reader, or automatically when the
// finalisation delay passes. `awaiting_finalisation` is that gap. A case whose
// destination is arbitration is still `awaiting_finalisation` until then - the
// destination is a fact about the case (see getReadingCaseStatus), not a
// separate state.
//
// `in_arbitration` is reserved for a future claim/lock - a case being actively
// worked in an arbitration session. Nothing sets it yet.
const READING_CASE_STATES = [
  'awaiting_first_read',
  'awaiting_second_read',
  'awaiting_finalisation',
  'awaiting_arbitration',
  'in_arbitration',
  'concluded'
]

// What a concluded case found. Note this is the *reading* outcome, not the
// episode outcome - a recall for assessment concludes the reading but leaves
// the episode open, because the result comes from the assessment.
//
// Deferral and outstanding priors are deliberately not outcomes: both are
// temporary states that hold a case up, and a case held up still owes an
// outcome once it is released.
const READING_CASE_OUTCOMES = [
  'normal',
  'technical_recall',
  'recall_for_assessment'
]

/**
 * Build a new reading case for one set of images.
 *
 * Shared by the seed generator and the runtime sync so the two can't drift.
 *
 * @param {object} appointment - The appointment that produced the images
 * @param {string} [openedDate] - When the case opened; defaults to when the
 *   images were taken
 * @returns {object} Reading case record
 */
const buildReadingCase = (appointment, openedDate = null) => {
  return {
    id: generateId(),
    appointmentId: appointment.id,
    openedDate:
      openedDate ||
      appointment.timing?.actualStartTime ||
      appointment.timing?.startTime ||
      null,
    reads: []
  }
}

/**
 * All of an episode's reading cases, oldest first
 *
 * @param {object} episode - Episode object
 * @returns {Array} Reading cases
 */
const getReadingCases = (episode) => {
  return episode?.readingCases || []
}

/**
 * An episode's most recent reading case - the one that decides where the
 * episode has got to.
 *
 * A technical recall leaves an older, superseded case behind; that one is
 * history, and must not drag the episode backwards.
 *
 * @param {object} episode - Episode object
 * @returns {object | null} The latest case, or null if the round has no images yet
 */
const getLatestReadingCase = (episode) => {
  const cases = getReadingCases(episode)
  return cases[cases.length - 1] || null
}

/**
 * Find the reading case covering a given appointment's images
 *
 * @param {object} episode - Episode object
 * @param {string} appointmentId - Appointment ID
 * @returns {object | null} The case, or null if that appointment produced no images
 */
const getReadingCaseForAppointment = (episode, appointmentId) => {
  return (
    getReadingCases(episode).find(
      (readingCase) => readingCase.appointmentId === appointmentId
    ) || null
  )
}

/**
 * A case's reads in order, oldest first.
 *
 * Reads are stored in order, so this mainly exists to give callers a safe empty
 * array and a single place to change if ordering ever needs deriving again.
 *
 * @param {object} readingCase - Reading case
 * @returns {Array} The reads
 */
const getReadsAsArray = (readingCase) => {
  return readingCase?.reads || []
}

/**
 * Get one user's read on a case
 *
 * @param {object} readingCase - Reading case
 * @param {string} userId - User ID
 * @returns {object | null} Their read, or null if they haven't read it
 */
const getReadForUser = (readingCase, userId) => {
  if (!userId) return null

  return (
    getReadsAsArray(readingCase).find((read) => read.readerId === userId) || null
  )
}

/**
 * Get the reads on a case made by anyone other than the given user
 *
 * @param {object} readingCase - Reading case
 * @param {string} userId - User ID to exclude
 * @returns {Array} The other reads, in order
 */
const getOtherReads = (readingCase, userId) => {
  return getReadsAsArray(readingCase).filter((read) => read.readerId !== userId)
}

/**
 * Get the arbitration read on a case, if one has been made
 *
 * @param {object} readingCase - Reading case
 * @returns {object | null} The arbitration read, or null
 */
const getArbitrationRead = (readingCase) => {
  return (
    getReadsAsArray(readingCase).find((read) => read.readType === 'arbitration') ||
    null
  )
}

/**
 * Whether a user has read a case
 *
 * @param {object} readingCase - Reading case
 * @param {string} userId - User ID
 * @returns {boolean}
 */
const userHasReadCase = (readingCase, userId) => {
  return Boolean(getReadForUser(readingCase, userId))
}

/**
 * Whether a case has any reads
 *
 * @param {object} readingCase - Reading case
 * @returns {boolean}
 */
const caseHasReads = (readingCase) => {
  return getReadsAsArray(readingCase).length > 0
}

/**
 * Whether a case has been deferred from reading.
 *
 * Deferral is recorded as an act (who deferred it and when), and the state is
 * read back from its presence - the same shape arbitration release takes.
 *
 * @param {object} readingCase - Reading case
 * @returns {boolean}
 */
const isCaseDeferred = (readingCase) => {
  return Boolean(readingCase?.deferral?.deferredAt)
}

/**
 * Whether a case has been released into arbitration.
 *
 * Nothing performs the release yet - the flow that does is future work - so
 * this is false for every case today. It exists so the state vocabulary is
 * whole, rather than growing a new value later across every call site.
 *
 * @param {object} readingCase - Reading case
 * @returns {boolean}
 */
const isCaseInArbitration = (readingCase) => {
  return Boolean(readingCase?.arbitration?.releasedAt)
}

/**
 * Whether the reads on a case disagree in a clinically meaningful way.
 *
 * Rules:
 * - Different top-level opinions -> always discordant
 * - Both technical recall: discordant if the set of selected views differs
 *   (reasons are ignored - same views = concordant even with different reasons)
 * - Both recall for assessment: discordant if either per-breast assessment
 *   differs (annotations and comments are ignored)
 * - Both normal -> concordant
 *
 * Handles partial data gracefully: if TR views or RFA breast assessments are
 * not yet filled in, falls back to comparing only what's available.
 *
 * @param {object} readA - First read (saved read or imageReadingTemp)
 * @param {object} readB - Second read (saved read or imageReadingTemp)
 * @returns {boolean} Whether the reads are discordant
 */
const areReadsDiscordant = (readA, readB) => {
  if (!readA?.opinion || !readB?.opinion) return false

  // Different top-level opinions -> always discordant
  if (readA.opinion !== readB.opinion) return true

  const opinion = readA.opinion

  // Both TR: compare the set of selected view keys
  if (opinion === 'technical_recall') {
    const viewsA = readA.technicalRecall?.views
    const viewsB = readB.technicalRecall?.views
    // If either side has no view data yet, can't compare further
    if (!viewsA || !viewsB) return false
    const keysA = new Set(Object.keys(viewsA))
    const keysB = new Set(Object.keys(viewsB))
    if (keysA.size !== keysB.size) return true
    for (const view of keysA) {
      if (!keysB.has(view)) return true
    }
    return false
  }

  // Both RFA: compare per-breast assessments
  if (opinion === 'recall_for_assessment') {
    const leftA = readA.left?.breastAssessment
    const leftB = readB.left?.breastAssessment
    const rightA = readA.right?.breastAssessment
    const rightB = readB.right?.breastAssessment
    // If no breast data on either side yet, can't compare further
    if (!leftA && !leftB && !rightA && !rightB) return false
    if ((leftA || leftB) && leftA !== leftB) return true
    if ((rightA || rightB) && rightA !== rightB) return true
    return false
  }

  return false
}

/**
 * Whether two reads mean the case needs arbitrating, taking the site's
 * arbitration policy into account.
 *
 * Policies (from settings.reading.arbitrationPolicy):
 * - 'discordant_only' (default): only discordant reads need arbitration
 * - 'all_recalls': concordant recalls for assessment do too
 * - 'all_non_normal': any concordant non-normal outcome does too
 *
 * @param {object} readA - First read
 * @param {object} readB - Second read
 * @param {object} [settings] - Site settings object (data.settings)
 * @returns {boolean}
 */
const willGoToArbitration = (readA, readB, settings = {}) => {
  if (!readA || !readB) return false

  // Discordant reads always go to arbitration
  if (areReadsDiscordant(readA, readB)) return true

  // Concordant but non-normal: depends on policy
  const policy = settings?.reading?.arbitrationPolicy || 'discordant_only'
  if (policy === 'all_non_normal') {
    return readA.opinion !== 'normal'
  }
  if (policy === 'all_recalls') {
    return readA.opinion === 'recall_for_assessment'
  }

  return false
}

/**
 * Whether a read is finalised.
 *
 * Finalisation happens two ways: the reader finalises it (finalisedAt is
 * written), or the finalisation delay passes and it finalises itself. The
 * delay comes from settings.reading.finalisationDelay - minutes as a string,
 * '0' meaning immediately, 'never' meaning only ever manually.
 *
 * @param {object} read - The read
 * @param {object} [settings] - Site settings object (data.settings)
 * @param {Date | string} [now] - The time to judge auto-finalisation against;
 *   defaults to the real now
 * @returns {boolean}
 */
const isReadFinalised = (read, settings = {}, now = null) => {
  if (!read) return false
  if (read.finalisedAt) return true

  const delay = settings?.reading?.finalisationDelay ?? '60'
  if (delay === 'never') return false
  if (!read.timestamp) return false

  const delayMinutes = parseInt(delay, 10)
  if (Number.isNaN(delayMinutes)) return false

  const finalisesAt = new Date(read.timestamp).getTime() + delayMinutes * 60000
  const judgedAt = now ? new Date(now).getTime() : Date.now()
  return judgedAt >= finalisesAt
}

/**
 * Whether every read on a case is finalised
 *
 * @param {object} readingCase - Reading case
 * @param {object} [settings] - Site settings object (data.settings)
 * @param {Date | string} [now] - The time to judge auto-finalisation against
 * @returns {boolean}
 */
const areAllReadsFinalised = (readingCase, settings = {}, now = null) => {
  return getReadsAsArray(readingCase).every((read) =>
    isReadFinalised(read, settings, now)
  )
}

/**
 * Where a case has got to.
 *
 * Deferral and outstanding priors are not states here - both hold a case up
 * without changing how far through reading it is, so they belong alongside the
 * state as flags rather than replacing it.
 *
 * @param {object} readingCase - Reading case
 * @param {object} [settings] - Site settings object (data.settings)
 * @param {Date | string} [now] - The time to judge auto-finalisation against
 * @returns {string} One of READING_CASE_STATES
 */
const getReadingCaseState = (readingCase, settings = {}, now = null) => {
  const reads = getReadsAsArray(readingCase)

  if (reads.length === 0) return 'awaiting_first_read'
  if (reads.length === 1) return 'awaiting_second_read'

  // An arbitration read settles the case whatever the first two said - but
  // like any read it is not a result until finalised
  if (getArbitrationRead(readingCase)) {
    return areAllReadsFinalised(readingCase, settings, now)
      ? 'concluded'
      : 'awaiting_finalisation'
  }

  // Two opinions are not a result until they are finalised
  if (!areAllReadsFinalised(readingCase, settings, now)) {
    return 'awaiting_finalisation'
  }

  const [firstRead, secondRead] = reads

  if (willGoToArbitration(firstRead, secondRead, settings)) {
    return 'awaiting_arbitration'
  }

  return 'concluded'
}

/**
 * What a case found, or null while reading is still under way.
 *
 * Null is meaningful: it says the reading hasn't produced an answer yet, which
 * is what leaves an episode sitting in `reading`.
 *
 * @param {object} readingCase - Reading case
 * @param {object} [settings] - Site settings object (data.settings)
 * @param {Date | string} [now] - The time to judge auto-finalisation against
 * @returns {string | null} One of READING_CASE_OUTCOMES, or null
 */
const getReadingCaseOutcome = (readingCase, settings = {}, now = null) => {
  if (getReadingCaseState(readingCase, settings, now) !== 'concluded') {
    return null
  }

  // Arbitration, where it happened, is the deciding read
  const arbitrationRead = getArbitrationRead(readingCase)
  if (arbitrationRead) return arbitrationRead.opinion || null

  // Otherwise the two reads agreed, so either one gives the answer
  return getReadsAsArray(readingCase)[0]?.opinion || null
}

/**
 * The facts about where a case stands, for composing status displays.
 *
 * Facts rather than labels, so "awaiting finalisation, then arbitration" is
 * one state with a destination instead of a fourth state - willArbitrate is
 * just willGoToArbitration asked as soon as two reads exist, rather than at
 * finalisation.
 *
 * getReadingCaseOutcome stays strict (null until concluded);
 * provisionalOutcome is what the outcome will be once the reads finalise,
 * where that can already be said.
 *
 * @param {object} readingCase - Reading case
 * @param {object} [settings] - Site settings object (data.settings)
 * @param {Date | string} [now] - The time to judge auto-finalisation against
 * @returns {{state: string, finalised: boolean, willArbitrate: boolean, provisionalOutcome: string | null}}
 */
const getReadingCaseStatus = (readingCase, settings = {}, now = null) => {
  const reads = getReadsAsArray(readingCase)
  const arbitrationRead = getArbitrationRead(readingCase)

  const willArbitrate = Boolean(
    reads.length >= 2 &&
      !arbitrationRead &&
      willGoToArbitration(reads[0], reads[1], settings)
  )

  const provisionalOutcome =
    arbitrationRead?.opinion ||
    (reads.length >= 2 && !willArbitrate ? reads[0]?.opinion || null : null)

  return {
    state: getReadingCaseState(readingCase, settings, now),
    finalised:
      reads.length >= 2 && areAllReadsFinalised(readingCase, settings, now),
    willArbitrate,
    provisionalOutcome
  }
}

/**
 * Summary counts and flags for a case, for lists and progress displays
 *
 * @param {object} readingCase - Reading case
 * @param {object} [settings] - Site settings object (data.settings)
 * @returns {object} Reading metadata
 */
const getReadingMetadata = (readingCase, settings = {}) => {
  const reads = getReadsAsArray(readingCase)
  const uniqueReaderCount = new Set(reads.map((read) => read.readerId)).size
  const opinions = [...new Set(reads.map((read) => read.opinion))].filter(
    Boolean
  )

  // Discordance is richer than comparing opinion strings - it also checks TR
  // views and RFA breast assessments
  const isDiscordant =
    reads.length >= 2 ? areReadsDiscordant(reads[0], reads[1]) : false

  return {
    readCount: reads.length,
    uniqueReaderCount,
    firstReadComplete: reads.length >= 1,
    secondReadComplete: reads.length >= 2,
    isDiscordant,
    opinions,
    state: getReadingCaseState(readingCase, settings),
    outcome: getReadingCaseOutcome(readingCase, settings)
  }
}

/**
 * Whether a case still needs a first read
 *
 * @param {object} readingCase - Reading case
 * @returns {boolean}
 */
const caseNeedsFirstRead = (readingCase) => {
  return !caseHasReads(readingCase)
}

/**
 * Whether a case has a first read and still needs a second
 *
 * @param {object} readingCase - Reading case
 * @returns {boolean}
 */
const caseNeedsSecondRead = (readingCase) => {
  return getReadsAsArray(readingCase).length === 1
}

/**
 * Whether a case sits in the arbitration backlog - finalised reads whose
 * result the rules send to arbitration, not yet claimed by anyone
 *
 * @param {object} readingCase - Reading case
 * @param {object} [settings] - Site settings object (data.settings)
 * @returns {boolean}
 */
const caseNeedsArbitration = (readingCase, settings = {}) => {
  return getReadingCaseState(readingCase, settings) === 'awaiting_arbitration'
}

/**
 * Whether a user can read a case.
 *
 * Only covers what the case itself knows. Outstanding priors also block
 * reading, but those live on the appointment, so callers working from an
 * appointment combine the two (see canUserReadAppointment in reading.js).
 *
 * @param {object} readingCase - Reading case
 * @param {string} userId - User ID
 * @param {object} [options] - Options
 * @param {number} [options.maxReadsPerCase] - Reads needed before it's complete
 * @returns {boolean}
 */
const canUserReadCase = (readingCase, userId, options = {}) => {
  const { maxReadsPerCase = 2, panelArbitration = false } = options

  if (!userId) return false

  // A deferred case is out of the queue until someone reviews it
  if (isCaseDeferred(readingCase)) return false

  // A case released to arbitration takes one more read - the arbitration
  // read - from someone who hasn't read it already. Panel arbitrators may
  // have been an original reader, so skip the user check for panels.
  if (isCaseInArbitration(readingCase) && !getArbitrationRead(readingCase)) {
    return panelArbitration || !userHasReadCase(readingCase, userId)
  }

  // Enough readers have had it already
  if (getReadsAsArray(readingCase).length >= maxReadsPerCase) return false

  // Nobody reads the same case twice
  return !userHasReadCase(readingCase, userId)
}

/**
 * Work out what the second reader should be shown about the first read.
 *
 * Returns false when there is nothing to compare - the user is the first
 * reader, or both opinions are normal.
 *
 * @param {object} readingCase - The case being read
 * @param {object | string} secondReadData - The second reader's working data
 *   (imageReadingTemp or a read object); a bare opinion string also works
 * @param {string} userId - Current user ID
 * @param {object} [settings] - Site settings object (data.settings)
 * @returns {false | object} False if no comparison is needed, else the details
 */
const getComparisonInfo = (
  readingCase,
  secondReadData,
  userId,
  settings = {}
) => {
  // Support passing just an opinion string
  const secondRead =
    typeof secondReadData === 'string'
      ? { opinion: secondReadData }
      : secondReadData

  // Reads are held in order, so the earliest by anyone else is the first read
  const firstRead = getOtherReads(readingCase, userId)[0]

  // No first read exists - the user is the first reader
  if (!firstRead) return false

  const firstOpinion = firstRead.opinion
  const secondOpinion = secondRead?.opinion

  // Both normal - nothing worth comparing
  if (firstOpinion === 'normal' && secondOpinion === 'normal') return false

  const discordant = areReadsDiscordant(firstRead, secondRead)

  return {
    type: discordant ? 'discordant' : 'agreeing',
    discordant,
    goesToArbitration: willGoToArbitration(firstRead, secondRead, settings),
    firstRead,
    firstOpinion,
    secondOpinion
  }
}

/**
 * Whether the compare page should be shown to the second reader.
 *
 * Combines whether there is anything to compare with the show-when setting
 * (settings.reading.compareWhen):
 * - 'non_normal' (default): show whenever either opinion is non-normal
 * - 'discordant_only': only show when the two reads actually disagree
 *
 * The separate timing setting (secondReaderComparison) decides *when* in the
 * flow to ask this, and is handled by the routes.
 *
 * @param {object} readingCase - The case being read
 * @param {object} secondReadData - The second reader's working data
 * @param {string} userId - Current user ID
 * @param {object} [settings] - Site settings object (data.settings)
 * @returns {boolean}
 */
const shouldShowComparePage = (
  readingCase,
  secondReadData,
  userId,
  settings = {}
) => {
  const comparisonInfo = getComparisonInfo(
    readingCase,
    secondReadData,
    userId,
    settings
  )

  if (!comparisonInfo) return false

  const compareWhen = settings?.reading?.compareWhen || 'non_normal'

  if (compareWhen === 'discordant_only') return comparisonInfo.discordant

  return true
}

/**
 * Build the read record for a user's opinion on a case.
 *
 * The read type is settled here, from where the case had got to when the read
 * was made - so it stays true even if reads are later withdrawn.
 *
 * @param {object} readingCase - The case being read
 * @param {string} userId - Reader's user ID
 * @param {string} readerType - Reader's role
 * @param {object} reading - The opinion and its details
 * @param {object} [options] - Options
 * @param {string} [options.timestamp] - When the read was made
 * @returns {object} The read record
 */
const buildRead = (readingCase, userId, readerType, reading, options = {}) => {
  const existingRead = getReadForUser(readingCase, userId)
  const otherReads = getOtherReads(readingCase, userId)

  // Amending a read keeps its place in the order; a new one takes the next
  const readNumber = existingRead?.readNumber || otherReads.length + 1

  // A case already in arbitration is being settled, whoever is reading it
  const readType = isCaseInArbitration(readingCase)
    ? 'arbitration'
    : READ_TYPES[Math.min(readNumber, READ_TYPES.length) - 1]

  return {
    ...reading,
    readerId: userId,
    readerType,
    readType,
    readNumber,
    timestamp: options.timestamp || new Date().toISOString()
  }
}

/**
 * Add or replace a user's read on a case, returning a new case record.
 *
 * Returns a replacement rather than mutating: cases live inside episodes, which
 * are shared read-only data (see docs/data-conventions.md).
 *
 * @param {object} readingCase - The case being read
 * @param {object} read - The read record, from buildRead
 * @returns {object} A new case record with the read applied
 */
const withRead = (readingCase, read) => {
  const reads = getReadsAsArray(readingCase)
  const existingIndex = reads.findIndex(
    (candidate) => candidate.readerId === read.readerId
  )

  const updatedReads =
    existingIndex >= 0
      ? reads.map((candidate, index) => (index === existingIndex ? read : candidate))
      : [...reads, read]

  return { ...readingCase, reads: updatedReads }
}

/**
 * Mark a user's read on a case as finalised, returning a new case record.
 *
 * Already-finalised reads are left alone, so the original finalisation
 * record survives a repeat call.
 *
 * @param {object} readingCase - The case
 * @param {string} userId - Whose read to finalise
 * @param {object} [options] - Options
 * @param {string} [options.finalisedAt] - When; defaults to now
 * @param {string} [options.finalisedBy] - Who finalised it; defaults to the reader
 * @returns {object} A new case record with the finalisation applied
 */
const withReadFinalised = (readingCase, userId, options = {}) => {
  const reads = getReadsAsArray(readingCase).map((read) =>
    read.readerId === userId && !read.finalisedAt
      ? {
          ...read,
          finalisedAt: options.finalisedAt || new Date().toISOString(),
          finalisedBy: options.finalisedBy || userId
        }
      : read
  )

  return { ...readingCase, reads }
}

/**
 * Remove a user's read from a case, returning a new case record.
 *
 * Deferring after giving an opinion withdraws that opinion - the reader is
 * saying they can't judge this case after all.
 *
 * @param {object} readingCase - The case
 * @param {string} userId - Whose read to remove
 * @returns {object} A new case record without that read
 */
const withoutRead = (readingCase, userId) => {
  return {
    ...readingCase,
    reads: getReadsAsArray(readingCase).filter(
      (read) => read.readerId !== userId
    )
  }
}

module.exports = {
  READ_TYPES,
  READING_CASE_STATES,
  READING_CASE_OUTCOMES,
  buildReadingCase,
  getReadingCases,
  getLatestReadingCase,
  getReadingCaseForAppointment,
  getReadsAsArray,
  getReadForUser,
  getOtherReads,
  getArbitrationRead,
  userHasReadCase,
  caseHasReads,
  isCaseDeferred,
  isCaseInArbitration,
  areReadsDiscordant,
  willGoToArbitration,
  getComparisonInfo,
  shouldShowComparePage,
  isReadFinalised,
  areAllReadsFinalised,
  getReadingCaseState,
  getReadingCaseOutcome,
  getReadingCaseStatus,
  getReadingMetadata,
  caseNeedsFirstRead,
  caseNeedsSecondRead,
  caseNeedsArbitration,
  canUserReadCase,
  buildRead,
  withRead,
  withReadFinalised,
  withoutRead
}
