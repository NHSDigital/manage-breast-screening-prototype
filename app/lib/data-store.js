// app/lib/data-store.js
//
// Shared, read-only store for the generated seed data.
//
// Loaded once at boot and shared across every session. Sessions no longer
// carry their own copy of the big collections - they only store changed
// records in `data._changes` (see the attach middleware in app/routes.js),
// which are overlaid on these shared arrays at request time.
//
// Because these arrays and records are shared across sessions, nothing may
// mutate them at request time. To change a record, code must go through the
// update helpers (updateEvent etc), which write a whole replacement record
// into the session's `data._changes`. In development the store is deep-frozen
// so any leftover in-place mutation throws at the exact line, rather than
// silently leaking one session's changes into every other session. See
// docs/data-conventions.md.

const fs = require('fs')
const path = require('path')
const config = require('../config')

const generatedDataPath = config.paths.generatedData

// Freeze shared data in development so accidental mutation fails loudly.
// Escape hatch: set freezeSharedData: false in config if a frozen object is
// ever blocking work - the store still works, mutations just go undetected.
const shouldFreeze =
  process.env.NODE_ENV !== 'production' && config.freezeSharedData !== false

/**
 * Recursively freeze an object graph. Handles cycles and only descends into
 * plain objects/arrays (seed data is plain JSON so that covers everything).
 *
 * @param {object} value - Object or array to freeze
 * @param {WeakSet} seen - Already-frozen objects (cycle guard)
 * @returns {object} The same value, frozen
 */
const deepFreeze = (value, seen = new WeakSet()) => {
  if (value === null || typeof value !== 'object' || seen.has(value)) {
    return value
  }
  seen.add(value)
  for (const key of Object.keys(value)) {
    deepFreeze(value[key], seen)
  }
  return Object.freeze(value)
}

/**
 * Read a generated JSON file, returning a fallback on any failure
 *
 * @param {string} filename - File within the generated data folder
 * @param {object} fallback - Value to use if the file is missing/invalid
 * @returns {object} Parsed JSON or fallback
 */
const readGeneratedFile = (filename, fallback) => {
  try {
    return JSON.parse(
      fs.readFileSync(path.join(generatedDataPath, filename), 'utf8')
    )
  } catch (err) {
    console.warn(`Data store: error reading ${filename}:`, err.message)
    return fallback
  }
}

// The store's mutable state - swapped wholesale by reload()
const state = {
  participants: [],
  clinics: [],
  events: [],
  participantsById: new Map(),
  clinicsById: new Map(),
  eventsById: new Map(),
  eventIdsByClinic: new Map(),
  eventIdsByParticipant: new Map(),
  generationInfo: {},
  // Identifies which generation of seed data the store holds. Sessions stamp
  // their _changes with this; the attach middleware discards changes made
  // against a different generation (i.e. before a regenerate/profile swap).
  generationId: null
}

/**
 * (Re)load all collections from the generated JSON on disk and rebuild
 * indexes. Called at boot and again after any data regeneration.
 */
const reload = () => {
  const started = Date.now()

  const participants =
    readGeneratedFile('participants.json', {}).participants || []
  const clinics = readGeneratedFile('clinics.json', {}).clinics || []
  const events = readGeneratedFile('events.json', {}).events || []
  const generationInfo = readGeneratedFile('generation-info.json', {
    generatedAt: 'Never',
    stats: { participants: 0, clinics: 0, events: 0 }
  })

  if (shouldFreeze) {
    deepFreeze(participants)
    deepFreeze(clinics)
    deepFreeze(events)
    deepFreeze(generationInfo)
  }

  state.participants = participants
  state.clinics = clinics
  state.events = events
  state.generationInfo = generationInfo
  state.generationId = generationInfo.generatedAt

  state.participantsById = new Map(participants.map((p) => [p.id, p]))
  state.clinicsById = new Map(clinics.map((c) => [c.id, c]))
  state.eventsById = new Map(events.map((e) => [e.id, e]))

  state.eventIdsByClinic = new Map()
  state.eventIdsByParticipant = new Map()
  for (const event of events) {
    if (!state.eventIdsByClinic.has(event.clinicId)) {
      state.eventIdsByClinic.set(event.clinicId, [])
    }
    state.eventIdsByClinic.get(event.clinicId).push(event.id)

    if (!state.eventIdsByParticipant.has(event.participantId)) {
      state.eventIdsByParticipant.set(event.participantId, [])
    }
    state.eventIdsByParticipant.get(event.participantId).push(event.id)
  }

  console.log(
    `Data store: loaded ${participants.length} participants, ` +
      `${clinics.length} clinics, ${events.length} events ` +
      `in ${Date.now() - started}ms${shouldFreeze ? ' (frozen)' : ''}`
  )
}

// Initial load at boot. If the generated files are missing/stale the app's
// regeneration path will run the generator and call reload() again.
reload()

module.exports = {
  state,
  reload
}
