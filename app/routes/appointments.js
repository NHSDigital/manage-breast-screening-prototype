// app/routes/appointments.js
const dayjs = require('dayjs')
const _ = require('lodash')

const {
  getParticipant,
  getFullName,
  saveTempParticipantToParticipant
} = require('../lib/utils/participants')
const {
  generateMammogramImages
} = require('../lib/generators/mammogram-generator')
const {
  getAppointment,
  getAppointmentData,
  saveTempAppointmentToAppointment,
  updateAppointmentStatus,
  updateAppointmentData
} = require('../lib/utils/appointment-data')
const generateId = require('../lib/utils/id-generator')
const {
  getReturnUrl,
  urlWithReferrer,
  appendReferrer,
  modalBreakout
} = require('../lib/utils/referrers')
const { createDynamicTemplateRoute } = require('../lib/utils/dynamic-routing')
const { isAppointmentWorkflow } = require('../lib/utils/status')
const { sentenceCase } = require('../lib/utils/strings')
const { getImageSetForAppointment } = require('../lib/utils/mammogram-images')
const {
  ensureSeedProfilesState,
  getSeedDataProfileFromState
} = require('../lib/generators/seed-profiles')
// Load symptom types data
const symptomTypes = require('../data/symptom-types')

/**
 * Capture session end time for an appointment
 * @param {object} data - Session data
 * @param {string} appointmentId - Appointment ID
 * @param {string} userId - User ID ending the session
 */
function captureSessionEndTime(data, appointmentId, userId) {
  const appointment = getAppointment(data, appointmentId)
  updateAppointmentData(data, appointmentId, {
    sessionDetails: {
      ...appointment.sessionDetails,
      endedAt: new Date().toISOString(),
      endedBy: userId
    }
  })
}

