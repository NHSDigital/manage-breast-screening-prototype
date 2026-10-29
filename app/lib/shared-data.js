// app/lib/shared-data.js
//
// Shared changes between sessions, so several browsers can work on the same
// data. See docs/data-conventions.md.
//
// Sessions normally keep their changed records in their own `data._changes`.
// When sharing is on, the attach middleware in app/routes.js points
// `data._changes` at a changes object held here instead, one per channel:
//
// - mode 'off': a session shares only once it has joined (the start button
//   on the index), and then shares the 'everyone' channel with the others
//   that joined. The rest keep their own changes.
// - mode 'on': every session shares the 'everyone' channel
// - mode 'room': sessions in a named room share that room's channel; a
//   session not in a room keeps its own changes
//
// The mode is server-wide. It starts from config (set by the SHARED_DATA_MODE
// environment variable) and can be changed from /settings until the server
// restarts. Shared changes live in memory only, so they reset on restart.
//
// Every recorded change goes through recordChange, which is also the one place
// that tells listening browsers (see the events route in
// app/routes/shared-data.js) that something has changed.

const { EventEmitter } = require('events')
const { isDeepStrictEqual } = require('util')
const config = require('../config')
const dataStore = require('./data-store')

const MODES = ['off', 'on', 'room']
const EVERYONE_CHANNEL = 'everyone'
// Events sent on this reach every channel
const ALL_CHANNELS = '*'

const rooms = config.sharedData.rooms

let mode = MODES.includes(config.sharedData.mode)
  ? config.sharedData.mode
  : 'off'

// Channel key -> shared changes object, in the same shape as a session's own
// data._changes
const channels = new Map()

// Shared changes object -> its channel key, so recordChange can tell a shared
// write from a session's own
const channelKeyByChanges = new WeakMap()

// Session data -> the id of the session it belongs to, so events can be
// tagged with who made them. Session data is a fresh object every request, so
// entries go when the request does.
const sessionIdByData = new WeakMap()

// How long a browser counts as signed in after its last request, or its last
// live update heartbeat while a page is open
const PRESENCE_TIMEOUT_MS = 30 * 60 * 1000

// Session id -> { channel, userId, lastSeen }, for the browsers sharing data,
// so the choose user page can show who is signed in elsewhere
const presenceBySession = new Map()

const events = new EventEmitter()
// Every open page holds a listener, so the default warning limit of 10 is
// too low
events.setMaxListeners(0)

/**
 * Get the server-wide shared data mode
 *
 * @returns {string} 'off', 'on' or 'room'
 */
const getMode = () => mode

/**
 * Change the server-wide shared data mode until the server restarts
 *
 * @param {string} newMode - 'off', 'on' or 'room'
 * @returns {boolean} Whether the mode was valid and applied
 */
const setMode = (newMode) => {
  if (!MODES.includes(newMode)) return false
  mode = newMode
  return true
}

/**
 * Get the pre-seeded room names
 *
 * @returns {Array<string>} Room names from config
 */
const getRooms = () => rooms

/**
 * Find a room by name, ignoring case and treating hyphens as spaces, so
 * `?room=research-1` matches "Research 1"
 *
 * @param {string} value - Room name to look for
 * @returns {string | null} The room's name as configured, or null
 */
const findRoom = (value) => {
  if (typeof value !== 'string') return null
  const normalise = (name) =>
    name
      .trim()
      .toLowerCase()
      .replace(/[-\s]+/g, ' ')
  const wanted = normalise(value)
  return rooms.find((room) => normalise(room) === wanted) || null
}

/**
 * Change one of a session's shared data settings (`room` or `joined`).
 * Copies the settings objects rather than changing them in place, because a
 * new session's settings are the session defaults' own object, so writing
 * into it would change the defaults for every session after.
 *
 * @param {object} data - Session data
 * @param {string} key - Setting name
 * @param {string} value - New value
 */
const setSharedDataSetting = (data, key, value) => {
  data.settings = {
    ...data.settings,
    sharedData: { ...data.settings?.sharedData, [key]: value }
  }
}

/**
 * Whether a session has joined sharing with the start button, which counts
 * when the mode is 'off'
 *
 * @param {object} data - Session data
 * @returns {boolean} True if joined
 */
const isJoined = (data) => data?.settings?.sharedData?.joined === 'true'

