// app/routes/participants.js

const { createDynamicTemplateRoute } = require('../lib/utils/dynamic-routing')
const {
  getParticipant,
  sortBySurname,
  getParticipantClinicHistory,
  saveTempParticipantToParticipant
} = require('../lib/utils/participants')
const { getReturnUrl } = require('../lib/utils/referrers')

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
      // Copy over the participant data to the temp participant
      data.participant = { ...originalParticipant }
    }

    // This will now have any temp participant data that forms have added too
    // We'll later save this back to the source data using saveTempParticipantToParticipant
    res.locals.participant = data.participant
    res.locals.participantId = participantId

    res.locals.participantUrl = `/participants/${participantId}`
    res.locals.contextUrl = `/participants/${participantId}`

    // Store original participant data for reference if needed
    res.locals.originalParticipant = originalParticipant

    // Get additional data that participant pages might need
    const clinicHistory = getParticipantClinicHistory(
      data,
      originalParticipant.id
    )
    res.locals.clinicHistory = clinicHistory

    next()
  })

  router.get('/participants/:participantId', (req, res) => {
    res.render('participants/show')
  })

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