module.exports = (router) => {
  // Set clinics to active in nav for all urls starting with /clinics
  router.use('/clinics/:clinicId/appointments/:appointmentId', (req, res, next) => {
    const appointmentId = req.params.appointmentId
    const clinicId = req.params.clinicId
    const originalAppointmentData = getAppointmentData(req.session.data, clinicId, appointmentId)
    const data = req.session.data

    if (!originalAppointmentData) {
      console.log(`No appointment ${appointmentId} found for clinic ${clinicId}`)
      res.redirect('/clinics/' + clinicId)
      return
    }

    // We store a temporary copy of the appointment to session for use by forms
    // If it doens't exist, create it now
    if (!data.appointment || data.appointment?.id !== appointmentId) {
      if (!data.appointment) {
        console.log('No temp appointment data found, creating new one')
      } else if (data.appointment?.id !== appointmentId) {
        console.log(
          `Temp appointment data found, but appointmentId ${data.appointment.id} does not match ${appointmentId}, creating new one`
        )
      }
      // Copy over the appointment data to the temp appointment.
      // Must be a deep clone: the temp copy gets mutated by forms, and the
      // source record is shared (read-only) data that other sessions see.
      data.appointment = structuredClone(originalAppointmentData.appointment)
    }

    const participantId = originalAppointmentData.participant.id
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
      data.participant = structuredClone(originalAppointmentData.participant)
    }

    // Deep compare temp participant and saved participant in array
    const savedParticipant = data.participants.find(
      (p) => p.id === data.participant.id
    )
    res.locals.participantHasUnsavedChanges = !_.isEqual(
      data.participant,
      savedParticipant
    )

    // Deep compare temp appointment and saved appointment in array, excluding workflowStatus
    const savedAppointment = data.appointments.find((e) => e.id === data.appointment.id)
    const tempAppointmentForCompare = data.appointment ? { ...data.appointment } : undefined
    const savedAppointmentForCompare = savedAppointment ? { ...savedAppointment } : undefined
    if (tempAppointmentForCompare) delete tempAppointmentForCompare.workflowStatus
    if (savedAppointmentForCompare) delete savedAppointmentForCompare.workflowStatus
    res.locals.appointmentHasUnsavedChanges = !_.isEqual(
      tempAppointmentForCompare,
      savedAppointmentForCompare
    )

    // This will now have any temp appointment data that forms have added too
    // We'll later save this back to the source data
    res.locals.appointment = data.appointment

    res.locals.appointmentData = originalAppointmentData

    // Attach location to clinic for template convenience
    const clinic = { ...originalAppointmentData.clinic }
    if (originalAppointmentData.location) {
      clinic.location = originalAppointmentData.location
    }
    res.locals.clinic = clinic

    res.locals.isAppointmentWorkflow = isAppointmentWorkflow(
      data.appointment,
      data.currentUser
    )

    res.locals.participant = data.participant
    res.locals.participantId = participantId
    res.locals.originalParticipant = savedParticipant
    res.locals.appointmentUrl = `/clinics/${clinicId}/appointments/${appointmentId}`
    res.locals.contextUrl = `/clinics/${clinicId}/appointments/${appointmentId}`
    res.locals.pageContext = 'appointment'
    res.locals.unit = originalAppointmentData.unit
    res.locals.clinicId = clinicId
    res.locals.appointmentId = appointmentId

    // Ensure latest session data is available to views
    res.locals.data = req.session.data

    next()
  })

  // Main route for starting a new appointment
  router.get('/clinics/:clinicId/appointments/:appointmentId/start', (req, res) => {
    const data = req.session.data
    const appointment = getAppointment(data, req.params.appointmentId)
    const currentUser = data.currentUser
    const returnTo = req.query.returnTo // Used by /index so we can 'start' an appointment but then go to a different page.
    delete data.returnTo // Clean up session - we're using query string explicitly here

    console.log(
      `Starting appointment for appointment ${req.params.appointmentId} by user ${currentUser.id}`
    )

    // Only allow starting appointments that haven't been started yet (scheduled or checked in, not paused or already in progress)
    if (
      appointment?.status === 'appointment_scheduled' ||
      appointment?.status === 'appointment_checked_in'
    ) {
      // Update status to in progress
      updateAppointmentStatus(data, req.params.appointmentId, 'appointment_in_progress')

      // Store session details
      updateAppointmentData(data, req.params.appointmentId, {
        sessionDetails: {
          startedAt: new Date().toISOString(),
          startedBy: currentUser.id,
          pausedAt: null,
          pausedBy: null,
          authors: []
        }
      })
    }

    // Parse and apply workflow status from query parameters
    // This lets links in index.njk pre-complete certain sections
    // Look for parameters like appointment[workflowStatus][section]=completed
    if (req.query.appointment && req.query.appointment.workflowStatus) {
      const workflowUpdates = req.query.appointment.workflowStatus
      console.log('Applying workflow status updates:', workflowUpdates)

      updateAppointmentData(data, req.params.appointmentId, {
        workflowStatus: workflowUpdates
      })
    }

    // Determine redirect destination
    // This lets us deep link in to the flow whilst still going through this setup route
    const defaultDestination = `/clinics/${req.params.clinicId}/appointments/${req.params.appointmentId}/confirm-identity`
    const finalDestination = returnTo
      ? `/clinics/${req.params.clinicId}/appointments/${req.params.appointmentId}/${returnTo}`
      : defaultDestination

    // Preserve all query string parameters except the ones consumed above.
    // appointment[workflowStatus][...] arrives as a parsed object, so leaving it in
    // would re-serialise as appointment=[object Object]
    // Todo: could a library do this for us?
    const queryParams = { ...req.query }
    delete queryParams.returnTo
    delete queryParams.appointment
    const queryString = Object.keys(queryParams).length
      ? '?' +
        Object.entries(queryParams)
          .map(([key, value]) =>
            Array.isArray(value)
              ? value
                  .map(
                    (v) => `${encodeURIComponent(key)}=${encodeURIComponent(v)}`
                  )
                  .join('&')
              : `${encodeURIComponent(key)}=${encodeURIComponent(value)}`
          )
          .join('&')
      : ''

    res.redirect(finalDestination + queryString)
  })

  // Resume a paused appointment
  router.get('/clinics/:clinicId/appointments/:appointmentId/resume', (req, res) => {
    const data = req.session.data
    const appointment = getAppointment(data, req.params.appointmentId)
    const currentUser = data.currentUser

    console.log(
      `Resuming appointment for appointment ${req.params.appointmentId} by user ${currentUser.id}`
    )

    if (appointment?.status === 'appointment_paused') {
      // Get existing session details
      const existingDetails = appointment.sessionDetails || {}

      // Add resume action to a new authors array - the existing one belongs
      // to the shared read-only appointment record, so must not be pushed to
      const authors = [
        ...(existingDetails.authors || []),
        {
          userId: currentUser.id,
          action: 'resumed',
          timestamp: new Date().toISOString()
        }
      ]

      // Update status to in progress
      updateAppointmentStatus(data, req.params.appointmentId, 'appointment_in_progress')

      // Update session details - preserve original starter
      updateAppointmentData(data, req.params.appointmentId, {
        sessionDetails: {
          startedAt: existingDetails.startedAt,
          startedBy: existingDetails.startedBy,
          pausedAt: null,
          pausedBy: null,
          authors: authors
        }
      })
    }

    // Determine redirect destination
    const defaultDestination = `/clinics/${req.params.clinicId}/appointments/${req.params.appointmentId}/confirm-identity`
    const finalDestination = req.query.returnTo
      ? `/clinics/${req.params.clinicId}/appointments/${req.params.appointmentId}/${req.query.returnTo}`
      : defaultDestination

    // Preserve all query string parameters except returnTo (already used)
    const queryParams = { ...req.query }
    delete queryParams.returnTo
    const queryString = Object.keys(queryParams).length
      ? '?' + new URLSearchParams(queryParams).toString()
      : ''

    res.redirect(finalDestination + queryString)
  })

  // Exit appointment - handles discard, save, or cannot-proceed
  // Accepts both GET (with query param) and POST (with form data)
  router.all(
    '/clinics/:clinicId/appointments/:appointmentId/exit-appointment-answer',
    (req, res) => {
      const { clinicId, appointmentId } = req.params
      const data = req.session.data
      const appointment = getAppointment(data, appointmentId)
      const imagesTaken = data.imagesTaken
      const pauseAction = data.pauseAction

      // Handle pause action from images-completed scenario
      if (pauseAction === 'yes') {
        // Save changes and pause the appointment
        saveTempAppointmentToAppointment(data)
        saveTempParticipantToParticipant(data)

        // Get existing session details to track authors
        const existingDetails = appointment.sessionDetails || {}

        // Add pause action to a new authors array - the existing one belongs
        // to the shared read-only appointment record, so must not be pushed to
        const authors = [
          ...(existingDetails.authors || []),
          {
            userId: data.currentUser?.id,
            action: 'paused',
            timestamp: new Date().toISOString()
          }
        ]

        // Update status to paused and record pause details
        updateAppointmentStatus(data, appointmentId, 'appointment_paused')
        updateAppointmentData(data, appointmentId, {
          sessionDetails: {
            startedAt: existingDetails.startedAt || null,
            startedBy: existingDetails.startedBy || null,
            pausedAt: new Date().toISOString(),
            pausedBy: data.currentUser?.id || null,
            authors: authors
          }
        })

        // Clear temporary session data
        delete data.appointment
        delete data.participant
        delete data.pauseAction
        delete data.confirmedImagesWereTaken

        // Redirect to appointment page with paused status
        return res.redirect(
          modalBreakout(`/clinics/${clinicId}/appointments/${appointmentId}/appointment`)
        )
        // Return to appointment - use referrer chain
        delete data.pauseAction
        delete data.confirmedImagesWereTaken

        // Use referrer chain to go back to where they came from
        const returnUrl = getReturnUrl(
          `/clinics/${clinicId}/appointments/${appointmentId}/appointment`,
          req.query.referrerChain
        )
        return res.redirect(modalBreakout(returnUrl))
      }

      // Handle the initial question about whether images were taken
      if (imagesTaken === 'No') {
        // No images taken - redirect back to exit page to offer choice
        delete data.imagesTaken
        // Store that we've confirmed no images to skip the question next time
        data.confirmedNoImages = true
        return res.redirect(
          urlWithReferrer(
            `/clinics/${clinicId}/appointments/${appointmentId}/exit-appointment`,
            req.query.referrerChain
          )
        )
      } else if (imagesTaken === 'Yes') {
        // Images taken - redirect back to exit page which will show pause-only options
        delete data.imagesTaken
        data.confirmedImagesWereTaken = true
        return res.redirect(
          urlWithReferrer(
            `/clinics/${clinicId}/appointments/${appointmentId}/exit-appointment`,
            req.query.referrerChain
          )
        )
      }

      // Handle the old exitAction flow for backwards compatibility
      const exitAction = data.exitAction

      // Only allow exiting if the appointment is currently in progress
      if (appointment?.status === 'appointment_in_progress') {
        if (exitAction === 'discard') {
          // Discard changes - reset workflow and revert to checked in
          delete data.appointment.workflowStatus

          // Revert status back to checked in
          updateAppointmentStatus(data, appointmentId, 'appointment_checked_in')

          // Clear session details
          updateAppointmentData(data, appointmentId, {
            sessionDetails: {
              startedAt: null,
              startedBy: null
            }
          })

          // Clear temporary session data without saving
          delete data.appointment
          delete data.participant

          // Clear the exit action and flags from session
          delete data.exitAction
          delete data.confirmedNoImages
          delete data.confirmedImagesWereTaken

          // Redirect to returnTo destination or appointment page
          const returnTo = data.returnTo
          delete data.returnTo
          const destination =
            returnTo || `/clinics/${clinicId}/appointments/${appointmentId}/appointment`
          return res.redirect(modalBreakout(destination))
        } else if (exitAction === 'cannot-proceed') {
          // Cannot proceed - redirect to attended-not-screened flow
          delete data.exitAction
          delete data.confirmedNoImages
          delete data.confirmedImagesWereTaken
          return res.redirect(
            modalBreakout(
              `/clinics/${clinicId}/appointments/${appointmentId}/attended-not-screened-reason`
            )
          )
        } else if (exitAction === 'save') {
          // Save changes and pause the appointment

          // Save any temporary changes before leaving
          saveTempAppointmentToAppointment(data)
          saveTempParticipantToParticipant(data)

          // Get existing session details to track authors
          const existingDetails = appointment.sessionDetails || {}
          const authors = existingDetails.authors || []

          // Add current user's pause action to authors
          authors.push({
            userId: data.currentUser?.id,
            action: 'paused',
            timestamp: new Date().toISOString()
          })

          // Update status to paused and record pause details
          updateAppointmentStatus(data, appointmentId, 'appointment_paused')
          updateAppointmentData(data, appointmentId, {
            sessionDetails: {
              startedAt: existingDetails.startedAt || null,
              startedBy: existingDetails.startedBy || null,
              pausedAt: new Date().toISOString(),
              pausedBy: data.currentUser?.id || null,
              authors: authors
            }
          })

          // Clear temporary session data (now safe since we've saved changes)
          delete data.appointment
          delete data.participant

          // Clear the exit action and flags from session
          delete data.exitAction
          delete data.confirmedNoImages
          delete data.confirmedImagesWereTaken

          // Redirect to appointment page with paused status
          return res.redirect(
            modalBreakout(`/clinics/${clinicId}/appointments/${appointmentId}/appointment`)
          )
        }
      }

      // Clear the exit action and flags from session (in case status check failed)
      delete data.exitAction
      delete data.confirmedNoImages
      delete data.confirmedImagesWereTaken

      // Fallback redirect
      res.redirect(
        modalBreakout(`/clinics/${clinicId}/appointments/${appointmentId}/appointment`)
      )
    }
  )

  // Appointment within clinic context
  router.get('/clinics/:clinicId/appointments/:appointmentId', (req, res) => {
    const { clinicId, appointmentId } = req.params

    // Preserve query parameters when redirecting
    const queryString = Object.keys(req.query).length
      ? '?' + new URLSearchParams(req.query).toString()
      : ''

    res.redirect(
      `/clinics/${clinicId}/appointments/${appointmentId}/appointment${queryString}`
    )
  })

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
    const ethnicities = require('../data/ethnicities')

    for (const [group, backgrounds] of Object.entries(ethnicities)) {
      if (backgrounds.includes(ethnicBackground)) {
        return group
      }
    }

    return null // Return null if no match found
  }

  // Handle screening completion
  // Todo - name this route better
  router.post(
    '/clinics/:clinicId/appointments/:appointmentId/can-appointment-go-ahead-answer',
    (req, res) => {
      const { clinicId, appointmentId } = req.params
      const data = req.session.data
      const canAppointmentGoAhead =
        data.appointment?.appointment?.canAppointmentGoAhead
      const appointment = getAppointment(data, appointmentId)

      // No answer, return to page
      if (!canAppointmentGoAhead) {
        res.redirect(`/clinics/${clinicId}/appointments/${appointmentId}`)
      } else if (canAppointmentGoAhead === 'yes') {
        // Check-in participant if they're not already checked in
        if (appointment?.status !== 'appointment_checked_in') {
          updateAppointmentStatus(data, appointmentId, 'appointment_checked_in')
        }
        res.redirect(
          `/clinics/${clinicId}/appointments/${appointmentId}/medical-information-check`
        )
      } else {
        res.redirect(
          `/clinics/${clinicId}/appointments/${appointmentId}/attended-not-screened-reason`
        )
      }
    }
  )

  // Main route in to starting an appointment - used to clear any temp data
  router.get(
    '/clinics/:clinicId/appointments/:appointmentId/previous-mammograms/add',
    (req, res) => {
      const { clinicId, appointmentId } = req.params
      delete req.session.data?.appointment?.previousMammogramTemp
      // Redirect to the form page
      res.redirect(
        urlWithReferrer(
          `/clinics/${clinicId}/appointments/${appointmentId}/previous-mammograms/form`,
          req.query.referrerChain,
          req.query.scrollTo
        )
      )
    }
  )

  // Save data about a mammogram
  router.post(
    '/clinics/:clinicId/appointments/:appointmentId/previous-mammograms/save',
    (req, res) => {
      const { clinicId, appointmentId } = req.params
      const data = req.session.data
      const previousMammogramTemp = data.appointment?.previousMammogramTemp
      const action = req.body.action
      const referrerChain = req.query.referrerChain
      const scrollTo = req.query.scrollTo

      // Check if editing existing or creating new
      const isNewMammogram = !previousMammogramTemp?.id

      const mammogramAddedMessage = isNewMammogram
        ? 'Previous mammogram added'
        : 'Previous mammogram updated'

      // Helper function to build mammogram object with ID and metadata
      const buildMammogramObject = (tempData, additionalFields = {}) => {
        const cleaned = { ...tempData }

        // approximateDate can arrive as an array if both conditional inputs
        // (moreThanSixMonths and lessThanSixMonths) are submitted together.
        // Pick the first non-empty value.
        if (Array.isArray(cleaned.approximateDate)) {
          cleaned.approximateDate = cleaned.approximateDate.find((v) => v) || ''
        }

        // Clear date fields not relevant to the selected dateType
        if (cleaned.dateType === 'dateKnown') {
          delete cleaned.approximateDate
        } else {
          delete cleaned.dateTaken
        }

        // Clear location-specific fields that weren't selected
        if (cleaned.location !== 'bsu') delete cleaned.bsu
        if (cleaned.location !== 'otherUk') delete cleaned.otherUk
        if (cleaned.location !== 'otherNonUk') delete cleaned.otherNonUk

        // Clear previousName if the same name was used
        if (cleaned.sameName !== 'differentName') delete cleaned.previousName

        const mammogram = {
          id: cleaned.id || generateId(),
          ...cleaned,
          ...additionalFields
        }

        // Add metadata for new mammograms
        if (isNewMammogram) {
          mammogram.dateAdded = new Date().toISOString()
          mammogram.addedBy = data.currentUser.id
          mammogram.requestStatus = 'not_requested'
        }

        return mammogram
      }

      // Helper function to save mammogram (update existing or add new)
      const saveMammogram = (mammogram) => {
        if (!data.appointment.previousMammograms) {
          data.appointment.previousMammograms = []
        }

        // Update existing or add new
        const existingIndex = data.appointment.previousMammograms.findIndex(
          (m) => m.id === mammogram.id
        )
        if (existingIndex !== -1) {
          data.appointment.previousMammograms[existingIndex] = mammogram
        } else {
          data.appointment.previousMammograms.push(mammogram)
        }
      }

      // Check if this is coming from "proceed anyway" page
      if (action === 'proceed-anyway') {
        // Validate that a reason was provided
        if (!previousMammogramTemp?.overrideReason) {
          // Set error in flash and redirect back to proceed-anyway page
          req.flash('error', {
            text: 'Enter a reason for proceeding with this appointment',
            name: 'appointment_previousMammogramTemp_overrideReason'
          })
          return res.redirect(
            `/clinics/${clinicId}/appointments/${appointmentId}/previous-mammograms/proceed-anyway`
          )
        }

        // Build and save the mammogram with override flag
        const mammogram = buildMammogramObject(previousMammogramTemp, {
          warningOverridden: true
        })
        saveMammogram(mammogram)

        req.flash('success', mammogramAddedMessage)

        delete data.appointment?.previousMammogramTemp

        const returnUrl = getReturnUrl(
          `/clinics/${clinicId}/appointments/${appointmentId}`,
          referrerChain,
          scrollTo
        )

        return res.redirect(modalBreakout(returnUrl))
      }

      // Handle the direct cancel action from appointment-should-not-proceed.html
      if (action === 'end-immediately') {
        // Set stopping reason for the appointment
        if (!data.appointment.appointmentStopped) {
          data.appointment.appointmentStopped = {}
        }
        data.appointment.appointmentStopped.stoppedReason = 'recent_mammogram'
        data.appointment.appointmentStopped.needsReschedule = 'no' // Default to no reschedule needed

        // Build and save the mammogram
        const mammogram = buildMammogramObject(previousMammogramTemp)
        saveMammogram(mammogram)
        delete data.appointment?.previousMammogramTemp

        // Get participant info for message
        const participantName = getFullName(data.participant)
        const participantAppointmentUrl = `/clinics/${clinicId}/appointments/${appointmentId}`

        // Save changes and update status
        saveTempAppointmentToAppointment(data)
        saveTempParticipantToParticipant(data)
        updateAppointmentStatus(data, appointmentId, 'appointment_attended_not_screened')

        // Flash success message
        const successMessage = `
      ${participantName} has been 'attended not screened'. <a href="${participantAppointmentUrl}" class="app-nowrap">View their appointment</a>`
        req.flash('success', { wrapWithHeading: successMessage })

        // Return to clinic list — break out of any modal so the browser navigates fully
        return res.redirect(modalBreakout(`/clinics/${clinicId}/`))
      }

      // Normalise approximateDate in session now, before any redirect, so the
      // warning page doesn't display a raw array (e.g. ",June 2025") caused by
      // both conditional inputs being submitted together.
      if (
        previousMammogramTemp &&
        Array.isArray(previousMammogramTemp.approximateDate)
      ) {
        previousMammogramTemp.approximateDate =
          previousMammogramTemp.approximateDate.find((v) => v) || ''
      }

      // Check if this is a recent mammogram (within 6 months)
      const isRecentMammogram = checkIfRecentMammogram(previousMammogramTemp)

      // If recent mammogram detected and not already coming from warning page
      if (isRecentMammogram && action !== 'acknowledged-warning') {
        return res.redirect(
          urlWithReferrer(
            `/clinics/${clinicId}/appointments/${appointmentId}/previous-mammograms/appointment-should-not-proceed`,
            referrerChain,
            scrollTo
          )
        )
      }

      // Normal flow - save the mammogram
      if (previousMammogramTemp) {
        const mammogram = buildMammogramObject(previousMammogramTemp)
        saveMammogram(mammogram)
      }

      delete data.appointment?.previousMammogramTemp

      // If user acknowledged the warning page, handle their reschedule decision
      if (action === 'acknowledged-warning') {
        const needsReschedule = data.appointment?.appointmentStopped?.needsReschedule

        // Validate that reschedule option was selected
        if (!needsReschedule) {
          req.flash('error', {
            text: 'Select whether the appointment should be rescheduled',
            name: 'appointment[appointmentStopped][needsReschedule]',
            href: '#needsReschedule'
          })
          return res.redirect(
            urlWithReferrer(
              `/clinics/${clinicId}/appointments/${appointmentId}/previous-mammograms/appointment-should-not-proceed`,
              referrerChain,
              scrollTo
            )
          )
        }

        // Set stopping reason for the appointment
        if (!data.appointment.appointmentStopped) {
          data.appointment.appointmentStopped = {}
        }
        data.appointment.appointmentStopped.stoppedReason = ['Recent mammogram']

        // If yes, redirect to reschedule page
        if (needsReschedule === 'yes') {
          return res.redirect(
            `/clinics/${clinicId}/appointments/${appointmentId}/cancel-or-reschedule-appointment/reschedule`
          )
        } else if (needsReschedule === 'no-invite') {
          // Get participant info BEFORE saving (which clears temp data)
          const participantName = getFullName(data.participant)
          const participantAppointmentUrl = `/clinics/${clinicId}/appointments/${appointmentId}`

          // Save changes and update status
          saveTempAppointmentToAppointment(data)
          saveTempParticipantToParticipant(data)
          updateAppointmentStatus(data, appointmentId, 'appointment_attended_not_screened')

          // Flash success message
          const successMessage = `
    Appointment cancelled. ${participantName} will be invited to the next routine appointment. <a href="${participantAppointmentUrl}" class="app-nowrap">View their appointment</a>`
          req.flash('success', { wrapWithHeading: successMessage })

          // Return to clinic list — break out of any modal
          return res.redirect(modalBreakout(`/clinics/${clinicId}/`))
        }
      }

      req.flash('success', mammogramAddedMessage)

      const returnUrl = getReturnUrl(
        `/clinics/${clinicId}/appointments/${appointmentId}`,
        referrerChain,
        scrollTo
      )
      res.redirect(modalBreakout(returnUrl))
    }
  )

  // Edit existing previous mammogram
  router.get(
    '/clinics/:clinicId/appointments/:appointmentId/previous-mammograms/edit/:mammogramId',
    (req, res) => {
      const { clinicId, appointmentId, mammogramId } = req.params
      const data = req.session.data

      // Find the mammogram by ID
      const mammogram = data.appointment?.previousMammograms?.find(
        (m) => m.id === mammogramId
      )

      if (mammogram) {
        // Copy to temp for editing
        data.appointment.previousMammogramTemp = { ...mammogram }
      } else {
        console.log(`Cannot find previous mammogram with ID ${mammogramId}`)
      }

      // Redirect to the form page
      res.redirect(
        urlWithReferrer(
          `/clinics/${clinicId}/appointments/${appointmentId}/previous-mammograms/form`,
          req.query.referrerChain,
          req.query.scrollTo
        )
      )
    }
  )

  // Delete previous mammogram
  router.get(
    '/clinics/:clinicId/appointments/:appointmentId/previous-mammograms/delete/:mammogramId',
    (req, res) => {
      const { clinicId, appointmentId, mammogramId } = req.params
      const data = req.session.data

      // Remove mammogram from array
      if (data.appointment?.previousMammograms) {
        data.appointment.previousMammograms = data.appointment.previousMammograms.filter(
          (m) => m.id !== mammogramId
        )
      }

      req.flash('success', 'Previous mammogram deleted')

      const returnUrl = getReturnUrl(
        `/clinics/${clinicId}/appointments/${appointmentId}`,
        req.query.referrerChain,
        req.query.scrollTo
      )
      res.redirect(modalBreakout(returnUrl))
    }
  )

  // Helper function to check if mammogram was taken within the last 6 months
  function checkIfRecentMammogram(mammogram) {
    if (!mammogram) return false

    // Check based on date type
    if (mammogram.dateType === 'lessThanSixMonths') {
      // User explicitly indicated mammogram was less than 6 months ago
      return true
    } else if (mammogram.dateType === 'moreThanSixMonths') {
      // User explicitly indicated mammogram was more than 6 months ago
      return false
    } else if (mammogram.dateType === 'dateKnown' && mammogram.dateTaken) {
      // Calculate from exact date
      const now = dayjs()
      const sixMonthsAgo = now.subtract(6, 'month')
      const date = mammogram.dateTaken

      if (date.year && date.month && date.day) {
        const mammogramDate = dayjs(
          `${date.year}-${String(date.month).padStart(2, '0')}-${String(date.day).padStart(2, '0')}`
        )
        return mammogramDate.isAfter(sixMonthsAgo)
      }
    }

    return false
  }

  // Save symptom - handles both 'save' and 'save and add another' with data cleanup
  router.all(
    '/clinics/:clinicId/appointments/:appointmentId/medical-information/symptoms/save',
    (req, res) => {
      const { clinicId, appointmentId } = req.params
      const data = req.session.data
      const isModal = req.headers['x-requested-with'] === 'XMLHttpRequest'
      const action = req.body?.action || req.query.action // 'save' or 'save-and-add'
      const nextSymptomType = req.query.symptomType // camelCase symptom type
      const referrerChain = req.query.referrerChain
      const scrollTo = req.query.scrollTo

      // Validate required fields
      const symptomType = data.appointment?.symptomTemp?.type
      const validationErrors = []

      if (symptomType === 'Nipple change') {
        const loc = data.appointment?.symptomTemp?.nippleChangeLocation
        if (!loc || !loc.length) {
          validationErrors.push({
            name: 'appointment[symptomTemp][nippleChangeLocation]',
            text: 'Select which nipple has changed',
            href: '#nippleChangeLocationRight'
          })
        }
      } else if (symptomType) {
        const loc = data.appointment?.symptomTemp?.location
        if (!loc || !loc.length) {
          validationErrors.push({
            name: 'appointment[symptomTemp][location]',
            text: 'Select a location',
            href: '#locationRightBreast'
          })
        } else {
          // Only 'other' description is required when other is selected
          const locArray = Array.isArray(loc) ? loc : [loc]
          if (
            locArray.includes('other') &&
            !data.appointment.symptomTemp.otherLocationDescription
          ) {
            validationErrors.push({
              name: 'appointment[symptomTemp][otherLocationDescription]',
              text: 'Describe the specific area',
              href: '#otherLocationDescription'
            })
          }
        }
      }

      // Validate type-specific description fields
      if (
        symptomType === 'Other' &&
        !data.appointment?.symptomTemp?.otherDescription
      ) {
        validationErrors.push({
          name: 'appointment[symptomTemp][otherDescription]',
          text: 'Describe the symptom',
          href: '#otherDescription'
        })
      }

      if (symptomType === 'Nipple change') {
        if (!data.appointment?.symptomTemp?.nippleChangeType) {
          validationErrors.push({
            name: 'appointment[symptomTemp][nippleChangeType]',
            text: 'Select the type of nipple change',
            href: '#nippleChangeType'
          })
        } else if (
          data.appointment.symptomTemp.nippleChangeType === 'other' &&
          !data.appointment.symptomTemp.nippleChangeDescription
        ) {
          validationErrors.push({
            name: 'appointment[symptomTemp][nippleChangeDescription]',
            text: 'Provide details of the nipple change',
            href: '#nippleChangeDescription'
          })
        }
      }

      if (symptomType === 'Skin change') {
        if (!data.appointment?.symptomTemp?.skinChangeType) {
          validationErrors.push({
            name: 'appointment[symptomTemp][skinChangeType]',
            text: 'Select how the skin has changed',
            href: '#skinChangeType'
          })
        } else if (
          data.appointment.symptomTemp.skinChangeType === 'other' &&
          !data.appointment.symptomTemp.skinChangeDescription
        ) {
          validationErrors.push({
            name: 'appointment[symptomTemp][skinChangeDescription]',
            text: 'Describe the skin change',
            href: '#skinChangeDescription'
          })
        }
      }

      // Validate how long the symptom has existed (required)
      if (!data.appointment?.symptomTemp?.dateType) {
        validationErrors.push({
          name: 'appointment[symptomTemp][dateType]',
          text: 'Select how long this symptom has existed',
          href: '#dateType'
        })
      } else if (data.appointment.symptomTemp.dateType === 'dateKnown') {
        const ds = data.appointment.symptomTemp.dateStarted
        if (!ds?.month && !ds?.year) {
          validationErrors.push({
            name: 'appointment[symptomTemp][dateStarted]',
            text: 'Enter the date the symptom started',
            href: '#dateStarted-month'
          })
        }
      }

      // Validate approximate date stopped if symptom has resolved
      const hasStopped = data.appointment?.symptomTemp?.hasStopped
      if (
        Array.isArray(hasStopped) &&
        hasStopped.includes('yes') &&
        !data.appointment?.symptomTemp?.approximateDateStopped
      ) {
        validationErrors.push({
          name: 'appointment[symptomTemp][approximateDateStopped]',
          text: 'Enter an approximate date the symptom stopped',
          href: '#approximateDateStopped'
        })
      }

      // Validate investigation details if the checkbox is checked
      const hasBeenInvestigated = data.appointment?.symptomTemp?.hasBeenInvestigated
      const isInvestigated = Array.isArray(hasBeenInvestigated)
        ? hasBeenInvestigated.includes('yes')
        : hasBeenInvestigated === 'yes'
      if (isInvestigated && !data.appointment?.symptomTemp?.investigatedDescription) {
        validationErrors.push({
          name: 'appointment[symptomTemp][investigatedDescription]',
          text: 'Provide details of the investigation',
          href: '#investigatedDescription'
        })
      }

      // Validate isSignificant for non-default significant types (breast pain, other)
      const typeConfig = symptomTypes.find(
        (st) => st.name === symptomType?.toLowerCase()
      )
      if (
        typeConfig &&
        !typeConfig.isSignificantByDefault &&
        !data.appointment?.symptomTemp?.isSignificant
      ) {
        validationErrors.push({
          name: 'appointment[symptomTemp][isSignificant]',
          text: 'Select whether this symptom should be highlighted to image readers',
          href: '#isSignificant'
        })
      }

      if (validationErrors.length) {
        if (isModal) {
          // Return 422 with the details page rendered as a modal fragment.
          // parentLayout is already set in res.locals by the modal middleware.
          return res
            .status(422)
            .render('appointments/medical-information/symptoms/details', {
              errors: validationErrors,
              // Also set flash so populateErrors works on field-level errors
              flash: { error: validationErrors }
            })
        }
        // Non-JS path: flash errors and redirect back to the form
        validationErrors.forEach((err) => req.flash('error', err))
        return res.redirect(
          `/clinics/${clinicId}/appointments/${appointmentId}/medical-information/symptoms/details` +
            (referrerChain ? `?referrerChain=${referrerChain}` : '')
        )
      }

      // Save temp symptom to array
      if (data.appointment?.symptomTemp) {
        // Initialize medicalInformation object if needed
        if (!data.appointment.medicalInformation) {
          data.appointment.medicalInformation = {}
        }

        // Initialize symptoms array if needed
        if (!data.appointment.medicalInformation.symptoms) {
          data.appointment.medicalInformation.symptoms = []
        }

        const symptomTemp = data.appointment.symptomTemp
        const symptomType = symptomTemp.type
        const isNewSymptom = !symptomTemp.id

        const symptomTypeConfig = symptomTypes.find(
          (st) => st.name === symptomType.toLowerCase()
        )

        // Start with base symptom data
        const symptom = {
          id: symptomTemp.id || generateId(),
          type: symptomType,
          dateType: symptomTemp.dateType,
          symptomNotes: symptomTemp.symptomNotes
        }

        // For new symptoms, add the creation timestamp
        if (isNewSymptom) {
          symptom.dateAdded = new Date().toISOString()
        }

        if (symptomTypeConfig) {
          if (symptomTypeConfig.isSignificantByDefault) {
            // Always significant for default significant types
            symptom.isSignificant = true
          } else {
            // Use string value for non-default types
            symptom.isSignificant = symptomTemp.isSignificant === 'yes'
          }
        }

        // Normalise checkbox value and add investigation details if checked
        const savedHasBeenInvestigated = symptomTemp.hasBeenInvestigated
        const savedIsInvestigated = Array.isArray(savedHasBeenInvestigated)
          ? savedHasBeenInvestigated.includes('yes')
          : savedHasBeenInvestigated === 'yes'
        symptom.hasBeenInvestigated = savedIsInvestigated ? 'yes' : 'no'
        if (savedIsInvestigated) {
          symptom.investigatedDescription = symptomTemp.investigatedDescription
        }

        // Handle dates - combine ongoing/not ongoing into single approxStartDate
        if (symptomTemp.dateType === 'dateKnown') {
          symptom.dateStarted = symptomTemp.dateStarted
          delete symptom.approximateDuration
        } else if (
          [
            'Less than 3 months',
            '3 months to a year',
            '1 to 3 years',
            'Over 3 years'
          ].includes(symptomTemp.dateType)
        ) {
          symptom.approximateDuration = symptomTemp.dateType
        } else if (symptomTemp.dateType === 'notKnown') {
          delete symptom.approximateDuration
        }

        if (symptomTemp.isIntermittent) {
          symptom.isIntermittent = true
        }

        symptom.hasStopped =
          Array.isArray(symptomTemp.hasStopped) &&
          symptomTemp.hasStopped.includes('yes')
            ? true
            : false

        if (symptom.hasStopped && symptom) {
          symptom.approximateDateStopped = symptomTemp.approximateDateStopped
        }

        // Handle type-specific fields
        if (symptomType === 'Other') {
          symptom.otherDescription = symptomTemp.otherDescription
        } else if (symptomType === 'Nipple change') {
          symptom.nippleChangeType = symptomTemp.nippleChangeType
          symptom.nippleChangeLocation = symptomTemp.nippleChangeLocation
          if (symptomTemp.nippleChangeType === 'other') {
            symptom.nippleChangeDescription =
              symptomTemp.nippleChangeDescription
          }
        } else if (symptomType === 'Skin change') {
          symptom.skinChangeType = symptomTemp.skinChangeType
          if (symptomTemp.skinChangeType === 'other') {
            symptom.skinChangeDescription = symptomTemp.skinChangeDescription
          }
        }

        if (symptomType != 'Nipple change') {
          // For other symptom types (Lump, Swelling)
          // location is stored as an array matching the checkboxes
          symptom.location = symptomTemp.location

          // Copy location-specific descriptions based on what was selected
          const locArray = Array.isArray(symptomTemp.location)
            ? symptomTemp.location
            : [symptomTemp.location]
          if (locArray.includes('right breast')) {
            symptom.rightBreastDescription = symptomTemp.rightBreastDescription
          }
          if (locArray.includes('left breast')) {
            symptom.leftBreastDescription = symptomTemp.leftBreastDescription
          }
          if (locArray.includes('other')) {
            symptom.otherLocationDescription = symptomTemp.otherLocationDescription
          }
        }

        // Update existing or add new
        const existingIndex = data.appointment.medicalInformation.symptoms.findIndex(
          (s) => s.id === symptom.id
        )
        if (existingIndex !== -1) {
          data.appointment.medicalInformation.symptoms[existingIndex] = symptom
        } else {
          data.appointment.medicalInformation.symptoms.push(symptom)
        }

        delete data.appointment.symptomTemp
      }

      // Redirect based on action and symptom type
      if (action === 'save-and-add') {
        if (nextSymptomType) {
          // Redirect to add specific symptom type
          res.redirect(
            `/clinics/${clinicId}/appointments/${appointmentId}/medical-information/symptoms/add?symptomType=${nextSymptomType}${referrerChain ? '&referrerChain=' + referrerChain : ''}`
          )
        } else {
          // Fallback to general add page
          res.redirect(
            urlWithReferrer(
              `/clinics/${clinicId}/appointments/${appointmentId}/medical-information/symptoms/add`,
              referrerChain,
              scrollTo
            )
          )
        }
      } else {
        // Regular save - redirect back to medical information page
        const returnUrl = getReturnUrl(
          `/clinics/${clinicId}/appointments/${appointmentId}/review-medical-information`,
          referrerChain,
          scrollTo
        )
        res.redirect(modalBreakout(returnUrl))
      }
    }
  )

  // Edit existing symptom
  router.get(
    '/clinics/:clinicId/appointments/:appointmentId/medical-information/symptoms/edit/:symptomId',
    (req, res) => {
      const { clinicId, appointmentId, symptomId } = req.params
      const data = req.session.data

      // Initialize medicalInformation if needed
      if (!data.appointment.medicalInformation) {
        data.appointment.medicalInformation = {}
      }

      // Check new location first
      let symptom = data.appointment.medicalInformation.symptoms?.find(
        (s) => s.id === symptomId
      )

      // Check old location if not found (for migration purposes)
      if (!symptom && data.appointment.symptoms) {
        symptom = data.appointment.symptoms.find((s) => s.id === symptomId)
      }

      if (symptom) {
        data.appointment.symptomTemp = { ...symptom }
      }

      // Go directly to details page since we already know the type
      res.redirect(
        urlWithReferrer(
          `/clinics/${clinicId}/appointments/${appointmentId}/medical-information/symptoms/details`,
          req.query.referrerChain
        )
      )
    }
  )

  // Delete symptom
  router.get(
    '/clinics/:clinicId/appointments/:appointmentId/medical-information/symptoms/delete/:symptomId',
    (req, res) => {
      const { clinicId, appointmentId, symptomId } = req.params
      const data = req.session.data

      // Remove symptom from new location
      if (data.appointment?.medicalInformation?.symptoms) {
        data.appointment.medicalInformation.symptoms =
          data.appointment.medicalInformation.symptoms.filter(
            (s) => s.id !== symptomId
          )
      }

      // Remove symptom from old location too (for migration purposes)
      if (data.appointment?.symptoms) {
        data.appointment.symptoms = data.appointment.symptoms.filter(
          (s) => s.id !== symptomId
        )
      }

      req.flash('success', 'Symptom deleted')

      const returnUrl = getReturnUrl(
        `/clinics/${clinicId}/appointments/${appointmentId}/review-medical-information`,
        req.query.referrerChain,
        req.query.scrollTo
      )
      res.redirect(modalBreakout(returnUrl))
    }
  )

  // Main route in to starting an appointment - used to clear any temp data
  router.get(
    '/clinics/:clinicId/appointments/:appointmentId/medical-information/symptoms/add',
    (req, res) => {
      const { clinicId, appointmentId } = req.params
      const { symptomType } = req.query
      const data = req.session.data
      const isModal = req.headers['x-requested-with'] === 'XMLHttpRequest'

      // Clear any existing temp symptom data
      delete data.appointment?.symptomTemp

      // If symptomType is provided, pre-populate and go to details
      if (symptomType) {
        // Find symptom type by slug
        const symptomTypeConfig = symptomTypes.find(
          (st) => st.slug === symptomType
        )

        if (symptomTypeConfig) {
          // Pre-populate symptomTemp with the selected type
          data.appointment.symptomTemp = {
            type: sentenceCase(symptomTypeConfig.name)
          }

          // For modal (AJAX) requests, render the details page as a fragment.
          // parentLayout is already set in res.locals by the modal middleware.
          if (isModal) {
            return res.render('appointments/medical-information/symptoms/details')
          }

          // Redirect to details page
          return res.redirect(
            urlWithReferrer(
              `/clinics/${clinicId}/appointments/${appointmentId}/medical-information/symptoms/details`,
              req.query.referrerChain,
              req.query.scrollTo
            )
          )
        }
      }

      // No symptomType or invalid type - go to type selection page
      res.redirect(
        urlWithReferrer(
          `/clinics/${clinicId}/appointments/${appointmentId}/medical-information/symptoms/type`,
          req.query.referrerChain,
          req.query.scrollTo
        )
      )
    }
  )

  // Save breast features (includes converting JSON string to structured data)
  router.post(
    '/clinics/:clinicId/appointments/:appointmentId/medical-information/record-breast-features/save',
    (req, res) => {
      const { clinicId, appointmentId } = req.params
      const data = req.session.data
      const referrerChain = req.query.referrerChain
      const scrollTo = req.query.scrollTo

      let conversionsCount = 0
      let errorCount = 0

      // Convert breast features raw data
      if (data.appointment?.medicalInformation?.breastFeaturesRaw) {
        try {
          const rawFeatures = data.appointment.medicalInformation.breastFeaturesRaw
          if (typeof rawFeatures === 'string') {
            data.appointment.medicalInformation.breastFeatures =
              JSON.parse(rawFeatures)
            // Delete the raw data once converted
            delete data.appointment.medicalInformation.breastFeaturesRaw
            conversionsCount++
            console.log(
              'Converted breastFeaturesRaw to structured data and deleted raw data'
            )
          }
        } catch (error) {
          console.warn('Failed to convert breastFeaturesRaw:', error)
          errorCount++
        }
      }

      // Saving breast features resolves any 'review at imaging' reminder
      if (
        data.appointment?.workflowStatus?.['review-breast-features-after-imaging'] ===
        'yes'
      ) {
        data.appointment.workflowStatus['review-breast-features-after-imaging'] =
          'answered'
      }

      // Flash error message if needed
      if (errorCount > 0) {
        req.flash(
          'error',
          'Some data could not be converted. Please check the information and try again.'
        )
      }

      // Redirect back using referrer chain
      const returnUrl = getReturnUrl(
        `/clinics/${clinicId}/appointments/${appointmentId}`,
        referrerChain,
        scrollTo
      )
      res.redirect(modalBreakout(returnUrl))
    }
  )

  // Medical history

  // Medical history routes - add these to the appointments.js file

  const medicalHistoryTypes = require('../data/medical-history-types')

  function isValidMedicalHistoryType(type) {
    // Check against both type field and slug field
    return medicalHistoryTypes.some(
      (item) => item.type === type || item.slug === type
    )
  }

  // Helper function to get medical history type object by type (camelCase type or kebab-case slug)
  function getMedicalHistoryType(type) {
    // First try to find by type field
    let result = medicalHistoryTypes.find((item) => item.type === type)
    if (result) {
      return result
    }
    // Then try to find by slug field
    return medicalHistoryTypes.find((item) => item.slug === type)
  }

  // Helper function to get camelCase type from slug
  function getMedicalHistoryKeyFromSlug(slug) {
    const item = medicalHistoryTypes.find((item) => item.slug === slug)
    return item ? item.type : null
  }

  // Select medical history type - choose which type to add
  router.post(
    '/clinics/:clinicId/appointments/:appointmentId/medical-information/medical-history/select',
    (req, res) => {
      const { clinicId, appointmentId } = req.params
      const data = req.session.data
      const typeSlug = data.medicalHistoryTypeSlug
      const referrerChain = req.query.referrerChain
      const scrollTo = req.query.scrollTo

      // Validate type
      if (!typeSlug || !isValidMedicalHistoryType(typeSlug)) {
        return res.redirect(
          urlWithReferrer(
            `/clinics/${clinicId}/appointments/${appointmentId}/medical-information/medical-history/type`,
            referrerChain,
            scrollTo
          )
        )
      }

      // Clear the type selection from session
      delete data.medicalHistoryTypeSlug

      // Redirect to add page for this type
      res.redirect(
        urlWithReferrer(
          `/clinics/${clinicId}/appointments/${appointmentId}/medical-information/medical-history/${typeSlug}/add`,
          referrerChain,
          scrollTo
        )
      )
    }
  )

  // Add new medical history item - clear temp data and redirect to form
  router.get(
    '/clinics/:clinicId/appointments/:appointmentId/medical-information/medical-history/:type/add',
    (req, res) => {
      const { clinicId, appointmentId, type } = req.params

      // Validate type
      if (!isValidMedicalHistoryType(type)) {
        return res.redirect(
          `/clinics/${clinicId}/appointments/${appointmentId}/review-medical-information`
        )
      }

      // Clear any existing temp medical history data
      delete req.session.data.appointment?.medicalHistoryTemp

      // Redirect to the form (assumes template exists at medical-information/medical-history/[type])
      res.redirect(
        urlWithReferrer(
          `/clinics/${clinicId}/appointments/${appointmentId}/medical-information/medical-history/${type}`,
          req.query.referrerChain,
          req.query.scrollTo
        )
      )
    }
  )

  // Save medical history item - handles both 'save' and 'save and add another'
  router.post(
    '/clinics/:clinicId/appointments/:appointmentId/medical-information/medical-history/:type/save',
    (req, res) => {
      const { clinicId, appointmentId, type } = req.params
      const data = req.session.data
      const action = req.body.action || 'save'
      const referrerChain = req.query.referrerChain
      const scrollTo = req.query.scrollTo

      // Validate type
      if (!isValidMedicalHistoryType(type)) {
        return res.redirect(
          `/clinics/${clinicId}/appointments/${appointmentId}/review-medical-information`
        )
      }

      const typeConfig = getMedicalHistoryType(type)
      // Convert slug to camelCase key for data storage
      const dataKey = getMedicalHistoryKeyFromSlug(type) || type

      // Check if consent is needed for breast implants BEFORE processing the data
      if (
        type === 'breast-implants-augmentation' ||
        type === 'breastImplantsAugmentation'
      ) {
        const medicalHistoryTemp = data.appointment?.medicalHistoryTemp
        const rightBreastProcedures =
          medicalHistoryTemp?.proceduresRightBreast || []
        const leftBreastProcedures =
          medicalHistoryTemp?.proceduresLeftBreast || []

        // Check if breast implants were selected in either breast
        const hasBreastImplants =
          rightBreastProcedures.includes('Breast implants') ||
          leftBreastProcedures.includes('Breast implants')

        // Check if implants have been removed
        const implantsRemoved =
          Array.isArray(medicalHistoryTemp?.implantsRemoved) &&
          medicalHistoryTemp.implantsRemoved.includes(
            'Implants have been removed'
          )

        // Check if consent was already given (editing existing item)
        const alreadyConsented = medicalHistoryTemp?.consentGiven

        // Only show consent page if:
        // - Breast implants are selected
        // - AND implants have NOT been removed
        // - AND consent has NOT already been given
        if (hasBreastImplants && !implantsRemoved && !alreadyConsented) {
          // Redirect to consent page immediately - we'll save the data after consent
          return res.redirect(
            urlWithReferrer(
              `/clinics/${clinicId}/appointments/${appointmentId}/medical-information/medical-history/consent`,
              referrerChain,
              scrollTo
            )
          )
        }
      }

      let isNewItem

      // Save temp medical history to array
      if (data.appointment?.medicalHistoryTemp) {
        // Initialize medicalInformation object if needed
        if (!data.appointment.medicalInformation) {
          data.appointment.medicalInformation = {}
        }

        // Initialize medicalHistory object if needed
        if (!data.appointment.medicalInformation.medicalHistory) {
          data.appointment.medicalInformation.medicalHistory = {}
        }

        // Initialize array for this type if needed
        if (!data.appointment.medicalInformation.medicalHistory[dataKey]) {
          data.appointment.medicalInformation.medicalHistory[dataKey] = []
        }

        const medicalHistoryTemp = data.appointment.medicalHistoryTemp
        isNewItem = !medicalHistoryTemp.id

        // Create medical history item
        const medicalHistoryItem = {
          id: medicalHistoryTemp.id || generateId(),
          ...medicalHistoryTemp
        }

        // For new items, add the creation timestamp
        if (isNewItem) {
          medicalHistoryItem.dateAdded = new Date().toISOString()
          medicalHistoryItem.addedBy = data.currentUser.id
        }

        // REMOVED: The consent line that was adding consentGiven to all items

        // Update existing or add new
        const existingIndex = data.appointment.medicalInformation.medicalHistory[
          dataKey
        ].findIndex((item) => item.id === medicalHistoryItem.id)
        if (existingIndex !== -1) {
          data.appointment.medicalInformation.medicalHistory[dataKey][existingIndex] =
            medicalHistoryItem
        } else {
          data.appointment.medicalInformation.medicalHistory[dataKey].push(
            medicalHistoryItem
          )
        }

        // Clear temp data
        delete data.appointment.medicalHistoryTemp
      }

      let methodVerb = 'added'
      if (!isNewItem) {
        methodVerb = 'updated'
      }

      const itemAddedMessage = `${typeConfig.name} ${methodVerb}`
      req.flash('success', itemAddedMessage)

      // Redirect based on action
      if (action === 'save-and-add' && typeConfig.canHaveMultiple) {
        // Clear any existing temp medical history data for the new item
        delete data.appointment.medicalHistoryTemp

        // Redirect directly to the form instead of going through the add route
        res.redirect(
          urlWithReferrer(
            `/clinics/${clinicId}/appointments/${appointmentId}/medical-information/medical-history/${type}`,
            referrerChain,
            scrollTo
          )
        )
      } else {
        // Regular save - redirect back to medical information page
        const returnUrl = getReturnUrl(
          `/clinics/${clinicId}/appointments/${appointmentId}/review-medical-information`,
          referrerChain,
          scrollTo
        )
        res.redirect(modalBreakout(returnUrl))
      }
    }
  )

  // Edit existing medical history item
  router.get(
    '/clinics/:clinicId/appointments/:appointmentId/medical-information/medical-history/:type/edit/:itemId',
    (req, res) => {
      const { clinicId, appointmentId, type, itemId } = req.params
      const data = req.session.data

      // Validate type
      if (!isValidMedicalHistoryType(type)) {
        return res.redirect(
          `/clinics/${clinicId}/appointments/${appointmentId}/review-medical-information`
        )
      }

      // Convert slug to camelCase key for data lookup
      const dataKey = getMedicalHistoryKeyFromSlug(type) || type

      // Initialize medicalInformation if needed
      if (!data.appointment.medicalInformation) {
        data.appointment.medicalInformation = {}
      }

      // Find the medical history item using the correct data key
      const medicalHistoryItem = data.appointment.medicalInformation.medicalHistory?.[
        dataKey
      ]?.find((item) => item.id === itemId)

      if (medicalHistoryItem) {
        // Copy to temp for editing
        data.appointment.medicalHistoryTemp = { ...medicalHistoryItem }
      } else {
        console.log(`Cannot find item ${itemId} in ${dataKey}`)
      }

      // Redirect to the form
      res.redirect(
        urlWithReferrer(
          `/clinics/${clinicId}/appointments/${appointmentId}/medical-information/medical-history/${type}`,
          req.query.referrerChain,
          req.query.scrollTo
        )
      )
    }
  )

  // Delete medical history item
  router.get(
    '/clinics/:clinicId/appointments/:appointmentId/medical-information/medical-history/:type/delete/:itemId',
    (req, res) => {
      const { clinicId, appointmentId, type, itemId } = req.params
      const data = req.session.data

      // Validate type
      if (!isValidMedicalHistoryType(type)) {
        return res.redirect(
          `/clinics/${clinicId}/appointments/${appointmentId}/review-medical-information`
        )
      }

      const typeConfig = getMedicalHistoryType(type)
      // Convert slug to camelCase key for data lookup
      const dataKey = getMedicalHistoryKeyFromSlug(type) || type

      // Remove item from array
      if (data.appointment?.medicalInformation?.medicalHistory?.[dataKey]) {
        data.appointment.medicalInformation.medicalHistory[dataKey] =
          data.appointment.medicalInformation.medicalHistory[dataKey].filter(
            (item) => item.id !== itemId
          )
      }

      req.flash('success', `${typeConfig.name} deleted`)

      const returnUrl = getReturnUrl(
        `/clinics/${clinicId}/appointments/${appointmentId}/review-medical-information`,
        req.query.referrerChain,
        req.query.scrollTo
      )
      res.redirect(modalBreakout(returnUrl))
    }
  )

  // Route handler for breast implants consent – appointment cannot proceed

  router.post(
    '/clinics/:clinicId/appointments/:appointmentId/medical-information/medical-history/appointment-cannot-proceed-answer',
    (req, res) => {
      const { clinicId, appointmentId } = req.params
      const data = req.session.data
      const participantName = getFullName(data.participant)

      const futureScreeningPlan = data.appointment?.cannotProceed?.futureScreeningPlan

      // Validate that an option was selected
      if (!futureScreeningPlan) {
        req.flash('error', {
          text: 'Select whether the participant plans to attend breast screening in future',
          name: 'appointment[cannotProceed][futureScreeningPlan]',
          href: '#futureScreeningPlan'
        })
        return res.redirect(
          `/clinics/${clinicId}/appointments/${appointmentId}/medical-information/medical-history/appointment-cannot-proceed`
        )
      }

      // Capture session end time only if appointment was started
      const appointment = getAppointment(data, appointmentId)
      if (appointment?.sessionDetails?.startedAt) {
        captureSessionEndTime(data, appointmentId, data.currentUser.id)
      }

      // Save the data
      saveTempAppointmentToAppointment(data)
      saveTempParticipantToParticipant(data)

      // Update appointment status to indicate cannot proceed
      updateAppointmentStatus(data, appointmentId, 'appointment_cancelled')

      // Set success message based on choice
      let successMessage
      if (futureScreeningPlan === 'contact-six-weeks') {
        successMessage = `${participantName} will be contacted in six weeks to rearrange their appointment`
      } else if (futureScreeningPlan === 'invite-next-routine') {
        successMessage = `${participantName} will be invited to their next routine appointment`
      } else if (futureScreeningPlan === 'opt-out') {
        successMessage = `An opt out request has been submitted for ${participantName}`
      }

      req.flash('success', successMessage)

      // Return to clinic page
      res.redirect(modalBreakout(`/clinics/${clinicId}`))
    }
  )

  // Handle breast implants consent form submission
  router.post(
    '/clinics/:clinicId/appointments/:appointmentId/medical-information/medical-history/consent-answer',
    (req, res) => {
      const { clinicId, appointmentId } = req.params
      const data = req.session.data
      const consentGiven =
        data.appointment?.medicalInformation?.implantedDevices?.consentGiven
      const referrerChain = req.query.referrerChain
      const scrollTo = req.query.scrollTo

      // Validate that an option was selected
      if (!consentGiven) {
        req.flash('error', {
          text: 'Select whether they have signed the consent form',
          name: 'appointment[medicalInformation][implantedDevices][consentGiven]',
          href: '#consentGiven'
        })
        return res.redirect(
          `/clinics/${clinicId}/appointments/${appointmentId}/medical-information/medical-history/consent`
        )
      }

      // Handle "Yes" - full consent given
      if (consentGiven === 'yes') {
        // Save the medical history data that was in temp
        if (data.appointment?.medicalHistoryTemp) {
          // Initialize medicalInformation object if needed
          if (!data.appointment.medicalInformation) {
            data.appointment.medicalInformation = {}
          }

          // Initialize medicalHistory object if needed
          if (!data.appointment.medicalInformation.medicalHistory) {
            data.appointment.medicalInformation.medicalHistory = {}
          }

          // Initialize array for breast implants if needed
          if (
            !data.appointment.medicalInformation.medicalHistory
              .breastImplantsAugmentation
          ) {
            data.appointment.medicalInformation.medicalHistory.breastImplantsAugmentation =
              []
          }

          const medicalHistoryTemp = data.appointment.medicalHistoryTemp
          const isNewItem = !medicalHistoryTemp.id

          // Create medical history item
          const medicalHistoryItem = {
            id: medicalHistoryTemp.id || generateId(),
            ...medicalHistoryTemp
          }

          // Add the creation timestamp if new
          if (isNewItem) {
            medicalHistoryItem.dateAdded = new Date().toISOString()
            medicalHistoryItem.addedBy = data.currentUser.id
          }

          // Add consent information
          medicalHistoryItem.consentGiven = 'yes'

          // Update existing or add new
          const existingIndex =
            data.appointment.medicalInformation.medicalHistory.breastImplantsAugmentation.findIndex(
              (item) => item.id === medicalHistoryItem.id
            )
          if (existingIndex !== -1) {
            data.appointment.medicalInformation.medicalHistory.breastImplantsAugmentation[
              existingIndex
            ] = medicalHistoryItem
          } else {
            data.appointment.medicalInformation.medicalHistory.breastImplantsAugmentation.push(
              medicalHistoryItem
            )
          }

          // Clear temp data
          delete data.appointment.medicalHistoryTemp
        }

        // Show combined success message
        req.flash('success', 'Breast implants added and consent recorded')

        // Continue to next step in the flow
        const returnUrl = getReturnUrl(
          `/clinics/${clinicId}/appointments/${appointmentId}/review-medical-information`,
          referrerChain,
          scrollTo
        )
        res.redirect(modalBreakout(returnUrl))
      }
      // Handle "No, but scan unaffected breast"
      else if (consentGiven.startsWith('no-continue-')) {
        const unaffectedBreast = consentGiven.replace('no-continue-', '')
        const affectedBreast = unaffectedBreast === 'left' ? 'right' : 'left'

        // Save the medical history data with partial consent
        if (data.appointment?.medicalHistoryTemp) {
          // Initialize medicalInformation object if needed
          if (!data.appointment.medicalInformation) {
            data.appointment.medicalInformation = {}
          }

          // Initialize medicalHistory object if needed
          if (!data.appointment.medicalInformation.medicalHistory) {
            data.appointment.medicalInformation.medicalHistory = {}
          }

          // Initialize array for breast implants if needed
          if (
            !data.appointment.medicalInformation.medicalHistory
              .breastImplantsAugmentation
          ) {
            data.appointment.medicalInformation.medicalHistory.breastImplantsAugmentation =
              []
          }

          const medicalHistoryTemp = data.appointment.medicalHistoryTemp
          const isNewItem = !medicalHistoryTemp.id

          // Create medical history item with partial consent noted
          const medicalHistoryItem = {
            id: medicalHistoryTemp.id || generateId(),
            ...medicalHistoryTemp,
            consentGiven: 'partial',
            partialConsent: {
              unaffectedBreast: unaffectedBreast,
              affectedBreast: affectedBreast
            }
          }

          // Add the creation timestamp if new
          if (isNewItem) {
            medicalHistoryItem.dateAdded = new Date().toISOString()
            medicalHistoryItem.addedBy = data.currentUser.id
          }

          // Update existing or add new
          const existingIndex =
            data.appointment.medicalInformation.medicalHistory.breastImplantsAugmentation.findIndex(
              (item) => item.id === medicalHistoryItem.id
            )
          if (existingIndex !== -1) {
            data.appointment.medicalInformation.medicalHistory.breastImplantsAugmentation[
              existingIndex
            ] = medicalHistoryItem
          } else {
            data.appointment.medicalInformation.medicalHistory.breastImplantsAugmentation.push(
              medicalHistoryItem
            )
          }

          // Clear temp data
          delete data.appointment.medicalHistoryTemp
        }

        // Set success message
        req.flash(
          'success',
          `Consent recorded as not given for ${affectedBreast} breast, but ${unaffectedBreast} breast to be scanned`
        )

        // Redirect back to medical history page
        const returnUrl = getReturnUrl(
          `/clinics/${clinicId}/appointments/${appointmentId}/review-medical-information`,
          referrerChain,
          scrollTo
        )
        res.redirect(modalBreakout(returnUrl))
      }
      // Handle "No, end appointment"
      else if (consentGiven === 'no') {
        // Don't save the medical history data - consent not given
        delete data.appointment.medicalHistoryTemp

        // Redirect to appointment cannot proceed page
        res.redirect(
          `/clinics/${clinicId}/appointments/${appointmentId}/medical-information/medical-history/appointment-cannot-proceed`
        )
      }
    }
  )

  // Imaging view - this is the main imaging page for the appointment

  // Generate mammogram data when simulating automatic upload
  router.get(
    '/clinics/:clinicId/appointments/:appointmentId/images-automatic',
    (req, res) => {
      const { clinicId, appointmentId } = req.params
      const data = req.session.data
      const appointmentData = getAppointmentData(req.session.data, clinicId, appointmentId)

      // If no mammogram data exists, generate it
      if (!data?.appointment?.mammogramData) {
        // Set start time to 3 minutes ago to simulate an in-progress screening
        const startTime = dayjs().subtract(3, 'minutes').toDate()

        // Pick up mammogram scenario weights from the active seed profile
        const seedProfiles = ensureSeedProfilesState(data.settings)
        const activeProfile = getSeedDataProfileFromState(
          seedProfiles,
          seedProfiles.selectedKey
        )
        const mammogramProfile = activeProfile?.mammogram || {}

        const mammogramData = generateMammogramImages({
          startTime,
          isSeedData: false,
          config: appointmentData?.participant?.config,
          scenarioWeights: mammogramProfile.scenarioWeights || null,
          imperfectChanceForTechnicalOrIncomplete:
            mammogramProfile.imperfectChanceForTechnicalOrIncomplete,
          notesForReaderChanceWithoutImperfect:
            mammogramProfile.notesForReaderChanceWithoutImperfect
        })

        // Add machine room from current screening room
        if (data.currentScreeningRoom) {
          const screeningRooms = data.screeningRooms || []
          const currentRoom = screeningRooms.find(
            (room) => room.id === data.currentScreeningRoom
          )
          if (currentRoom) {
            mammogramData.machineRoom = currentRoom.displayName
          }
        }

        data.appointment.mammogramData = mammogramData
        res.locals.appointment = data.appointment
      }

      res.render('appointments/images-automatic', {})
    }
  )

  // Handle medical information answer
  router.post(
    '/clinics/:clinicId/appointments/:appointmentId/medical-information-answer',
    (req, res) => {
      const { clinicId, appointmentId } = req.params
      const data = req.session.data
      const hasRelevantMedicalInformation =
        data?.appointment?.medicalInformation?.hasRelevantMedicalInformation

      if (!hasRelevantMedicalInformation) {
        res.redirect(
          `/clinics/${clinicId}/appointments/${appointmentId}/medical-information-check`
        )
      } else if (hasRelevantMedicalInformation === 'yes') {
        res.redirect(
          `/clinics/${clinicId}/appointments/${appointmentId}/review-medical-information`
        )
      } else {
        res.redirect(`/clinics/${clinicId}/appointments/${appointmentId}/awaiting-images`)
      }
    }
  )

  // Handle record medical information answer
  router.post(
    '/clinics/:clinicId/appointments/:appointmentId/review-medical-information-answer',
    (req, res) => {
      const { clinicId, appointmentId } = req.params
      const data = req.session.data
      const imagingCanProceed = data?.appointment?.appointment?.imagingCanProceed

      if (!imagingCanProceed) {
        res.redirect(
          `/clinics/${clinicId}/appointments/${appointmentId}/review-medical-information`
        )
      } else if (imagingCanProceed === 'yes') {
        res.redirect(`/clinics/${clinicId}/appointments/${appointmentId}/awaiting-images`)
      } else {
        res.redirect(
          `/clinics/${clinicId}/appointments/${appointmentId}/attended-not-screened-reason`
        )
      }
    }
  )

  // Handle screening completion
  router.post(
    '/clinics/:clinicId/appointments/:appointmentId/imaging-answer',
    (req, res) => {
      const { clinicId, appointmentId } = req.params
      const data = req.session.data

      // Save current screening room if not already set
      if (!data.appointment.mammogramData.machineRoom && data.currentScreeningRoom) {
        const screeningRooms = data.screeningRooms || []
        const currentRoom = screeningRooms.find(
          (room) => room.id === data.currentScreeningRoom
        )
        if (currentRoom) {
          data.appointment.mammogramData.machineRoom = currentRoom.displayName
        }
      }

      // If any view has multiple images, ask about repeats on a separate page
      const mammogramData = data.appointment.mammogramData
      const hasMultipleImages =
        mammogramData.views &&
        Object.values(mammogramData.views).some(
          (view) => view.images && view.images.length > 1
        )

      // Select and store image set based on appointment context now available (including isImperfect)
      if (!data.appointment.mammogramData.selectedSetId) {
        const selectedSet = getImageSetForAppointment(appointmentId, 'diagrams', {
          appointment: data.appointment
        })
        if (selectedSet) {
          data.appointment.mammogramData.selectedSetId = selectedSet.id
        }
      }

      if (hasMultipleImages) {
        return res.redirect(
          `/clinics/${clinicId}/appointments/${appointmentId}/images-repeats`
        )
      }

      // No additional images - mark workflow step as completed
      if (!data.appointment.workflowStatus) {
        data.appointment.workflowStatus = {}
      }
      data.appointment.workflowStatus['take-images'] = 'completed'

      res.redirect(`/clinics/${clinicId}/appointments/${appointmentId}/check-information`)
    }
  )

  // Worklist connection retry routes
  //
  // The retry page is rendered as a simple GET (auto-routed or via this route).
  // Retry counting is handled entirely client-side — the JS fakes a failed
  // first attempt and a successful second attempt, then submits the form.
  //
  // POST retry-worklist-connection: marks worklist as connected and redirects
  // back using the standard referrerChain system.
  //
  // POST switch-to-manual-image-mode: stores manual mode on the APPOINTMENT (not
  // globally) and redirects back via referrerChain.

  // Handle successful "Retry connection" — client-side JS only submits after
  // simulating a successful reconnect.
  router.post(
    '/clinics/:clinicId/appointments/:appointmentId/retry-worklist-connection',
    (req, res) => {
      const { clinicId, appointmentId } = req.params
      const data = req.session.data

      // Mark this appointment as reconnected (per-appointment, doesn't change the global setting)
      data.appointment.isOnWorklist = true

      const participantName = getFullName(data.participant)
      req.flash('success', {
        html: `<p class="nhsuk-notification-banner__heading">${participantName} is now on the worklist</p>
<p>Image information will be sent automatically from the mammogram machine</p>`
      })

      const returnUrl = getReturnUrl(
        `/clinics/${clinicId}/appointments/${appointmentId}/take-images`,
        req.query.referrerChain
      )
      return res.redirect(returnUrl)
    }
  )

  // Handle "Switch to manual image mode" — stores override on the appointment only.
  router.post(
    '/clinics/:clinicId/appointments/:appointmentId/switch-to-manual-image-mode',
    (req, res) => {
      const { clinicId, appointmentId } = req.params
      const data = req.session.data

      // Store manual mode on the appointment itself, not globally
      data.appointment.isManualImageCollection = true

      req.flash('success', {
        html: '<p class="nhsuk-notification-banner__heading">Manual image mode enabled</p>'
      })

      const returnUrl = getReturnUrl(
        `/clinics/${clinicId}/appointments/${appointmentId}/take-images`,
        req.query.referrerChain
      )
      res.redirect(returnUrl)
    }
  )

  // Manual imaging routes

  // Handle take-images route - redirect to appropriate page based on state.
  // Use `all` so the gate applies to the POST from review-medical-information
  // as well as direct GET navigation.
  router.all('/clinics/:clinicId/appointments/:appointmentId/take-images', (req, res) => {
    const { clinicId, appointmentId } = req.params
    const data = req.session.data

    const isAddedToWorklist =
      data.settings?.screening?.addedToWorklist !== 'false' ||
      data.appointment?.isOnWorklist === true

    // Manual mode is true if the global setting says so, OR this specific
    // appointment was switched to manual (e.g. via the retry-connection page).
    const isManualImageCollection =
      data.settings?.screening?.manualImageCollection === 'true' ||
      data.appointment?.isManualImageCollection === true

    const imagesStageCompleted =
      data.appointment?.workflowStatus?.['take-images'] === 'completed'

    // Gate: if the appointment was not added to the worklist and the user
    // hasn't yet switched to manual image mode, divert to the retry page
    // before letting them into the image-taking step.
    if (!isAddedToWorklist && !isManualImageCollection) {
      return res.redirect(
        urlWithReferrer(
          `/clinics/${clinicId}/appointments/${appointmentId}/retry-worklist-connection`,
          `/clinics/${clinicId}/appointments/${appointmentId}/take-images`
        )
      )
    }

    // If manual flow and images already completed, redirect to details page for editing
    if (
      isManualImageCollection &&
      imagesStageCompleted &&
      data.appointment?.mammogramData?.isManualEntry
    ) {
      return res.redirect(
        `/clinics/${clinicId}/appointments/${appointmentId}/images-manual-details`
      )
    }

    // If automatic flow and images completed, redirect to automatic page
    if (
      !isManualImageCollection &&
      imagesStageCompleted &&
      data.appointment?.mammogramData
    ) {
      return res.redirect(
        `/clinics/${clinicId}/appointments/${appointmentId}/images-automatic`
      )
    }

    // Otherwise render the take-images template which will determine which flow to show
    res.render('appointments/take-images')
  })

  // Initialize or edit manual imaging - clears temp or prepopulates from existing data
  router.get('/clinics/:clinicId/appointments/:appointmentId/images-manual', (req, res) => {
    const { clinicId, appointmentId } = req.params
    const data = req.session.data
    const validTroubleshootingIssues = [
      'worklist-participant',
      'wrong-image-count',
      'incorrect-image-labels'
    ]
    const troubleshootingIssue = req.query.issue

    // If mammogramData exists and is manual entry, prepopulate temp for editing
    if (data.appointment?.mammogramData?.isManualEntry) {
      const formData = convertMammogramFormatToFormData(
        data.appointment.mammogramData
      )
      if (formData) {
        data.appointment.mammogramDataTemp = formData
      }
    } else {
      // Clear any existing temp data for fresh start
      delete data.appointment.mammogramDataTemp

      // Check if this is a failover from automatic mode (appointment was switched
      // to manual via the retry-connection page, or user navigated here from
      // the troubleshooting link on the automatic images page).
      const isGlobalManualSetting =
        data.settings?.screening?.manualImageCollection === 'true'
      const hadAutomaticData =
        !!data.appointment?.mammogramData && !data.appointment?.mammogramData?.isManualEntry

      // Set failover flag if switching from automatic to manual
      if (!isGlobalManualSetting || hadAutomaticData) {
        if (!data.appointment.mammogramDataTemp) {
          data.appointment.mammogramDataTemp = {}
        }
        data.appointment.mammogramDataTemp.isManualFailover = true
      }
    }

    // Persist troubleshooting issue context when navigating from troubleshooting links
    if (validTroubleshootingIssues.includes(troubleshootingIssue)) {
      if (!data.appointment.mammogramDataTemp) {
        data.appointment.mammogramDataTemp = {}
      }
      data.appointment.mammogramDataTemp.troubleshootingIssue = troubleshootingIssue
    } else if (data.appointment?.mammogramDataTemp?.troubleshootingIssue) {
      // Clear stale issue context for non-troubleshooting entry points
      delete data.appointment.mammogramDataTemp.troubleshootingIssue
    }

    // Let the dynamic routing handle the actual rendering
    res.render('appointments/images-manual')
  })

  // Direct link to details page - also prepopulates if editing
  router.get(
    '/clinics/:clinicId/appointments/:appointmentId/images-manual-details',
    (req, res) => {
      const { clinicId, appointmentId } = req.params
      const data = req.session.data

      // If mammogramData exists and is manual entry, prepopulate temp for editing
      if (
        data.appointment?.mammogramData?.isManualEntry &&
        !data.appointment?.mammogramDataTemp
      ) {
        const formData = convertMammogramFormatToFormData(
          data.appointment.mammogramData
        )
        if (formData) {
          data.appointment.mammogramDataTemp = formData
        }
      }

      // Let the dynamic routing handle the actual rendering
      res.render('appointments/images-manual-details')
    }
  )

  // Direct link to repeats page - prepopulates temp data for manual editing
  router.get(
    '/clinics/:clinicId/appointments/:appointmentId/images-repeats',
    (req, res) => {
      const { clinicId, appointmentId } = req.params
      const data = req.session.data

      // If mammogramData exists and is manual entry, prepopulate temp for editing
      if (
        data.appointment?.mammogramData?.isManualEntry &&
        !data.appointment?.mammogramDataTemp
      ) {
        const formData = convertMammogramFormatToFormData(
          data.appointment.mammogramData
        )
        if (formData) {
          data.appointment.mammogramDataTemp = formData
        }
      }

      // Let the dynamic routing handle the actual rendering
      res.render('appointments/images-repeats')
    }
  )

  /**
   * Helper function to check if any view has multiple images (needs repeat question)
   */
  function needsRepeatQuestions(mammogramDataTemp) {
    const views = ['viewsRightBreast', 'viewsLeftBreast']
    const viewTypes = ['CC', 'MLO', 'CCID', 'MLOID']

    for (const breastView of views) {
      if (!mammogramDataTemp[breastView]) continue

      for (const viewType of viewTypes) {
        const countField = `${breastView}${viewType}Count`
        const count = parseInt(mammogramDataTemp[countField]) || 0

        if (count > 1) {
          return true
        }
      }
    }

    return false
  }

  /**
   * Helper function to convert manual mammogram format back to form format (for editing)
   */
  function convertMammogramFormatToFormData(mammogramData) {
    if (!mammogramData.isManualEntry) {
      return null
    }

    const formData = {
      machineRoom: mammogramData.machineRoom,
      isIncompleteMammography: Array.isArray(
        mammogramData.isIncompleteMammography
      )
        ? mammogramData.isIncompleteMammography
        : mammogramData.isIncompleteMammography === 'yes'
          ? ['yes']
          : [],
      incompleteMammographyReasons: Array.isArray(
        mammogramData.incompleteMammographyReasons
      )
        ? mammogramData.incompleteMammographyReasons
        : mammogramData.incompleteMammographyReasons
          ? [mammogramData.incompleteMammographyReasons]
          : [],
      incompleteMammographyReasonDetails:
        mammogramData.incompleteMammographyReasonDetails,
      incompleteMammographyFollowUpAppointment:
        mammogramData.incompleteMammographyFollowUpAppointment,
      incompleteMammographyFollowUpAppointmentDetails:
        mammogramData.incompleteMammographyFollowUpAppointmentDetails,
      isImperfectButBestPossible: Array.isArray(
        mammogramData.isImperfectButBestPossible
      )
        ? mammogramData.isImperfectButBestPossible
        : mammogramData.isImperfectButBestPossible === 'yes'
          ? ['yes']
          : [],
      additionalDetails: mammogramData.additionalDetails,
      notesForReader: mammogramData.notesForReader,
      viewsRightBreast: [],
      viewsLeftBreast: []
    } // Convert views back to checkbox/input format
    for (const [viewKey, viewData] of Object.entries(mammogramData.views)) {
      const breastKey =
        viewData.side === 'right' ? 'viewsRightBreast' : 'viewsLeftBreast'
      const countKey = `${breastKey}${viewData.viewShort}Count`

      formData[breastKey].push(viewData.viewShort)
      formData[countKey] = viewData.count.toString()

      // Add repeat data if present
      if (viewData.repeatCount > 0) {
        const additionalCount = viewData.count - 1

        // Determine which radio option to select
        if (additionalCount === 1) {
          // Single additional image - use legacy 'yes' value
          formData[`repeatNeeded-${viewData.viewShortWithSide}`] = 'yes'
        } else if (viewData.repeatCount === additionalCount) {
          // All additional images were repeats
          formData[`repeatNeeded-${viewData.viewShortWithSide}`] = 'all-repeats'
        } else {
          // Some additional images were repeats, some were extra
          formData[`repeatNeeded-${viewData.viewShortWithSide}`] =
            'some-repeats'
          formData[`repeatCount-${viewData.viewShortWithSide}`] =
            viewData.repeatCount.toString()
        }

        // Add repeat reasons if present
        if (viewData.repeatReasons) {
          formData[`repeatReasons-${viewData.viewShortWithSide}`] =
            viewData.repeatReasons
        }
      } else if (viewData.count > 1) {
        // If multiple images but no repeats, all additional images were extra
        formData[`repeatNeeded-${viewData.viewShortWithSide}`] = 'no'
      }
    }

    return formData
  }

  /**
   * Helper function to convert manual form data to mammogram data structure
   */
  /**
   * Convert flat form data to structured mammogram format
   * Works from count fields which are the single source of truth
   */
  function convertManualDataToMammogramFormat(formData) {
    const views = {}

    const viewConfig = [
      {
        side: 'right',
        sideCode: 'R',
        viewType: 'CC',
        viewName: 'craniocaudal',
        viewKey: 'rightCraniocaudal'
      },
      {
        side: 'right',
        sideCode: 'R',
        viewType: 'MLO',
        viewName: 'mediolateral oblique',
        viewKey: 'rightMediolateralOblique'
      },
      {
        side: 'right',
        sideCode: 'R',
        viewType: 'CCID',
        viewName: 'craniocaudal implant displaced',
        viewKey: 'rightCCID'
      },
      {
        side: 'right',
        sideCode: 'R',
        viewType: 'MLOID',
        viewName: 'mediolateral oblique implant displaced',
        viewKey: 'rightMLOID'
      },
      {
        side: 'left',
        sideCode: 'L',
        viewType: 'CC',
        viewName: 'craniocaudal',
        viewKey: 'leftCraniocaudal'
      },
      {
        side: 'left',
        sideCode: 'L',
        viewType: 'MLO',
        viewName: 'mediolateral oblique',
        viewKey: 'leftMediolateralOblique'
      },
      {
        side: 'left',
        sideCode: 'L',
        viewType: 'CCID',
        viewName: 'craniocaudal implant displaced',
        viewKey: 'leftCCID'
      },
      {
        side: 'left',
        sideCode: 'L',
        viewType: 'MLOID',
        viewName: 'mediolateral oblique implant displaced',
        viewKey: 'leftMLOID'
      }
    ]

    let totalImages = 0
    const imagesByBreast = { right: 0, left: 0 }
    let hasRepeat = false

    for (const config of viewConfig) {
      const countField = `views${config.side.charAt(0).toUpperCase() + config.side.slice(1)}Breast${config.viewType}Count`
      const count = parseInt(formData[countField]) || 0

      // Only add view if count > 0
      if (count > 0) {
        // Use abbreviated form like "RCC", "LMLO", "RCCID", "LMLOID"
        const code = `${config.sideCode}${config.viewType}`

        // Get repeat data if this view has count > 1
        let repeatCount = 0
        let repeatReasons = null

        if (count > 1) {
          const repeatNeeded = formData[`repeatNeeded-${code}`]
          const extraImageCount = count - 1

          if (repeatNeeded === 'yes') {
            // Legacy support: single extra image, answered "yes"
            repeatCount = 1
            const reasons = formData[`repeatReasons-${code}`]
            if (reasons && reasons.length > 0) {
              repeatReasons = reasons
            }
            hasRepeat = true
          } else if (repeatNeeded === 'all-repeats') {
            // All extra images were repeats
            repeatCount = extraImageCount
            const reasons = formData[`repeatReasons-${code}`]
            if (reasons && reasons.length > 0) {
              repeatReasons = reasons
            }
            hasRepeat = true
          } else if (repeatNeeded === 'some-repeats') {
            // Some were repeats, some were additional
            repeatCount = parseInt(formData[`repeatCount-${code}`]) || 0
            const reasons = formData[`repeatReasons-${code}`]
            if (reasons && reasons.length > 0) {
              repeatReasons = reasons
            }
            if (repeatCount > 0) {
              hasRepeat = true
            }
          }
          // If repeatNeeded is 'no', then all extra images were needed but not repeats
        }

        views[config.viewKey] = {
          side: config.side,
          view: config.viewName,
          viewShort: config.viewType,
          viewShortWithSide: code,
          count: count,
          repeatCount: repeatCount,
          repeatReasons: repeatReasons
        }

        totalImages += count
        imagesByBreast[config.side] += count
      }
    }

    // Check if standard views completed (4 standard views: RCC, RMLO, LCC, LMLO)
    const standardViews = [
      'rightCraniocaudal',
      'rightMediolateralOblique',
      'leftCraniocaudal',
      'leftMediolateralOblique'
    ]
    const standardViewsCompleted = standardViews.every((view) => views[view])

    // Handle incomplete mammography
    const hasIncompleteMammography =
      formData.isIncompleteMammography?.includes('yes')

    // Calculate additional metadata booleans
    // hasAdditionalImages: true if any view has count > 1
    const hasAdditionalImages = Object.values(views).some(
      (view) => view.count > 1
    )

    // hasExtraImages: true if additional images exist that are NOT repeats (large breasts)
    const hasExtraImages = Object.values(views).some((view) => {
      const additionalCount = view.count - 1
      const extraCount = additionalCount - (view.repeatCount || 0)
      return extraCount > 0
    })

    return {
      isManualEntry: true,
      isManualFailover: formData.isManualFailover || false,
      machineRoom: formData.machineRoom,
      views,
      isIncompleteMammography: hasIncompleteMammography ? ['yes'] : null,
      incompleteMammographyReasons: hasIncompleteMammography
        ? formData.incompleteMammographyReasons
        : null,
      incompleteMammographyReasonDetails: hasIncompleteMammography
        ? formData.incompleteMammographyReasonDetails
        : null,
      incompleteMammographyFollowUpAppointment: hasIncompleteMammography
        ? formData.incompleteMammographyFollowUpAppointment
        : null,
      incompleteMammographyFollowUpAppointmentDetails: hasIncompleteMammography
        ? formData.incompleteMammographyFollowUpAppointmentDetails
        : null,
      isImperfectButBestPossible: formData.isImperfectButBestPossible?.includes(
        'yes'
      )
        ? ['yes']
        : null,
      additionalDetails: formData.additionalDetails,
      notesForReader: formData.notesForReader,
      metadata: {
        totalImages,
        standardViewsCompleted,
        hasAdditionalImages,
        hasRepeat,
        hasExtraImages,
        imagesByBreast
      }
    }
  }

  // Handle initial manual imaging form (standard vs custom)
  router.post(
    '/clinics/:clinicId/appointments/:appointmentId/images-manual-answer',
    (req, res) => {
      const { clinicId, appointmentId } = req.params
      const data = req.session.data
      const isStandardSet = data.appointment?.mammogramDataTemp?.isStandardSet

      if (!isStandardSet) {
        req.flash('error', {
          text: 'Select whether the imaging stage is complete',
          name: 'appointment[mammogramDataTemp][isStandardSet]'
        })
        return res.redirect(
          `/clinics/${clinicId}/appointments/${appointmentId}/images-manual`
        )
      }

      // If standard 4 images, preset the data
      if (isStandardSet === 'yes') {
        if (!data.appointment.mammogramDataTemp) {
          data.appointment.mammogramDataTemp = {}
        }

        // Preset standard views in temp
        data.appointment.mammogramDataTemp.viewsRightBreast = ['CC', 'MLO']
        data.appointment.mammogramDataTemp.viewsRightBreastCCCount = '1'
        data.appointment.mammogramDataTemp.viewsRightBreastMLOCount = '1'
        data.appointment.mammogramDataTemp.viewsLeftBreast = ['CC', 'MLO']
        data.appointment.mammogramDataTemp.viewsLeftBreastCCCount = '1'
        data.appointment.mammogramDataTemp.viewsLeftBreastMLOCount = '1'

        // Convert to final format
        const mammogramData = convertManualDataToMammogramFormat(
          data.appointment.mammogramDataTemp
        )
        data.appointment.mammogramData = mammogramData

        // Clear temp data
        delete data.appointment.mammogramDataTemp

        // Mark workflow as complete
        if (!data.appointment.workflowStatus) {
          data.appointment.workflowStatus = {}
        }
        data.appointment.workflowStatus['take-images'] = 'completed'

        // Redirect to check information
        return res.redirect(
          `/clinics/${clinicId}/appointments/${appointmentId}/check-information`
        )
      }

      // If custom details needed, go to details page
      if (isStandardSet === 'custom') {
        return res.redirect(
          `/clinics/${clinicId}/appointments/${appointmentId}/images-manual-details`
        )
      }

      // If there was a problem (no), redirect to attended-not-screened flow
      if (isStandardSet === 'no') {
        // TODO: Route to attended-not-screened flow
        return res.redirect(
          `/clinics/${clinicId}/appointments/${appointmentId}/attended-not-screened-reason`
        )
      }

      // Fallback - shouldn't reach here
      res.redirect(`/clinics/${clinicId}/appointments/${appointmentId}/images-manual`)
    }
  )

  // Handle manual imaging details form
  router.post(
    '/clinics/:clinicId/appointments/:appointmentId/images-manual-details-answer',
    (req, res) => {
      const { clinicId, appointmentId } = req.params
      const data = req.session.data
      const formData = data.appointment?.mammogramDataTemp || {}

      // Validate at least one view has a count > 0
      const viewTypes = ['CC', 'MLO', 'CCID', 'MLOID']
      const breasts = ['Right', 'Left']
      let hasAnyImages = false

      for (const breast of breasts) {
        for (const viewType of viewTypes) {
          const countField = `views${breast}Breast${viewType}Count`
          const count = parseInt(formData[countField]) || 0
          if (count > 0) {
            hasAnyImages = true
            break
          }
        }
        if (hasAnyImages) break
      }

      if (!hasAnyImages) {
        req.flash('error', {
          text: 'Enter at least one image count',
          name: 'appointment[mammogramDataTemp][viewsRightBreastCCCount]'
        })
        return res.redirect(
          `/clinics/${clinicId}/appointments/${appointmentId}/images-manual-details`
        )
      }

      // Check if we need to ask about repeats
      const needsRepeats = viewTypes.some((viewType) =>
        breasts.some((breast) => {
          const countField = `views${breast}Breast${viewType}Count`
          const count = parseInt(formData[countField]) || 0
          return count > 1
        })
      )

      if (needsRepeats) {
        // Keep temp data for repeats page
        return res.redirect(
          `/clinics/${clinicId}/appointments/${appointmentId}/images-repeats`
        )
      }

      // Convert to final format and save directly to mammogramData
      data.appointment.mammogramData = convertManualDataToMammogramFormat(formData)

      // Clear temp data
      delete data.appointment.mammogramDataTemp

      // Mark workflow as complete
      if (!data.appointment.workflowStatus) {
        data.appointment.workflowStatus = {}
      }
      data.appointment.workflowStatus['take-images'] = 'completed'

      // Redirect to check information
      res.redirect(`/clinics/${clinicId}/appointments/${appointmentId}/check-information`)
    }
  )

  // Handle repeat reasons form - used by both manual and automatic flows
  router.post(
    '/clinics/:clinicId/appointments/:appointmentId/images-repeats-answer',
    (req, res) => {
      const { clinicId, appointmentId } = req.params
      const data = req.session.data
      const isManualEntry = data.appointment?.mammogramData?.isManualEntry

      const viewCodes = [
        'RCC',
        'RMLO',
        'RCCID',
        'RMLOID',
        'LCC',
        'LMLO',
        'LCCID',
        'LMLOID'
      ]

      if (isManualEntry) {
        // Manual flow - normalize temp data and convert to final format
        const formData = data.appointment?.mammogramDataTemp || {}

        viewCodes.forEach((code) => {
          const repeatNeeded = formData[`repeatNeeded-${code}`]

          // Pick the correct set of repeatReasons based on which radio option was selected
          if (repeatNeeded === 'yes' || repeatNeeded === 'all-repeats') {
            if (formData[`repeatReasonsAll-${code}`]) {
              formData[`repeatReasons-${code}`] =
                formData[`repeatReasonsAll-${code}`]
            }
            delete formData[`repeatReasonsAll-${code}`]
            delete formData[`repeatReasonsSome-${code}`]
          } else if (repeatNeeded === 'some-repeats') {
            if (formData[`repeatReasonsSome-${code}`]) {
              formData[`repeatReasons-${code}`] =
                formData[`repeatReasonsSome-${code}`]
            }
            delete formData[`repeatReasonsAll-${code}`]
            delete formData[`repeatReasonsSome-${code}`]
          } else if (repeatNeeded === 'no') {
            delete formData[`repeatReasons-${code}`]
            delete formData[`repeatReasonsAll-${code}`]
            delete formData[`repeatReasonsSome-${code}`]
            delete formData[`repeatCount-${code}`]
          }
        })

        // Convert form data (including repeat information) to final format and save
        data.appointment.mammogramData = convertManualDataToMammogramFormat(formData)

        // Clear temp data
        delete data.appointment.mammogramDataTemp
      } else {
        // Automatic flow - normalize and process repeat data directly in mammogramData
        const mammogramData = data.appointment.mammogramData

        // Normalize repeatReasons fields (same logic as manual flow)
        viewCodes.forEach((code) => {
          const repeatNeeded = mammogramData[`repeatNeeded-${code}`]

          if (repeatNeeded === 'yes' || repeatNeeded === 'all-repeats') {
            if (mammogramData[`repeatReasonsAll-${code}`]) {
              mammogramData[`repeatReasons-${code}`] =
                mammogramData[`repeatReasonsAll-${code}`]
            }
            delete mammogramData[`repeatReasonsAll-${code}`]
            delete mammogramData[`repeatReasonsSome-${code}`]
          } else if (repeatNeeded === 'some-repeats') {
            if (mammogramData[`repeatReasonsSome-${code}`]) {
              mammogramData[`repeatReasons-${code}`] =
                mammogramData[`repeatReasonsSome-${code}`]
            }
            delete mammogramData[`repeatReasonsAll-${code}`]
            delete mammogramData[`repeatReasonsSome-${code}`]
          } else if (repeatNeeded === 'no') {
            delete mammogramData[`repeatReasons-${code}`]
            delete mammogramData[`repeatReasonsAll-${code}`]
            delete mammogramData[`repeatReasonsSome-${code}`]
            delete mammogramData[`repeatCount-${code}`]
          }
        })

        // Process repeat data into view objects and recalculate metadata
        if (mammogramData.views) {
          for (const [viewKey, viewData] of Object.entries(
            mammogramData.views
          )) {
            const code = viewData.viewShortWithSide
            const imageCount = viewData.images ? viewData.images.length : 0

            if (imageCount > 1) {
              const repeatNeeded = mammogramData[`repeatNeeded-${code}`]
              const extraImageCount = imageCount - 1
              let repeatCount = 0
              let repeatReasons = null

              if (repeatNeeded === 'yes') {
                repeatCount = 1
                const reasons = mammogramData[`repeatReasons-${code}`]
                if (reasons && reasons.length > 0) repeatReasons = reasons
              } else if (repeatNeeded === 'all-repeats') {
                repeatCount = extraImageCount
                const reasons = mammogramData[`repeatReasons-${code}`]
                if (reasons && reasons.length > 0) repeatReasons = reasons
              } else if (repeatNeeded === 'some-repeats') {
                repeatCount =
                  parseInt(mammogramData[`repeatCount-${code}`]) || 0
                const reasons = mammogramData[`repeatReasons-${code}`]
                if (reasons && reasons.length > 0) repeatReasons = reasons
              }

              viewData.repeatCount = repeatCount
              viewData.repeatReasons = repeatReasons
            }
          }

          // Recalculate metadata booleans after processing repeat data
          const hasAdditionalImages = Object.values(mammogramData.views).some(
            (view) => (view.images ? view.images.length : view.count) > 1
          )
          const hasRepeat = Object.values(mammogramData.views).some(
            (view) => view.repeatCount > 0
          )
          const hasExtraImages = Object.values(mammogramData.views).some(
            (view) => {
              const imageCount = view.images ? view.images.length : view.count
              const additionalCount = imageCount - 1
              const extraCount = additionalCount - (view.repeatCount || 0)
              return extraCount > 0
            }
          )

          if (!mammogramData.metadata) {
            mammogramData.metadata = {}
          }
          mammogramData.metadata.hasAdditionalImages = hasAdditionalImages
          mammogramData.metadata.hasRepeat = hasRepeat
          mammogramData.metadata.hasExtraImages = hasExtraImages
        }
      }

      // Now repeat metadata is final, select and store the image set
      const selectedSet = getImageSetForAppointment(appointmentId, 'diagrams', {
        appointment: data.appointment
      })
      if (selectedSet) {
        data.appointment.mammogramData.selectedSetId = selectedSet.id
      }

      // Mark workflow as complete
      if (!data.appointment.workflowStatus) {
        data.appointment.workflowStatus = {}
      }
      data.appointment.workflowStatus['take-images'] = 'completed'

      // Redirect to check information
      res.redirect(`/clinics/${clinicId}/appointments/${appointmentId}/check-information`)
    }
  )

  // End Manual imaging routes

  // Handle screening completion
  router.post(
    '/clinics/:clinicId/appointments/:appointmentId/attended-not-screened-answer',
    (req, res) => {
      const { clinicId, appointmentId } = req.params
      const data = req.session.data

      const participantName = getFullName(data.participant)
      const participantAppointmentUrl = `/clinics/${clinicId}/appointments/${appointmentId}`

      const notScreenedReason = data.appointment.appointmentStopped.stoppedReason
      const needsReschedule = data.appointment.appointmentStopped.needsReschedule
      const otherDetails = data.appointment.appointmentStopped.otherDetails
      const hasOtherReasonButNoDetails =
        notScreenedReason?.includes('Other reason') && !otherDetails

      if (
        !notScreenedReason ||
        !needsReschedule ||
        hasOtherReasonButNoDetails
      ) {
        if (!notScreenedReason) {
          req.flash('error', {
            text: 'Select why this appointment has been stopped',
            name: 'appointment[appointmentStopped][stoppedReason]',
            href: '#stoppedReason'
          })
        }
        if (hasOtherReasonButNoDetails) {
          req.flash('error', {
            text: 'Provide details about the other reason',
            name: 'appointment[appointmentStopped][otherDetails]',
            href: '#otherDetails'
          })
        }
        if (!needsReschedule) {
          req.flash('error', {
            text: 'Select whether the appointment should be rescheduled',
            name: 'appointment[appointmentStopped][needsReschedule]',
            href: '#needsReschedule'
          })
        }
        res.redirect(
          `/clinics/${clinicId}/appointments/${appointmentId}/attended-not-screened-reason`
        )
        return
      }

      // If yes, redirect to reschedule page
      if (needsReschedule === 'yes') {
        // Save the appointmentStopped data before redirecting
        // Don't update status yet - keep workflow active until reschedule is complete
        saveTempAppointmentToAppointment(data)
        saveTempParticipantToParticipant(data)

        res.redirect(
          `/clinics/${clinicId}/appointments/${appointmentId}/cancel-or-reschedule-appointment/reschedule`
        )
      } else {
        // Capture session end time only if appointment was started
        const appointment = getAppointment(data, appointmentId)
        if (appointment?.sessionDetails?.startedAt) {
          captureSessionEndTime(data, appointmentId, data.currentUser.id)
        }

        // Get participant info BEFORE saving (which clears temp data)
        saveTempAppointmentToAppointment(data)
        saveTempParticipantToParticipant(data)
        updateAppointmentStatus(data, appointmentId, 'appointment_attended_not_screened')

        // Set success message based on choice
        let successMessage
        if (needsReschedule === 'no-invite') {
          successMessage = `
    Appointment cancelled. ${participantName} will be invited to the next routine appointment. <a href="${participantAppointmentUrl}" class="app-nowrap">View their appointment</a>`
        } else if (needsReschedule === 'no-opt-out') {
          successMessage = `
    Appointment cancelled. An opt out request has been submitted for ${participantName}. <a href="${participantAppointmentUrl}" class="app-nowrap">View their appointment</a>`
        }

        req.flash('success', { wrapWithHeading: successMessage })

        res.redirect(`/clinics/${clinicId}/`)
      }
    }
  )

  // Handle screening completion
  router.post('/clinics/:clinicId/appointments/:appointmentId/complete', (req, res) => {
    const { clinicId, appointmentId } = req.params

    const data = req.session.data
    const currentUser = data.currentUser
    const participantName = getFullName(data.participant)
    const participantAppointmentUrl = `/clinics/${clinicId}/appointments/${appointmentId}`

    // Store session end details
    updateAppointmentData(data, appointmentId, {
      sessionDetails: {
        ...getAppointment(data, appointmentId).sessionDetails,
        endedAt: new Date().toISOString(),
        endedBy: currentUser.id
      }
    })

    // Determine status based on mammogram completeness (check before saving clears data.appointment)
    const isIncompleteMammography =
      data.appointment?.mammogramData?.isIncompleteMammography === 'yes'

    saveTempAppointmentToAppointment(data)
    saveTempParticipantToParticipant(data)

    updateAppointmentStatus(
      data,
      appointmentId,
      isIncompleteMammography ? 'appointment_partially_screened' : 'appointment_complete'
    )

    const successMessage = `
    ${participantName} has been screened. <a href="${participantAppointmentUrl}" class="app-nowrap">View their appointment</a>`

    req.flash('success', { wrapWithHeading: successMessage })

    res.redirect(`/clinics/${clinicId}`)

    // res.redirect(`/clinics/${clinicId}/appointments/${appointmentId}/screening-complete`)
  })

  // Handle special appointment form submission
  router.post(
    '/clinics/:clinicId/appointments/:appointmentId/special-appointment/edit-answer',
    (req, res) => {
      const { clinicId, appointmentId } = req.params
      const data = req.session.data
      const supportTypes = data.appointment?.specialAppointment?.supportTypes || []
      const temporaryReasons = data.appointment?.specialAppointment?.temporaryReasons

      // Validate that temporaryReasons was answered
      // if (!temporaryReasons && supportTypes) {
      //   req.flash('error', {
      //     text: 'Select whether any of these reasons are temporary',
      //     name: 'appointment[specialAppointment][temporaryReasons]',
      //     href: '#temporaryReasons'
      //   })
      //   return res.redirect(
      //     `/clinics/${clinicId}/appointments/${appointmentId}/special-appointment/edit`
      //   )
      // }

      // // If user selected "yes", redirect to temporary reasons selection page
      // if (temporaryReasons === 'yes' && supportTypes?.length > 0) {
      //   res.redirect(
      //     urlWithReferrer(
      //       `/clinics/${clinicId}/appointments/${appointmentId}/special-appointment/temporary-reasons`,
      //       req.query.referrerChain
      //     )
      //   )
      // } else

      // Return user during workflow
      if (isAppointmentWorkflow(data.appointment, data.currentUser)) {
        // In workflow — skip confirm, leave data in temp store, return to workflow
        // if (temporaryReasons === 'no') {
        //   delete data.appointment.specialAppointment.temporaryReasonsList
        // }
        res.redirect(
          modalBreakout(
            getReturnUrl(
              `/clinics/${clinicId}/appointments/${appointmentId}`,
              req.query.referrerChain
            )
          )
        )
      } else {
        // Standalone — go to confirm page which will save
        if (temporaryReasons === 'no') {
          delete data.appointment.specialAppointment.temporaryReasonsList
        }
        res.redirect(
          `/clinics/${clinicId}/appointments/${appointmentId}/special-appointment/confirm`
        )
      }
    }
  )

  // Handle temporary reasons selection form submission
  router.post(
    '/clinics/:clinicId/appointments/:appointmentId/special-appointment/temporary-reasons-answer',
    (req, res) => {
      const { clinicId, appointmentId } = req.params
      const data = req.session.data

      if (isAppointmentWorkflow(data.appointment, data.currentUser)) {
        // In workflow — skip confirm, leave data in temp store, return to workflow
        res.redirect(
          modalBreakout(
            getReturnUrl(
              `/clinics/${clinicId}/appointments/${appointmentId}`,
              req.query.referrerChain
            )
          )
        )
      } else {
        // Standalone — go to confirm page which will save
        res.redirect(
          `/clinics/${clinicId}/appointments/${appointmentId}/special-appointment/confirm`
        )
      }
    }
  )

  // Handle special appointment confirmation
  router.post(
    '/clinics/:clinicId/appointments/:appointmentId/special-appointment/confirm-answer',
    (req, res) => {
      const { clinicId, appointmentId } = req.params
      const data = req.session.data

      const supportTypes = data.appointment?.specialAppointment?.supportTypes
      const temporaryReasons = data.appointment?.specialAppointment?.temporaryReasons
      const temporaryReasonsList =
        data.appointment?.specialAppointment?.temporaryReasonsList

      if (temporaryReasons === 'no') {
        delete data.appointment.specialAppointment.temporaryReasonsList
      }

      // Save the data and redirect back to main appointment page
      saveTempAppointmentToAppointment(data)
      saveTempParticipantToParticipant(data)

      req.flash('success', 'Special appointment requirements confirmed')
      const returnUrl = getReturnUrl(
        `/clinics/${clinicId}/appointments/${appointmentId}`,
        req.query.referrerChain
      )
      res.redirect(modalBreakout(returnUrl))
    }
  )

  // Handle appointment note form submission
  router.post(
    '/clinics/:clinicId/appointments/:appointmentId/appointment-note-answer',
    (req, res) => {
      const { clinicId, appointmentId } = req.params
      const data = req.session.data

      // Save the appointment note from temp appointment to permanent appointment
      saveTempAppointmentToAppointment(data)

      req.flash('success', 'Appointment note saved')

      const returnUrl = getReturnUrl(
        `/clinics/${clinicId}/appointments/${appointmentId}`,
        req.query.referrerChain
      )
      res.redirect(modalBreakout(returnUrl))
    }
  )

  // Delete appointment note
  router.get(
    '/clinics/:clinicId/appointments/:appointmentId/appointment-note/delete',
    (req, res) => {
      const { clinicId, appointmentId } = req.params
      const data = req.session.data

      // Delete the appointment note
      delete data.appointment.appointmentNote

      // Save changes
      saveTempAppointmentToAppointment(data)

      req.flash('success', 'Appointment note deleted')

      const returnUrl = getReturnUrl(
        `/clinics/${clinicId}/appointments/${appointmentId}`,
        req.query.referrerChain
      )
      res.redirect(modalBreakout(returnUrl))
    }
  )
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

  // General purpose dynamic template route for appointments
  // This should come after any more specific routes
  router.get(
    '/clinics/:clinicId/appointments/:appointmentId/*subPaths',
    createDynamicTemplateRoute({
      templatePrefix: 'appointments'
    })
  )

  // Handle cancel or reschedule appointment form submission
  router.post(
    '/clinics/:clinicId/appointments/:appointmentId/cancel-or-reschedule-appointment/cancel-or-reschedule-appointment-answer',
    (req, res) => {
      const { clinicId, appointmentId } = req.params
      const data = req.session.data

      const participantName = getFullName(data.participant)
      const participantAppointmentUrl = `/clinics/${clinicId}/appointments/${appointmentId}`

      const rescheduleChoice = data.appointment?.cancellation?.reschedule

      // Validate that a reschedule option was selected
      if (!rescheduleChoice) {
        req.flash('error', {
          text: 'Select whether the appointment should be rescheduled',
          name: 'appointment[cancellation][reschedule]',
          href: '#reschedule'
        })
        return res.redirect(
          `/clinics/${clinicId}/appointments/${appointmentId}/cancel-or-reschedule-appointment/details`
        )
      }

      // If yes, redirect to reschedule page
      if (rescheduleChoice === 'yes') {
        res.redirect(
          `/clinics/${clinicId}/appointments/${appointmentId}/cancel-or-reschedule-appointment/reschedule`
        )
      } else {
        // Capture session end time only if appointment was started
        const appointment = getAppointment(data, appointmentId)
        if (appointment?.sessionDetails?.startedAt) {
          captureSessionEndTime(data, appointmentId, data.currentUser.id)
        }

        // Save the cancellation data
        saveTempAppointmentToAppointment(data)
        saveTempParticipantToParticipant(data)

        // Update appointment status to cancelled
        updateAppointmentStatus(data, appointmentId, 'appointment_cancelled')

        // Set success message based on choice
        let successMessage
        if (rescheduleChoice === 'no-invite') {
          successMessage = `${participantName}'s appointment has been cancelled. <a href="${participantAppointmentUrl}" class="app-nowrap">View their appointment</a>`
        } else if (rescheduleChoice === 'no-opt-out') {
          successMessage = `An opt out request has been submitted for ${participantName}. <a href="${participantAppointmentUrl}" class="app-nowrap">View their appointment</a>`
        }

        req.flash('success', { wrapWithHeading: successMessage })

        // Return to clinic page
        res.redirect(modalBreakout(`/clinics/${clinicId}`))
      }
    }
  )

  // Handle reschedule appointment form submission
  router.post(
    '/clinics/:clinicId/appointments/:appointmentId/cancel-or-reschedule-appointment/reschedule-answer',
    (req, res) => {
      const { clinicId, appointmentId } = req.params
      const data = req.session.data

      const participantName = getFullName(data.participant)
      const participantAppointmentUrl = `/clinics/${clinicId}/appointments/${appointmentId}`

      const timing = data.appointment?.reschedule?.timing

      // Validate that timing was selected
      if (!timing) {
        req.flash('error', {
          text: 'Select when the appointment should be rescheduled',
          name: 'appointment[reschedule][timing]',
          href: '#timing'
        })
        return res.redirect(
          `/clinics/${clinicId}/appointments/${appointmentId}/cancel-or-reschedule-appointment/reschedule`
        )
      }

      // Capture session end time only if appointment was started (appointments might be rescheduled over the phone or that never started)
      const appointment = getAppointment(data, appointmentId)
      if (appointment?.sessionDetails?.startedAt) {
        captureSessionEndTime(data, appointmentId, data.currentUser.id)
      }

      // Save the reschedule data
      saveTempAppointmentToAppointment(data)
      saveTempParticipantToParticipant(data)

      // Update appointment status to rescheduled
      updateAppointmentStatus(data, appointmentId, 'appointment_rescheduled')

      const successMessage = `Appointment cancelled and a reschedule request has been submitted for ${participantName}. <a href="${participantAppointmentUrl}" class="app-nowrap">View their appointment</a>`

      req.flash('success', { wrapWithHeading: successMessage })

      // Return to clinic page — break out of any modal so the browser navigates fully
      res.redirect(modalBreakout(`/clinics/${clinicId}`))
    }
  )

  // Handle undo cancel appointment
  router.get('/clinics/:clinicId/appointments/:appointmentId/undo-cancel', (req, res) => {
    const { clinicId, appointmentId } = req.params
    const data = req.session.data
    const appointment = getAppointment(data, appointmentId)

    if (appointment && appointment.status === 'appointment_cancelled') {
      // Clear cancellation data
      delete data.appointment.cancellation
      delete data.appointment.reschedule

      // Save changes
      saveTempAppointmentToAppointment(data)

      // Revert to scheduled status
      updateAppointmentStatus(data, appointmentId, 'appointment_scheduled')

      req.flash('success', 'Appointment cancellation undone')
    }

    // Use referrer system to return to originating page
    const returnUrl = getReturnUrl(
      `/clinics/${clinicId}/appointments/${appointmentId}/appointment`,
      req.query.referrerChain
    )
    res.redirect(returnUrl)
  })

  // Handle undo reschedule appointment
  router.get(
    '/clinics/:clinicId/appointments/:appointmentId/undo-reschedule',
    (req, res) => {
      const { clinicId, appointmentId } = req.params
      const data = req.session.data
      const appointment = getAppointment(data, appointmentId)

      if (appointment && appointment.status === 'appointment_rescheduled') {
        // Clear reschedule and cancellation data
        delete data.appointment.cancellation
        delete data.appointment.reschedule

        // Save changes
        saveTempAppointmentToAppointment(data)

        // Revert to scheduled status
        updateAppointmentStatus(data, appointmentId, 'appointment_scheduled')

        req.flash('success', 'Appointment cancellation undone')
      }

      // Use referrer system to return to originating page
      const returnUrl = getReturnUrl(
        `/clinics/${clinicId}/appointments/${appointmentId}/appointment`,
        req.query.referrerChain
      )
      res.redirect(returnUrl)
    }
  )

  // Handle undo check in
  router.get('/clinics/:clinicId/appointments/:appointmentId/undo-check-in', (req, res) => {
    const { clinicId, appointmentId } = req.params
    const data = req.session.data
    const appointment = getAppointment(data, appointmentId)

    if (appointment && appointment.status === 'appointment_checked_in') {
      const participantName = getFullName(data.participant)

      // Save changes
      saveTempAppointmentToAppointment(data)

      // Revert to scheduled status
      updateAppointmentStatus(data, appointmentId, 'appointment_scheduled')

      req.flash(
        'success',
        `${participantName} is no longer checked in for their appointment`
      )

      // Use referrer system to return to originating page
      const returnUrl = getReturnUrl(
        `/clinics/${clinicId}`,
        req.query.referrerChain
      )
      return res.redirect(returnUrl)
    }

    // Use referrer system for fallback too
    const returnUrl = getReturnUrl(
      `/clinics/${clinicId}/appointments/${appointmentId}/appointment`,
      req.query.referrerChain
    )
    res.redirect(returnUrl)
  })
}
