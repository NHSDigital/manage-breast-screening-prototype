// app/lib/real-images-access.js
//
// Access code for real mammogram images. Deployed, real images also need an
// access code (REAL_IMAGES_ACCESS_CODE) on top of the prototype password.
// Entering it unlocks real images for that session, for a few hours. Changing
// the code locks every session straight away, because a session stores a hash
// of the code it was unlocked with.
//
// The unlock is kept in data._realImagesAccess: the kit never stores
// underscore-prefixed form or query fields, so it can't be set from a form or
// a link. See docs/mammogram-images.md.

const crypto = require('crypto')
const config = require('../config')

// Codes are compared ignoring case and all spaces, so they're easy to type on
// a workstation
const normaliseCode = (code) =>
  String(code ?? '')
    .replace(/\s+/g, '')
    .toLowerCase()

const hashCode = (code) =>
  crypto.createHash('sha256').update(normaliseCode(code)).digest('hex')

const getAccessCode = () => normaliseCode(process.env.REAL_IMAGES_ACCESS_CODE)

/**
 * Whether real images need an access code, and whether one is set.
 * Deployed (NODE_ENV=production) a code is always needed, so a missing code
 * keeps real images locked rather than open.
 *
 * @returns {'not-needed' | 'needed' | 'not-set'} 'not-needed' when running
 *   locally without a code
 */
const getAccessCodeStatus = () => {
  if (getAccessCode()) return 'needed'
  return process.env.NODE_ENV === 'production' ? 'not-set' : 'not-needed'
}

/**
 * Whether a session can see real images.
 *
 * @param {object} [data] - Session data (req.session.data)
 * @returns {boolean} True when no code is needed, or the session was unlocked
 *   with the current code within the last config.reading.realImagesAccessHours
 */
const isRealImagesUnlocked = (data) => {
  const status = getAccessCodeStatus()
  if (status === 'not-needed') return true
  if (status === 'not-set') return false

  const access = data?._realImagesAccess
  if (!access?.codeHash || !access.unlockedAt) return false

  const accessMs = config.reading.realImagesAccessHours * 60 * 60 * 1000
  if (Date.now() - access.unlockedAt > accessMs) return false

  const expected = Buffer.from(hashCode(getAccessCode()))
  const actual = Buffer.from(String(access.codeHash))
  return (
    actual.length === expected.length &&
    crypto.timingSafeEqual(actual, expected)
  )
}

/**
 * Unlock real images for a session if the code is right.
 *
 * @param {object} data - Session data (req.session.data)
 * @param {string} enteredCode - The code the user entered
 * @returns {boolean} True if the code was right and the session is unlocked
 */
const unlockRealImages = (data, enteredCode) => {
  const accessCode = getAccessCode()
  if (!accessCode || !normaliseCode(enteredCode)) return false

  const expected = Buffer.from(hashCode(accessCode))
  const actual = Buffer.from(hashCode(enteredCode))
  if (!crypto.timingSafeEqual(actual, expected)) return false

  data._realImagesAccess = {
    codeHash: hashCode(accessCode),
    unlockedAt: Date.now()
  }
  return true
}

module.exports = {
  getAccessCodeStatus,
  isRealImagesUnlocked,
  unlockRealImages
}
