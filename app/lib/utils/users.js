// app/lib/utils/users.js

/**
 * Format a user's name as 'Firstname Lastname'
 *
 * The one format for staff names wherever they appear.
 *
 * @param {object} user - User object
 * @returns {string} Formatted name, or empty string if unavailable
 * @example
 * formatUserName(user) // 'Jane Hitchin'
 */
const formatUserName = (user) => {
  if (!user) return ''
  return [user.firstName, user.lastName].filter(Boolean).join(' ')
}

/**
 * Sort users alphabetically by first name, then last name
 *
 * For lists of colleagues such as radios, selects and filters. Returns a new
 * array.
 *
 * @param {Array} users - User objects
 * @returns {Array} Sorted copy of the users
 * @example
 * {% for user in data.users | sortUsersByName %}
 */
const sortUsersByName = (users) => {
  return [...(users || [])].sort(
    (a, b) =>
      a.firstName.localeCompare(b.firstName) ||
      a.lastName.localeCompare(b.lastName)
  )
}

module.exports = {
  formatUserName,
  sortUsersByName
}