/**
 * Get the channel a session shares changes on, from the current mode, and
 * the session's room or whether it has joined
 *
 * @param {object} data - Session data
 * @returns {string | null} Channel key, or null when the session isn't sharing
 */
const getChannelKey = (data) => {
  if (mode === 'on') return EVERYONE_CHANNEL
  if (mode === 'room') {
    const room = findRoom(data?.settings?.sharedData?.room)
    return room ? `room:${room}` : null
  }
  return isJoined(data) ? EVERYONE_CHANNEL : null
}

/**
 * Describe how a session is sharing data, for display in /settings and for
 * the layout to decide whether to listen for live updates
 *
 * @param {object} data - Session data
 * @returns {object} { mode, defaultMode, rooms, room, isJoined, channel,
 *   isShared }
 */
const getSharingDetails = (data) => {
  const channel = getChannelKey(data)
  return {
    mode,
    defaultMode: config.sharedData.mode,
    rooms,
    room: findRoom(data?.settings?.sharedData?.room),
    isJoined: isJoined(data),
    channel,
    isShared: Boolean(channel)
  }
}

const createChanges = () => ({ generationId: dataStore.state.generationId })

/**
 * Get the shared changes object for a channel, starting it afresh if it was
 * made against an older generation of seed data
 *
 * @param {string} channelKey - Channel key
 * @returns {object} Shared changes object
 */
const getChannelChanges = (channelKey) => {
  let changes = channels.get(channelKey)
  if (!changes || changes.generationId !== dataStore.state.generationId) {
    changes = createChanges()
    channels.set(channelKey, changes)
    channelKeyByChanges.set(changes, channelKey)
  }
  return changes
}

/**
 * Get the shared changes a session should read and write, or null if it
 * keeps its own. Remembers which session the data belongs to, so the changes
 * it records can be tagged with it.
 *
 * @param {object} data - Session data
 * @param {string} sessionId - The session's id
 * @returns {object | null} Shared changes object, or null when not sharing
 */
const getSharedChangesForSession = (data, sessionId) => {
  sessionIdByData.set(data, sessionId)
  const channelKey = getChannelKey(data)
  return channelKey ? getChannelChanges(channelKey) : null
}

/**
 * Whether a changes object is a shared one held here, rather than a
 * session's own
 *
 * @param {object} changes - A data._changes object
 * @returns {boolean} True if shared
 */
const isSharedChanges = (changes) => channelKeyByChanges.has(changes)

// The ids an event is about: the record's own id plus any ids it links to
// (clinicId, participantId and so on, or an issue's links), so a page showing
// a clinic hears about a change to one of its appointments
const getRelatedIds = (record) => {
  const ids = new Set([record.id])
  for (const [key, value] of Object.entries(record)) {
    if (key.endsWith('Id') && typeof value === 'string') ids.add(value)
  }
  for (const link of record.links || []) {
    if (typeof link?.id === 'string') ids.add(link.id)
  }
  return [...ids]
}

// The top-level fields that differ between two versions of a record, so a
// page can refresh just the part showing them. Null when it can't tell.
const getChangedFields = (previous, record) => {
  if (!previous || previous === record) return null
  const keys = new Set([...Object.keys(previous), ...Object.keys(record)])
  return [...keys].filter(
    (key) => !isDeepStrictEqual(previous[key], record[key])
  )
}

/**
 * Record a whole replacement record in the changes `data` is using, and tell
 * anyone sharing them that it changed. The update helpers call this - write
 * changes through it rather than into data._changes directly.
 *
 * @param {object} data - Session data
 * @param {string} collection - Collection name, eg 'appointments'
 * @param {object} record - Whole replacement record
 */
const recordChange = (data, collection, record) => {
  const changes = data?._changes?.[collection]
  if (!changes) return

  const channelKey = channelKeyByChanges.get(data._changes)
  const previous = channelKey
    ? (changes[record.id] ??
      dataStore.state[`${collection}ById`]?.get(record.id))
    : null

  changes[record.id] = record
  if (!channelKey) return

  events.emit('change', {
    channel: channelKey,
    type: 'change',
    collection,
    ids: getRelatedIds(record),
    fields: getChangedFields(previous, record),
    origin: sessionIdByData.get(data) || null
  })
}

