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
 * Get the clinicians who can image participants with implants or devices,
 * sorted by surname then first name
 *
 * @param {object[]} users - Array of user objects
 * @returns {object[]} Clinicians holding the implantImaging permission
 */
const getImplantImagingUsers = (users) => {
  if (!Array.isArray(users)) return []
  return users
    .filter(
      (user) => isClinician(user) && hasPermission(user, 'implantImaging')
    )
    .sort(
      (userA, userB) =>
        userA.lastName.localeCompare(userB.lastName) ||
        userA.firstName.localeCompare(userB.firstName)
    )
}

/**
 * Check whether a mammographer other than the current user has been nominated
 * to take the images for an appointment
 *
 * @param {object} appointment - Appointment object
 * @returns {boolean} Whether a mammographer has been nominated
 */
const hasNominatedOperator = (appointment) => {
  return Boolean(appointment?.operatorId || appointment?.operatorOtherName)
}

/**
 * Get the display name of the mammographer nominated for an appointment
 *
 * Returns '' when nobody has been nominated, so callers can decide their own
 * fallback.
 *
 * @param {object} appointment - Appointment object
 * @param {object} [options] - Display options, as accepted by getUsername
 * @returns {string} Nominated mammographer's name, or ''
 */
const getAppointmentOperatorName = function (appointment, options = {}) {
  if (appointment?.operatorId) {
    return getUsername.call(this, appointment.operatorId, options)
  }
  return appointment?.operatorOtherName || ''
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

/**
 * Check if an appointment was started by the current user
 *
 * @param {object} appointment - Appointment object to check
 * @returns {boolean} Whether the appointment was started by the current user
 */
const startedByCurrentUser = function (appointment) {
  const data = this.ctx.data
  if (!appointment?.sessionDetails?.startedBy || !data?.currentUser) return false

  const currentUserId =
    typeof data.currentUser === 'string'
      ? data.currentUser
      : data.currentUser.id

  return appointment.sessionDetails.startedBy === currentUserId
}

module.exports = {
  hasRole,
  hasAnyRole,
  hasAllRoles,
  hasPermission,
  hasAnyPermission,
  requiresImplantImaging,
  getImplantImagingReason,
  getImplantImagingUsers,
  hasNominatedOperator,
  getAppointmentOperatorName,
  canUserScreenAppointment,
  isClinician,
  isAdministrative,
  isHybridUser,
  getRolesText,
  isCurrentUser,
  startedByCurrentUser
}
