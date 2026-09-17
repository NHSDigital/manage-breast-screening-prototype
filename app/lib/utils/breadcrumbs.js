// app/lib/utils/breadcrumbs.js
//
// Case pages carry a participant-rooted breadcrumb answering "whose case is
// this" - the same trail however the page was reached. The workflow container
// (clinic, reading list) is a separate fixed back link, so most case pages
// show both. The current page is never included in the trail.

const { getFullNameReversed } = require('./participants')
const { getEpisodeLabel } = require('./episodes')
const { getParticipantUrl, getEpisodeUrl } = require('./urls')

/**
 * Build breadcrumb items for a case page, ending at the deepest ancestor
 * passed in - the current page itself is not included
 *
 * @param {object} [participant] - Participant the page relates to
 * @param {object} [episode] - Episode the page relates to
 * @returns {Array} Items for the NHS breadcrumb macro
 * @example
 * getCaseBreadcrumb() // Participants
 * getCaseBreadcrumb(participant) // Participants > SMITH, Jane
 * getCaseBreadcrumb(participant, episode) // Participants > SMITH, Jane > June 2026 episode
 */
const getCaseBreadcrumb = (participant = null, episode = null) => {
  const items = [{ href: '/participants', text: 'Participants' }]

  if (participant) {
    items.push({
      href: getParticipantUrl(participant),
      text: getFullNameReversed(participant)
    })
  }

  if (participant && episode) {
    items.push({
      href: getEpisodeUrl(episode),
      text: getEpisodeLabel(episode)
    })
  }

  return items
}

module.exports = {
  getCaseBreadcrumb
}