/**
 * Clear a channel's shared changes and tell everyone on it
 *
 * @param {string} channelKey - Channel key
 * @param {string} [origin] - Id of the session that asked for the reset
 */
const resetChannel = (channelKey, origin = null) => {
  channels.delete(channelKey)
  events.emit('change', { channel: channelKey, type: 'reset', origin })
}

/**
 * Clear every channel's shared changes and tell everyone, for when the seed
 * data is regenerated
 *
 * @param {string} [origin] - Id of the session that regenerated the data
 */
const resetAllChannels = (origin = null) => {
  channels.clear()
  events.emit('change', { channel: ALL_CHANNELS, type: 'reset', origin })
}

// Tell everyone on a channel that who is signed in as a user has changed, so
// the choose user page can update
const emitPresenceChange = (sessionId, { channel, userId }) => {
  events.emit('change', {
    channel,
    type: 'change',
    collection: 'users',
    ids: [userId],
    fields: ['signedIn'],
    origin: sessionId
  })
}

/**
 * Stop counting a session as signed in, for when it is about to be reset
 * (the kit's reset gives the browser a new session id)
 *
 * @param {string} sessionId - The session's id
 */
const forgetPresence = (sessionId) => {
  const previous = presenceBySession.get(sessionId)
  if (!previous) return
  presenceBySession.delete(sessionId)
  emitPresenceChange(sessionId, previous)
}

/**
 * Note which user a session is signed in as, and on which channel. A session
 * that isn't sharing is forgotten.
 *
 * @param {string} sessionId - The session's id
 * @param {object} data - Session data
 */
const recordPresence = (sessionId, data) => {
  if (!sessionId) return
  const channel = getChannelKey(data)
  const userId = data?.currentUser?.id
  const previous = presenceBySession.get(sessionId)
  const isPreviousCurrent =
    previous && Date.now() - previous.lastSeen <= PRESENCE_TIMEOUT_MS

  if (!channel || !userId) {
    forgetPresence(sessionId)
    return
  }

  presenceBySession.set(sessionId, { channel, userId, lastSeen: Date.now() })

  if (
    isPreviousCurrent &&
    previous.channel === channel &&
    previous.userId === userId
  ) {
    return
  }
  if (isPreviousCurrent) emitPresenceChange(sessionId, previous)
  emitPresenceChange(sessionId, { channel, userId })
}

/**
 * Keep a session counted as signed in, for a page that is open but idle
 *
 * @param {string} sessionId - The session's id
 */
const touchPresence = (sessionId) => {
  const presence = presenceBySession.get(sessionId)
  if (presence) presence.lastSeen = Date.now()
}

/**
 * Count the other browsers signed in as each user on the same channel as
 * this session
 *
 * @param {object} data - Session data
 * @param {string} sessionId - The session's id, left out of the counts
 * @returns {object} User id -> number of other browsers signed in as them.
 *   Empty when the session isn't sharing.
 */
const getUsersSignedInElsewhere = (data, sessionId) => {
  const counts = {}
  const channel = getChannelKey(data)
  if (!channel) return counts

  const now = Date.now()
  for (const [otherSessionId, presence] of presenceBySession) {
    if (now - presence.lastSeen > PRESENCE_TIMEOUT_MS) {
      presenceBySession.delete(otherSessionId)
      continue
    }
    if (otherSessionId === sessionId || presence.channel !== channel) continue
    counts[presence.userId] = (counts[presence.userId] || 0) + 1
  }
  return counts
}

/**
 * Listen for changes on a channel
 *
 * @param {string} channelKey - Channel key
 * @param {Function} listener - Called with each event on that channel
 * @returns {Function} Call to stop listening
 */
const subscribe = (channelKey, listener) => {
  const handler = (event) => {
    if (event.channel === channelKey || event.channel === ALL_CHANNELS) {
      listener(event)
    }
  }
  events.on('change', handler)
  return () => events.off('change', handler)
}

module.exports = {
  MODES,
  getMode,
  setMode,
  getRooms,
  findRoom,
  setSharedDataSetting,
  isJoined,
  getChannelKey,
  getSharingDetails,
  getSharedChangesForSession,
  isSharedChanges,
  recordChange,
  resetChannel,
  resetAllChannels,
  recordPresence,
  touchPresence,
  forgetPresence,
  getUsersSignedInElsewhere,
  subscribe
}
