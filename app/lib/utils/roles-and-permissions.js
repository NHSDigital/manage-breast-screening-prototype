// app/lib/utils/roles-and-permissions.js

const { isMedicalHistoryItemRemoved } = require('./medical-information')
const { getUsername } = require('../../filters/nunjucks')

// Implanted devices that need a mammographer with implant imaging training.
// The prototype treats every device type as needing it - narrow this list if
// only some do.
const IMPLANT_IMAGING_DEVICE_TYPES = ['Cardiac device', 'Hickman line']

/**
 * Check if a user has a specific role
 *
 * @param {object} user - User object
 * @param {string} role - Role to check for
 * @returns {boolean} Whether user has the specified role
 */
const hasRole = (user, role) => {
  if (!user || !user.role || !Array.isArray(user.role)) return false
  return user.role.some(
    (userRole) => userRole.toLowerCase() === role.toLowerCase()
  )
}

/**
 * Check if a user has any of the specified roles
 *
 * @param {object} user - User object
 * @param {string[]} roles - Array of roles to check for
 * @returns {boolean} Whether user has any of the specified roles
 */
const hasAnyRole = (user, roles) => {
  if (!user || !user.role || !Array.isArray(user.role)) return false
  if (!Array.isArray(roles)) return hasRole(user, roles)

  return roles.some((role) => hasRole(user, role))
}

/**
 * Check if a user has all of the specified roles
 *
 * @param {object} user - User object
 * @param {string[]} roles - Array of roles to check for
 * @returns {boolean} Whether user has all of the specified roles
 */
const hasAllRoles = (user, roles) => {
  if (!user || !user.role || !Array.isArray(user.role)) return false
  if (!Array.isArray(roles)) return hasRole(user, roles)

  return roles.every((role) => hasRole(user, role))
}

/**
 * Check if a user has a specific permission
 *
 * Permissions sit alongside roles and cover specific things a user is trained
 * and signed off to do, such as imaging participants with implants.
 *
 * @param {object} user - User object
 * @param {string} permission - Permission to check for
 * @returns {boolean} Whether user has the specified permission
 */
const hasPermission = (user, permission) => {
  if (!user || !Array.isArray(user.permissions)) return false
  return user.permissions.some(
    (userPermission) =>
      userPermission.toLowerCase() === permission.toLowerCase()
  )
}

/**
 * Check if a user has any of the specified permissions
 *
 * @param {object} user - User object
 * @param {string[]} permissions - Array of permissions to check for
 * @returns {boolean} Whether user has any of the specified permissions
 */
const hasAnyPermission = (user, permissions) => {
  if (!Array.isArray(permissions)) return hasPermission(user, permissions)
  return permissions.some((permission) => hasPermission(user, permission))
}

// Breakdown of what on an appointment needs implant imaging training. Kept
// unexported so it doesn't become a Nunjucks filter.
const getImplantImagingNeeds = (appointment) => {
  const medicalHistory = appointment?.medicalInformation?.medicalHistory || {}

  const hasActiveBreastImplants = (
    medicalHistory.breastImplantsAugmentation || []
  ).some((item) => !isMedicalHistoryItemRemoved(item))

  const hasActiveDevice = (medicalHistory.implantedMedicalDevice || []).some(
    (item) => {
      if (isMedicalHistoryItemRemoved(item)) return false
      const deviceType = Array.isArray(item.type) ? item.type[0] : item.type
      return IMPLANT_IMAGING_DEVICE_TYPES.includes(deviceType)
    }
  )

  return { hasActiveBreastImplants, hasActiveDevice }
}

/**
 * Check whether an appointment needs a user with implant imaging training
 *
 * Breast implants and implanted medical devices both need it, but only while
 * they are still in place - once removed, any clinician can image the
 * participant.
 *
 * @param {object} appointment - Appointment object
 * @returns {boolean} Whether implant imaging training is needed
 */
