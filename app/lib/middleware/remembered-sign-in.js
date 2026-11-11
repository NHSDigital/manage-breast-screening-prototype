// app/lib/middleware/remembered-sign-in.js
//
// Remembers who a browser is signed in as, and its shared data room or
// whether it has joined sharing, in a long-lived cookie, so they survive a
// server restart (sessions are held in memory) and a data reset. Everything
// else in the session still starts afresh.

const { isDeepStrictEqual } = require('util')
const users = require('../../data/users')
const sharedData = require('../shared-data')

const COOKIE_NAME = 'rubie-remembered-sign-in'
const COOKIE_MAX_AGE_MS = 365 * 24 * 60 * 60 * 1000

/**
 * Restore the remembered user, room and joining into a session that hasn't had them
 * yet. Runs before the room link handling and the shared data attach, so a
 * restored room applies to this request.
 *
 * @param {object} req - Express request
 * @param {object} res - Express response
 * @param {Function} next - Next middleware
 */
const restoreRememberedSignIn = (req, res, next) => {
  const data = req.session?.data
  if (!data || data._isRememberedSignInRestored) return next()
  data._isRememberedSignInRestored = true

  const remembered = req.cookies?.[COOKIE_NAME]
  if (!remembered || typeof remembered !== 'object') return next()

  const user = users.find((candidate) => candidate.id === remembered.userId)
  // A link naming a user (?currentUserId=) wins: the kit has already stored
  // it, and the user swap in app/routes.js applies it
  const isUserSwapPending = data.currentUserId !== data.currentUser?.id
  if (user && !isUserSwapPending) {
    data.currentUserId = user.id
    data.currentUser = user
    res.locals.data.currentUserId = user.id
    res.locals.data.currentUser = user
  }

  const room = sharedData.findRoom(remembered.room)
  if (room) sharedData.setSharedDataSetting(data, 'room', room)
  if (remembered.joined === 'true') {
    sharedData.setSharedDataSetting(data, 'joined', 'true')
  }

  next()
}

/**
 * Save the current user, room and joining to the cookie when they have changed. Runs
 * after the user swap, so a change of user is saved straight away.
 *
 * @param {object} req - Express request
 * @param {object} res - Express response
 * @param {Function} next - Next middleware
 */
const rememberSignIn = (req, res, next) => {
  const data = req.session?.data
  if (!data?.currentUser) return next()

  const remembered = {
    userId: data.currentUser.id,
    room: data.settings?.sharedData?.room || '',
    joined: data.settings?.sharedData?.joined || ''
  }
  if (!isDeepStrictEqual(remembered, req.cookies?.[COOKIE_NAME])) {
    res.cookie(COOKIE_NAME, remembered, {
      maxAge: COOKIE_MAX_AGE_MS,
      httpOnly: true,
      sameSite: 'lax'
    })
  }
  next()
}

module.exports = {
  restoreRememberedSignIn,
  rememberSignIn
}
