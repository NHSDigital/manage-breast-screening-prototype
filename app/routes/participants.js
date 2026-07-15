// app/routes/participants.js

const {
  getParticipant,
  sortBySurname,
  saveTempParticipantToParticipant
} = require('../lib/utils/participants')
const {
  getEpisode,
  getEpisodesForParticipant,
  getCurrentEpisode,
  getEpisodeAppointments,
  getEpisodeMammogramDate,
  getEpisodeReadingStatus
} = require('../lib/utils/episodes')
const { getClinic } = require('../lib/utils/clinics')
const { findById } = require('../lib/utils/arrays')
const { createDynamicTemplateRoute } = require('../lib/utils/dynamic-routing')
const {
  getReturnUrl,
  urlWithReferrer,
  appendReferrer
} = require('../lib/utils/referrers')

module.exports = (router) => {
  // Set clinics to active in nav for all urls starting with /clinics
  router.use('/participants', (req, res, next) => {
    res.locals.navActive = 'participants'
    next()
  })

  const cleanSearchTerm = (term) => term.toLowerCase().replace(/\s+/g, '')

  // Redirect to default tab
  router.get('/participants', (req, res) => {
    const data = req.session.data
    const searchTerm = req.query.search?.trim() || ''
    const cleanedSearch = cleanSearchTerm(searchTerm)

    const allParticipants = sortBySurname(data.participants)
    let filteredParticipants = allParticipants

    if (searchTerm) {
      data.search = searchTerm
      res.locals.data.search = searchTerm

      filteredParticipants = allParticipants.filter((participant) => {
        const info = participant.demographicInformation

        const nameVariations = [
          [info.firstName, info.middleName, info.lastName]
            .filter(Boolean)
            .join(' '),
          `${info.firstName} ${info.lastName}`
        ].map((name) => name.toLowerCase())

        const postcode = cleanSearchTerm(info.address.postcode)
        const nhsNumber = cleanSearchTerm(
          participant.medicalInformation.nhsNumber
        )
        const sxNumber = cleanSearchTerm(participant.sxNumber)

        const nameMatch = nameVariations.some((name) =>
          name.includes(searchTerm.toLowerCase())
        )

        return (
          nameMatch ||
          postcode.includes(cleanedSearch) ||
          nhsNumber.includes(cleanedSearch) ||
          sxNumber.includes(cleanedSearch)
        )
      })
    }

    res.render('participants/index', {
      allParticipants,
      filteredParticipants,
      search: searchTerm,
      isFiltered: searchTerm.length > 0
    })
  })

  router.use('/participants/:participantId', (req, res, next) => {
    const participantId = req.params.participantId
    const data = req.session.data

    // console.log(`Looking up participant: ${participantId}`)

    const originalParticipant = getParticipant(data, participantId)

    if (!originalParticipant) {
      console.log(`No participant ${participantId} found`)
      res.redirect('/participants')
      return
    }

    // console.log(`Found participant: ${originalParticipant.demographicInformation.firstName} ${originalParticipant.demographicInformation.lastName}`)

    // We store a temporary copy of the participant to session for use by forms
    // If it doesn't exist, create it now
    if (!data.participant || data.participant?.id !== participantId) {
      if (!data.participant) {
        console.log('No temp participant data found, creating new one')
      } else if (data.participant?.id !== participantId) {
        console.log(
          `Temp participant data found, but participantId ${data.participant.id} does not match ${participantId}, creating new one`
        )
      }
      // Copy over the participant data to the temp participant.
      // Deep clone - a shallow spread would leave nested objects
      // (demographicInformation etc) shared with the read-only source record.
      data.participant = structuredClone(originalParticipant)
    }

    // This will now have any temp participant data that forms have added too
    // We'll later save this back to the source data using saveTempParticipantToParticipant
    res.locals.participant = data.participant
    res.locals.participantId = participantId

    res.locals.participantUrl = `/participants/${participantId}`
    res.locals.contextUrl = `/participants/${participantId}`

    // Store original participant data for reference if needed
    res.locals.originalParticipant = originalParticipant

    // Their open episode, if they have one - the participant page promotes
    // it above the history rather than listing it as history
    const currentEpisode = getCurrentEpisode(data, participantId)
    res.locals.currentEpisode = currentEpisode

    // A participant's screening history is their episodes, newest first. Past
    // rounds are summary-only episodes, so this covers their whole history
    // without needing old appointments to exist. The open episode is not
    // history, so it is left out.
    res.locals.episodeHistory = getEpisodesForParticipant(
      data,
      originalParticipant.id
    )
      .filter((episode) => episode.id !== currentEpisode?.id)
      .map((episode) => {
        // Screened rounds date by when their images were taken. A round with
        // no images (not yet screened, missed, cancelled) dates by its
        // appointment or its own dates instead - but never counts as screened
        const mammogramDate = getEpisodeMammogramDate(episode)
        const appointments = getEpisodeAppointments(data, episode)
        const latestAppointment = appointments[appointments.length - 1]

        return {
          episode,
          date:
            mammogramDate ||
            latestAppointment?.timing?.startTime ||
            episode.closedDate ||
            episode.openedDate,
          wasScreened: Boolean(mammogramDate)
        }
      })
      .reverse()

    next()
  })

  router.get('/participants/:participantId', (req, res) => {
    res.render('participants/show')
  })

  // Episode pages are casework pages, so they live under the participant -
  // an episode has no meaning without one. Registered here rather than in
  // routes/episodes.js so they land before the dynamic template catch-all
  // below, which would otherwise swallow them.
  router.use(
    '/participants/:participantId/episodes/:episodeId',
    (req, res, next) => {
      const data = req.session.data
      const episode = getEpisode(data, req.params.episodeId)

      // 404 unless the episode exists and belongs to this participant
      if (!episode || episode.participantId !== req.params.participantId) {
        return next()
      }

      res.locals.episode = episode

      // Where this episode sits in the participant's sequence, so the page
      // can link between their rounds
      const participantEpisodes = getEpisodesForParticipant(
        data,
        req.params.participantId
      )
      const episodeIndex = participantEpisodes.findIndex(
        (each) => each.id === episode.id
      )
      res.locals.previousEpisode = participantEpisodes[episodeIndex - 1] || null
      res.locals.nextEpisode = participantEpisodes[episodeIndex + 1] || null

      // Each appointment with the clinic it sat in, so pages can link back
      res.locals.episodeAppointments = getEpisodeAppointments(
        data,
        episode
      ).map((appointment) => ({
        appointment,
        clinic: getClinic(data, appointment.clinicId)
      }))

      res.locals.readingStatus = getEpisodeReadingStatus(data, episode)

      next()
    }
  )

  router.get(
    '/participants/:participantId/episodes/:episodeId',
    (req, res, next) => {
      // No episode loaded means the middleware above declined it
      if (!res.locals.episode) return next()

      res.render('episodes/show')
    }
  )

  router.get(
    '/participants/:participantId/*subPaths',
    createDynamicTemplateRoute({
      templatePrefix: 'participants'
    })
  )

  router.post('/participants/:participantId/save', (req, res) => {
    const data = req.session.data
    const participantId = req.params.participantId
    const referrerChain = req.query.referrerChain
    const successMessage =
      req.query.successMessage ||
      req.body.successMessage ||
      'Participant updated successfully'
    saveTempParticipantToParticipant(data)

    req.flash('success', successMessage)

    // Redirect back to the participant page
    const returnUrl = getReturnUrl(
      `/participants/${participantId}`,
      referrerChain
    )
    res.redirect(returnUrl)
  })
}