const requiresImplantImaging = (appointment) => {
  const { hasActiveBreastImplants, hasActiveDevice } =
    getImplantImagingNeeds(appointment)

  return hasActiveBreastImplants || hasActiveDevice
}

/**
 * Describe why an appointment needs a mammographer with implant imaging
 * training, for use in page content
 *
 * @param {object} appointment - Appointment object
 * @returns {string} Reason text, or '' when implant imaging is not needed
 */
const getImplantImagingReason = (appointment) => {
  const { hasActiveBreastImplants, hasActiveDevice } =
    getImplantImagingNeeds(appointment)

  if (hasActiveBreastImplants && hasActiveDevice) {
    return 'breast implants and an implanted medical device'
  }
  if (hasActiveBreastImplants) return 'breast implants'
  if (hasActiveDevice) return 'an implanted medical device'
  return ''
}

/**
 * Check whether an authorised mammographer other than the current user has
 * been nominated to take the images for an appointment
 *
 * @param {object} appointment - Appointment object
 * @returns {boolean} Whether an authorised mammographer has been nominated
 */
const hasNominatedAuthorisedMammographer = (appointment) => {
  return Boolean(
    appointment?.authorisedMammographerId ||
    appointment?.authorisedMammographerOtherName
  )
}

/**
 * Get the display name of the authorised mammographer nominated for an
 * appointment
 *
 * Returns '' when nobody has been nominated, so callers can decide their own
 * fallback.
 *
 * @param {object} appointment - Appointment object
 * @param {object} [options] - Display options, as accepted by getUsername
 * @returns {string} Nominated authorised mammographer's name, or ''
 */
const getAuthorisedMammographerName = function (appointment, options = {}) {
  if (appointment?.authorisedMammographerId) {
    return getUsername.call(this, appointment.authorisedMammographerId, options)
  }
  return appointment?.authorisedMammographerOtherName || ''
}

/**
 * Check whether a user is able to screen a given appointment
 *
 * Keeps the mapping from appointment needs to permissions in one place, so
 * call sites do not have to name permissions themselves.
 *
 * @param {object} user - User object
 * @param {object} appointment - Appointment object
 * @returns {boolean} Whether the user can screen this appointment
 */
const canUserScreenAppointment = (user, appointment) => {
  if (!isClinician(user)) return false
  if (requiresImplantImaging(appointment)) {
    return hasPermission(user, 'implantImaging')
  }
  return true
}

/**
 * Check if a user is a clinician
 *
 * @param {object} user - User object
 * @returns {boolean} Whether user is a clinician
 */
const isClinician = (user) => {
  return hasRole(user, 'clinician')
}

/**
 * Check if a user has an administrative role
 *
 * @param {object} user - User object
 * @returns {boolean} Whether user has administrative role
 */
const isAdministrative = (user) => {
  return hasRole(user, 'administrative')
}

/**
 * Check if a user has both clinical and administrative roles
 *
 * @param {object} user - User object
 * @returns {boolean} Whether user has both roles
 */
const isHybridUser = (user) => {
  return hasAllRoles(user, ['clinician', 'administrative'])
}

/**
 * Get all roles for a user as formatted string
 *
 * @param {object} user - User object
 * @param {string} separator - Separator between roles (default: ', ')
 * @returns {string} Formatted roles string
 */
const getRolesText = (user, separator = ', ') => {
  if (!user || !user.role || !Array.isArray(user.role)) return ''
  return user.role
    .map((role) => role.charAt(0).toUpperCase() + role.slice(1))
    .join(separator)
}

/**
 * Check if a user is the current user
 *
 * @param {object} user - User object to check
 * @returns {boolean} Whether this user is the current user
 */
const isCurrentUser = function (user) {
  const data = this.ctx.data
  if (!user || !data?.currentUser) return false
  if (typeof user === 'string') {
    return user === data.currentUser.id
  } else return user.id === data.currentUser.id
}

// Actions in an appointment's authors that mean someone took over running it
const RUNNING_ACTIONS = ['started', 'resumed']

