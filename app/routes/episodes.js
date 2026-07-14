// app/routes/episodes.js
//
// Minimal episode views. Deliberately not in the nav yet - the casework IA
// work decides how episodes are navigated to. These exist so the episode
// entity is reachable and provable in the real app, and so the participant
// page has somewhere to link to.

const {
  EPISODE_STAGES,
  getEpisode,
  getEpisodeEvents,
  getEpisodeReadingStatus
} = require('../lib/utils/episodes')
const { getParticipant } = require('../lib/utils/participants')
const { getClinic } = require('../lib/utils/clinics')

// Enough rows to browse without rendering thousands
const INDEX_LIMIT = 100

module.exports = (router) => {
  // Index. Filterable by stage, so each stage of the process can be looked at
  // and spot-checked.
  router.get('/episodes', (req, res) => {
    const data = req.session.data
    const stage = req.query.stage

    const allEpisodes = data.episodes || []

    const matching = stage
      ? allEpisodes.filter((episode) => episode.stage === stage)
      : allEpisodes.filter((episode) => episode.stage !== 'closed')

    // Newest first - the interesting ones are the recent ones
    const sorted = [...matching].sort(
      (a, b) => new Date(b.openedDate) - new Date(a.openedDate)
    )

    // Count per stage for the filter links, from the unfiltered set
    const countsByStage = Object.fromEntries(
      EPISODE_STAGES.map((name) => [
        name,
        allEpisodes.filter((episode) => episode.stage === name).length
      ])
    )

    res.render('episodes/index', {
      episodes: sorted.slice(0, INDEX_LIMIT).map((episode) => ({
        episode,
        participant: getParticipant(data, episode.participantId)
      })),
      stage,
      countsByStage,
      totalMatching: matching.length,
      limit: INDEX_LIMIT,
      openCount: allEpisodes.filter((episode) => episode.stage !== 'closed')
        .length
    })
  })

  router.get('/episodes/:episodeId', (req, res, next) => {
    const data = req.session.data
    const episode = getEpisode(data, req.params.episodeId)

    if (!episode) return next()

    // Each appointment with the clinic it sat in, so the page can link back
    const appointments = getEpisodeEvents(data, episode).map((event) => ({
      event,
      clinic: getClinic(data, event.clinicId)
    }))

    res.render('episodes/show', {
      episode,
      participant: getParticipant(data, episode.participantId),
      appointments,
      readingStatus: getEpisodeReadingStatus(data, episode)
    })
  })
}
