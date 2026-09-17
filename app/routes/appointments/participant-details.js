// app/routes/appointments/participant-details.js
//
// Participant edits made from within an appointment - ethnicity
// and saving the temp participant back to the participants array.

const {
  saveTempParticipantToParticipant
} = require('../../lib/utils/participants')
const {
  getReturnUrl,
  urlWithReferrer,
  modalBreakout
} = require('../../lib/utils/referrers')

module.exports = (router) => {
  router.post(
    '/clinics/:clinicId/appointments/:appointmentId/personal-details/ethnicity-answer',
    (req, res) => {
      const { clinicId, appointmentId } = req.params
      const data = req.session.data
      const selectedEthnicBackground =
        data.participant?.demographicInformation?.ethnicBackground

      if (!selectedEthnicBackground) {
        req.flash('error', {
          text: 'Select an ethnic background',
          name: 'participant[demographicInformation][ethnicBackground]',
          href: '#ethnicBackgroundWhite'
        })

        res.redirect(
          urlWithReferrer(
            `/clinics/${clinicId}/appointments/${appointmentId}/personal-details/ethnicity`,
            req.query.referrerChain
          )
        )
        return
      }

      // Map ethnic background to ethnic group
      if (
        selectedEthnicBackground &&
        selectedEthnicBackground !== 'Prefer not to say'
      ) {
        const ethnicGroup = getEthnicGroupFromBackground(
          selectedEthnicBackground
        )
        if (ethnicGroup) {
          data.participant.demographicInformation.ethnicGroup = ethnicGroup
        }

        // Handle "Other" background details consolidation
        cleanupOtherEthnicBackgroundDetails(data)
      } else if (selectedEthnicBackground === 'Prefer not to say') {
        // Clear both fields if they prefer not to say
        data.participant.demographicInformation.ethnicGroup = null
        data.participant.demographicInformation.ethnicBackground =
          'Prefer not to say'
        data.participant.demographicInformation.otherEthnicBackgroundDetails =
          null
      }

      // Save the participant data back to the main array
      saveTempParticipantToParticipant(data)

      req.flash('success', 'Ethnicity updated')
      // Redirect back to the appointment page (or wherever appropriate)

      const returnUrl = getReturnUrl(
        `/clinics/${clinicId}/appointments/${appointmentId}`,
        req.query.referrerChain
      )
      res.redirect(modalBreakout(returnUrl))
    }
  )

  // Helper function to clean up otherEthnicBackgroundDetails from array to single value
  function cleanupOtherEthnicBackgroundDetails(data) {
    const otherDetails =
      data.participant?.demographicInformation?.otherEthnicBackgroundDetails

    if (Array.isArray(otherDetails)) {
      // Filter out empty strings and take the first non-empty value
      const cleanedDetails = otherDetails.filter(
        (detail) => detail && detail.trim()
      )
      data.participant.demographicInformation.otherEthnicBackgroundDetails =
        cleanedDetails.length > 0 ? cleanedDetails[0].trim() : null
    }
    // If it's already a string or null, leave it as is
  }

  // Helper function to map ethnic background to ethnic group
  function getEthnicGroupFromBackground(ethnicBackground) {
    const ethnicities = require('../../data/ethnicities')

    for (const [group, backgrounds] of Object.entries(ethnicities)) {
      if (backgrounds.includes(ethnicBackground)) {
        return group
      }
    }

    return null // Return null if no match found
  }


  // Save participant data when contact details are updated from the participant tab.
  // The contact-details form posts back to the participant tab URL via referrerChain,
  // so we need this POST handler to persist the temp participant to the participants array.
  router.post('/clinics/:clinicId/appointments/:appointmentId/participant', (req, res) => {
    const { clinicId, appointmentId } = req.params
    const data = req.session.data
    saveTempParticipantToParticipant(data)
    req.flash('success', 'Participant details updated')
    res.redirect(`/clinics/${clinicId}/appointments/${appointmentId}/participant`)
  })
}