/**
 * Get the id of the user running an appointment now: whoever last started or
 * resumed it. startedBy keeps whoever first started it.
 *
 * Falls back to startedBy for records with no started or resumed authors,
 * such as some seed data.
 *
 * @param {object} appointment - Appointment object
 * @returns {string | null} User id, or null if it hasn't been started
 * @example
 * {{ appointment | getAppointmentRunnerId | getUsername({ format: "short" }) }}
 */
const getAppointmentRunnerId = (appointment) => {
  const sessionDetails = appointment?.sessionDetails
  const lastRun = [...(sessionDetails?.authors || [])]
    .reverse()
    .find((author) => RUNNING_ACTIONS.includes(author.action))
  return lastRun?.userId || sessionDetails?.startedBy || null
}

/**
 * Check if an appointment is being run by the current user, meaning they
 * last started or resumed it
 *
 * @param {object} appointment - Appointment object to check
 * @returns {boolean} Whether the current user is running the appointment
 */
const isRunByCurrentUser = function (appointment) {
  const currentUser = this?.ctx?.data?.currentUser
  const currentUserId =
    typeof currentUser === 'string' ? currentUser : currentUser?.id
  const runnerId = getAppointmentRunnerId(appointment)
  return Boolean(currentUserId && runnerId === currentUserId)
}

/**
 * Get the ids of everyone who ran an appointment, in the order they joined
 * it: whoever started it, everyone in its authors, and whoever ended it
 *
 * @param {object} appointment - Appointment object
 * @returns {Array<string>} User ids, without repeats
 */
const getAppointmentRunByIds = (appointment) => {
  const sessionDetails = appointment?.sessionDetails || {}
  return [
    ...new Set(
      [
        sessionDetails.startedBy,
        ...(sessionDetails.authors || []).map((author) => author.userId),
        sessionDetails.endedBy
      ].filter(Boolean)
    )
  ]
}

/**
 * Get the names of everyone who ran an appointment, for showing everyone
 * involved where there is space
 *
 * @param {object} appointment - Appointment object
 * @param {object} [options] - Display options, as accepted by getUsername
 * @returns {Array<string>} Names, in the order they joined the appointment
 * @example
 * {{ appointment | getAppointmentRunByNames({ format: "reversed" }) | formatList }}
 */
const getAppointmentRunByNames = function (appointment, options = {}) {
  return getAppointmentRunByIds(appointment).map((userId) =>
    getUsername.call(this, userId, options)
  )
}

/**
 * Get the name of whoever screened an appointment, for showing one name in a
 * tight space. While it is running, that is whoever is running it. Once it
 * has ended, who took the images matters most: the nominated authorised
 * mammographer if there is one, otherwise whoever ended it.
 *
 * @param {object} appointment - Appointment object
 * @param {object} [options] - Display options, as accepted by getUsername
 * @returns {string} Name, or '' if the appointment hasn't been started
 * @example
 * {{ appointment | getScreenedByName({ format: "short", identifyCurrentUser: true }) }}
 */
const getScreenedByName = function (appointment, options = {}) {
  const endedBy = appointment?.sessionDetails?.endedBy
  if (!endedBy) {
    return getUsername.call(this, getAppointmentRunnerId(appointment), options)
  }
  return (
    getAuthorisedMammographerName.call(this, appointment, options) ||
    getUsername.call(this, endedBy, options)
  )
}

module.exports = {
  hasRole,
  hasAnyRole,
  hasAllRoles,
  hasPermission,
  hasAnyPermission,
  requiresImplantImaging,
  getImplantImagingReason,
  hasNominatedAuthorisedMammographer,
  getAuthorisedMammographerName,
  canUserScreenAppointment,
  isClinician,
  isAdministrative,
  isHybridUser,
  getRolesText,
  isCurrentUser,
  getAppointmentRunnerId,
  isRunByCurrentUser,
  getAppointmentRunByIds,
  getAppointmentRunByNames,
  getScreenedByName
}
