// app/lib/utils/roles-and-permissions.js

/**
 * Check if a user has a specific role
 * @param {Object} user - User object
 * @param {string} role - Role to check for
 * @returns {boolean} Whether user has the specified role
 */
const hasRole = (user, role) => {
  if (!user || !user.role || !Array.isArray(user.role)) return false
  return user.role.some(userRole => userRole.toLowerCase() === role.toLowerCase())
}

/**
 * Check if a user has any of the specified roles
 * @param {Object} user - User object
 * @param {string[]} roles - Array of roles to check for
 * @returns {boolean} Whether user has any of the specified roles
 */
const hasAnyRole = (user, roles) => {
  if (!user || !user.role || !Array.isArray(user.role)) return false
  if (!Array.isArray(roles)) return hasRole(user, roles)

  return roles.some(role => hasRole(user, role))
}

/**
 * Check if a user has all of the specified roles
 * @param {Object} user - User object
 * @param {string[]} roles - Array of roles to check for
 * @returns {boolean} Whether user has all of the specified roles
 */
const hasAllRoles = (user, roles) => {
  if (!user || !user.role || !Array.isArray(user.role)) return false
  if (!Array.isArray(roles)) return hasRole(user, roles)

  return roles.every(role => hasRole(user, role))
}

/**
 * Check if a user is a clinician
 * @param {Object} user - User object
 * @returns {boolean} Whether user is a clinician
 */
const isClinician = (user) => {
  return hasRole(user, 'clinician')
}

/**
 * Check if a user has an administrative role
 * @param {Object} user - User object
 * @returns {boolean} Whether user has administrative role
 */
const isAdministrative = (user) => {
  return hasRole(user, 'administrative')
}

/**
 * Check if a user has both clinical and administrative roles
 * @param {Object} user - User object
 * @returns {boolean} Whether user has both roles
 */
const isHybridUser = (user) => {
  return hasAllRoles(user, ['clinician', 'administrative'])
}

/**
 * Get all roles for a user as formatted string
 * @param {Object} user - User object
 * @param {string} separator - Separator between roles (default: ', ')
 * @returns {string} Formatted roles string
 */
const getRolesText = (user, separator = ', ') => {
  if (!user || !user.role || !Array.isArray(user.role)) return ''
  return user.role.map(role => role.charAt(0).toUpperCase() + role.slice(1)).join(separator)
}

/**
 * Check if a user is the current user
 * @param {Object} user - User object to check
 * @param {Object} data - Session data containing currentUser
 * @returns {boolean} Whether this user is the current user
 */
const isCurrentUser = (user, data) => {
  if (!user || !data?.currentUser) return false
  return user.id === data.currentUser.id
}

module.exports = {
  hasRole,
  hasAnyRole,
  hasAllRoles,
  isClinician,
  isAdministrative,
  isHybridUser,
  getRolesText,
  isCurrentUser
}