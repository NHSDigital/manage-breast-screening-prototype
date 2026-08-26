// app/lib/utils/search.js
//
// Free-text searching for a participant, shared by every list that offers a
// search box - the reading case backlog, the participant index - so they all
// match the same things.
//
// Lists present names as "SURNAME, Firstname", so a name copied out of one and
// pasted into a search box arrives comma-first. A comma in the query is taken
// as that form and the flipped "firstname surname" reading is tried too.

/**
 * The forms of a search query worth matching against.
 *
 * Trimmed, lowercased and with runs of whitespace collapsed. A comma adds the
 * flipped reading, so "Smith, Jane" also searches for "jane smith".
 *
 * @param {string} query - Raw search text
 * @returns {Array<string>} Query variants, empty when there's nothing to search
 */
const normaliseSearchQuery = (query) => {
  const cleaned = String(query || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')

  if (!cleaned) return []

  const variants = [cleaned]

  if (cleaned.includes(',')) {
    const parts = cleaned
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean)

    // "surname, firstname" read the other way round
    if (parts.length === 2) variants.push(`${parts[1]} ${parts[0]}`)

    // and with the comma simply dropped
    variants.push(parts.join(' '))
  }

  return [...new Set(variants)]
}

/**
 * The name orderings a participant could be searched by.
 *
 * @param {object} participant - Participant record
 * @returns {Array<string>} Lowercased names
 */
const getSearchableNames = (participant) => {
  const info = participant?.demographicInformation || {}
  const { firstName, middleName, lastName } = info

  return [
    [firstName, lastName],
    [firstName, middleName, lastName]
  ]
    .map((parts) => parts.filter(Boolean).join(' '))
    .concat([
      [lastName, firstName].filter(Boolean).join(' '),
      [lastName, [firstName, middleName].filter(Boolean).join(' ')]
        .filter(Boolean)
        .join(', ')
    ])
    .filter(Boolean)
    .map((name) => name.toLowerCase())
}

/**
 * Whether a participant matches a free-text search of their name or NHS
 * number. An empty query matches everything.
 *
 * @param {object} participant - Participant record
 * @param {string} query - Search text
 * @returns {boolean}
 */
const participantMatchesQuery = (participant, query) => {
  const needles = normaliseSearchQuery(query)
  if (!needles.length) return true
  if (!participant) return false

  const names = getSearchableNames(participant)
  const nhsNumber = (
    participant.medicalInformation?.nhsNumber || ''
  ).replace(/\s/g, '')

  return needles.some((needle) => {
    if (names.some((name) => name.includes(needle))) return true

    const digits = needle.replace(/\s/g, '')

    return Boolean(digits) && nhsNumber.includes(digits)
  })
}

module.exports = {
  normaliseSearchQuery,
  getSearchableNames,
  participantMatchesQuery
}
