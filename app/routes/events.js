// app/routes/events.js
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
  getEvent,
  saveTempEventToEvent,
  updateEventStatus,
  updateEventData
} = require('../lib/utils/event-data')
const generateId = require('../lib/utils/id-generator')
const {
  getReturnUrl,
  urlWithReferrer,
  appendReferrer
} = require('../lib/utils/referrers')
const { createDynamicTemplateRoute } = require('../lib/utils/dynamic-routing')
const { isAppointmentWorkflow } = require('../lib/utils/status')
const { sentenceCase } = require('../lib/utils/strings')
// Load symptom types data
const symptomTypes = require('../data/symptom-types')

/**
 * Get single event and its related data
 */
function getEventData(data, clinicId, eventId) {
  const clinic = data.clinics.find((c) => c.id === clinicId)

  if (!clinic) {
    return null
  }

  const event = data.events.find(
    (e) => e.id === eventId && e.clinicId === clinicId
  )

  if (!event) {
    return null
  }

  const participant = data.participants.find(
    (p) => p.id === event.participantId
  )
  const unit = data.breastScreeningUnits.find(
    (u) => u.id === clinic.breastScreeningUnitId
  )
  const location = unit?.locations.find((l) => l.id === clinic.locationId)

  return {
    clinic,
    event,
    participant,
    unit,
    location
  }
}

/**
 * Capture session end time for an event
 * @param {object} data - Session data
 * @param {string} eventId - Event ID
 * @param {string} userId - User ID ending the session
 */
function captureSessionEndTime(data, eventId, userId) {
  const event = getEvent(data, eventId)
  updateEventData(data, eventId, {
    sessionDetails: {
      ...event.sessionDetails,
      endedAt: new Date().toISOString(),
      endedBy: userId
    }
  })
}

// // Update event status and add to history
// function updateEventStatus (event, newStatus) {
//   return {
//     ...event,
//     status: newStatus,
//     statusHistory: [
//       ...event.statusHistory,
//       {
//         status: newStatus,
//         timestamp: new Date().toISOString(),
//       },
//     ],
//   }
// }

module.exports = (router) => {
  // Set clinics to active in nav for all urls starting with /clinics
  router.use('/clinics/:clinicId/events/:eventId', (req, res, next) => {
    const eventId = req.params.eventId
    const clinicId = req.params.clinicId
    const originalEventData = getEventData(req.session.data, clinicId, eventId)
    const data = req.session.data

    if (!originalEventData) {
      console.log(`No event ${eventId} found for clinic ${clinicId}`)
      res.redirect('/clinics/' + clinicId)
      return
    }

    // We store a temporary copy of the event to session for use by forms
    // If it doens't exist, create it now
    if (!data.event || data.event?.id !== eventId) {
      if (!data.event) {
        console.log('No temp event data found, creating new one')
      } else if (data.event?.id !== eventId) {
        console.log(
          `Temp event data found, but eventId ${data.event.id} does not match ${eventId}, creating new one`
        )
      }
      // Copy over the event data to the temp event
      data.event = originalEventData.event
    }

    const participantId = originalEventData.participant.id
    if (!data.participant || data.participant?.id !== participantId) {
      if (!data.participant) {
        console.log('No temp participant data found, creating new one')
      } else if (data.participant?.id !== participantId) {
        console.log(
          `Temp participant data found, but participantId ${data.participant.id} does not match ${participantId}, creating new one`
        )
      }
      // Copy over the participant data to the temp participant
      data.participant = { ...originalEventData.participant }
    }

    // Deep compare temp participant and saved participant in array
    const savedParticipant = data.participants.find(
      (p) => p.id === data.participant.id
    )
    res.locals.participantHasUnsavedChanges = !_.isEqual(
      data.participant,
      savedParticipant
    )

    // Deep compare temp event and saved event in array, excluding workflowStatus
    const savedEvent = data.events.find((e) => e.id === data.event.id)
    const tempEventForCompare = data.event ? { ...data.event } : undefined
    const savedEventForCompare = savedEvent ? { ...savedEvent } : undefined
    if (tempEventForCompare) delete tempEventForCompare.workflowStatus
    if (savedEventForCompare) delete savedEventForCompare.workflowStatus
    res.locals.eventHasUnsavedChanges = !_.isEqual(
      tempEventForCompare,
      savedEventForCompare
    )

    // This will now have any temp event data that forms have added too
    // We'll later save this back to the source data
    res.locals.event = data.event

    res.locals.eventData = originalEventData

    // Attach location to clinic for template convenience
    const clinic = { ...originalEventData.clinic }
    if (originalEventData.location) {
      clinic.location = originalEventData.location
    }
    res.locals.clinic = clinic

    res.locals.isAppointmentWorkflow = isAppointmentWorkflow(
      data.event,
      data.currentUser
    )

    res.locals.participant = data.participant
    res.locals.participantId = participantId
    res.locals.originalParticipant = savedParticipant
    res.locals.eventUrl = `/clinics/${clinicId}/events/${eventId}`
    res.locals.contextUrl = `/clinics/${clinicId}/events/${eventId}`
    res.locals.pageContext = 'event'
    res.locals.unit = originalEventData.unit
    res.locals.clinicId = clinicId
    res.locals.eventId = eventId

    // Ensure latest session data is available to views
    res.locals.data = req.session.data

    next()
  })

  // Main route in to starting an event - used to clear any temp data, set status to in progress and store the user id of the mammographer doing the appointment
  router.get('/clinics/:clinicId/events/:eventId/start', (req, res) => {
    const data = req.session.data
    const event = getEvent(data, req.params.eventId)
    const currentUser = data.currentUser
    const returnTo = req.query.returnTo // Used by /index so we can 'start' an appointment but then go to a different page.

    console.log(
      `Starting appointment for event ${req.params.eventId} by user ${currentUser.id}`
    )

    if (event?.status !== 'event_in_progress') {
      // Update status
      updateEventStatus(data, req.params.eventId, 'event_in_progress')

      // Store session details
      updateEventData(data, req.params.eventId, {
        sessionDetails: {
          startedAt: new Date().toISOString(),
          startedBy: currentUser.id
        }
      })
    }

    // Parse and apply workflow status from query parameters
    // This lets links in index.njk pre-complete certain sections
    // Look for parameters like event[workflowStatus][section]=completed
    if (req.query.event && req.query.event.workflowStatus) {
      const workflowUpdates = req.query.event.workflowStatus
      console.log('Applying workflow status updates:', workflowUpdates)

      updateEventData(data, req.params.eventId, {
        workflowStatus: workflowUpdates
      })
    }

    // Determine redirect destination
    // This lets us deep link in to the flow whilst still going through this setup route
    const defaultDestination = `/clinics/${req.params.clinicId}/events/${req.params.eventId}/confirm-identity`
    const finalDestination = returnTo
      ? `/clinics/${req.params.clinicId}/events/${req.params.eventId}/${returnTo}`
      : defaultDestination

    // Preserve all query string parameters except returnTo (already used)
    // Todo: could a library do this for us?
    const queryParams = { ...req.query }
    delete queryParams.returnTo
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

  // Leave appointment - revert status from in_progress back to checked_in
  router.get('/clinics/:clinicId/events/:eventId/leave', (req, res) => {
    const { clinicId, eventId } = req.params
    const data = req.session.data
    const event = getEvent(data, eventId)

    // Only allow leaving if the event is currently in progress
    if (event?.status === 'event_in_progress') {
      // Reset workflow status
      delete data.event.workflowStatus

      // Save any temporary changes before leaving
      saveTempEventToEvent(data)
      saveTempParticipantToParticipant(data)

      // Revert status back to checked in
      updateEventStatus(data, eventId, 'event_checked_in')

      // Clear session details
      updateEventData(data, eventId, {
        sessionDetails: {
          startedAt: null,
          startedBy: null
        }
      })

      // Clear temporary session data (now safe since we've saved changes)
      delete data.event
      delete data.participant

      console.log(
        'Left appointment - saved temp data, reverted status to checked_in, and cleared temp data'
      )

      // req.flash('info', 'You have left the appointment. The participant remains checked in.')
    }

    // Use referrer chain for redirect, fallback to clinic view
    const returnUrl = getReturnUrl(
      `/clinics/${clinicId}`,
      req.query.referrerChain
    )
    res.redirect(returnUrl)
  })

  // Exit appointment - handles discard or save
  router.post(
    '/clinics/:clinicId/events/:eventId/exit-appointment',
    (req, res) => {
      const { clinicId, eventId } = req.params
      const data = req.session.data
      const event = getEvent(data, eventId)
      const exitAction = data.exitAction

      // Only allow exiting if the event is currently in progress
      if (event?.status === 'event_in_progress') {
        if (exitAction === 'discard') {
          // Discard changes - reset workflow and revert to checked in
          delete data.event.workflowStatus

          // Revert status back to checked in
          updateEventStatus(data, eventId, 'event_checked_in')

          // Clear session details
          updateEventData(data, eventId, {
            sessionDetails: {
              startedAt: null,
              startedBy: null
            }
          })

          // Clear temporary session data without saving
          delete data.event
          delete data.participant

          console.log(
            'Exited appointment (discard) - reverted status to checked_in and cleared temp data'
          )
        }
        else if (exitAction === 'save') {
          // Save changes - keep current status
          delete data.event.workflowStatus

          // Save any temporary changes before leaving
          saveTempEventToEvent(data)
          saveTempParticipantToParticipant(data)

          // Clear temporary session data (now safe since we've saved changes)
          delete data.event
          delete data.participant

          console.log('Exited appointment (save) - saved temp data and cleared temp data')
        }
      }

      // Clear the exit action from session
      delete data.exitAction

      console.log(`After exit: data.event exists? ${!!data.event}, data.participant exists? ${!!data.participant}`)

      // Redirect to clinic view without referrer chain
      res.redirect(`/clinics/${clinicId}`)
    }
  )

  // Event within clinic context
  router.get('/clinics/:clinicId/events/:eventId', (req, res) => {
    const { clinicId, eventId } = req.params

    // Preserve query parameters when redirecting
    const queryString = Object.keys(req.query).length
      ? '?' + new URLSearchParams(req.query).toString()
      : ''

    res.redirect(
      `/clinics/${clinicId}/events/${eventId}/appointment${queryString}`
    )
  })

  router.post(
    '/clinics/:clinicId/events/:eventId/personal-details/ethnicity-answer',
    (req, res) => {
      const { clinicId, eventId } = req.params
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
            `/clinics/${clinicId}/events/${eventId}/personal-details/ethnicity`,
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
      // Redirect back to the event page (or wherever appropriate)

      const returnUrl = getReturnUrl(
        `/clinics/${clinicId}/events/${eventId}`,
        req.query.referrerChain
      )
      res.redirect(returnUrl)
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
    '/clinics/:clinicId/events/:eventId/can-appointment-go-ahead-answer',
    (req, res) => {
      const { clinicId, eventId } = req.params
      const data = req.session.data
      const canAppointmentGoAhead =
        data.event?.appointment?.canAppointmentGoAhead
      const event = getEvent(data, eventId)

      // No answer, return to page
      if (!canAppointmentGoAhead) {
        res.redirect(`/clinics/${clinicId}/events/${eventId}`)
      } else if (canAppointmentGoAhead === 'yes') {
        // Check-in participant if they're not already checked in
        if (event?.status !== 'event_checked_in') {
          updateEventStatus(data, eventId, 'event_checked_in')
        }
        res.redirect(
          `/clinics/${clinicId}/events/${eventId}/medical-information-check`
        )
      } else {
        res.redirect(
          `/clinics/${clinicId}/events/${eventId}/attended-not-screened-reason`
        )
      }
    }
  )

  // Main route in to starting an event - used to clear any temp data
  router.get(
    '/clinics/:clinicId/events/:eventId/previous-mammograms/add',
    (req, res) => {
      const { clinicId, eventId } = req.params
      delete req.session.data?.event?.previousMammogramTemp
      // Redirect to the form page
      res.redirect(
        urlWithReferrer(
          `/clinics/${clinicId}/events/${eventId}/previous-mammograms/form`,
          req.query.referrerChain,
          req.query.scrollTo
        )
      )
    }
  )

  // Save data about a mammogram
  router.post(
    '/clinics/:clinicId/events/:eventId/previous-mammograms/save',
    (req, res) => {
      const { clinicId, eventId } = req.params
      const data = req.session.data
      const previousMammogramTemp = data.event?.previousMammogramTemp
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
        const mammogram = {
          id: tempData.id || generateId(),
          ...tempData,
          ...additionalFields
        }

        // Add metadata for new mammograms
        if (isNewMammogram) {
          mammogram.dateAdded = new Date().toISOString()
          mammogram.addedBy = data.currentUser.id
        }

        return mammogram
      }

      // Helper function to save mammogram (update existing or add new)
      const saveMammogram = (mammogram) => {
        if (!data.event.previousMammograms) {
          data.event.previousMammograms = []
        }

        // Update existing or add new
        const existingIndex = data.event.previousMammograms.findIndex(
          (m) => m.id === mammogram.id
        )
        if (existingIndex !== -1) {
          data.event.previousMammograms[existingIndex] = mammogram
        } else {
          data.event.previousMammograms.push(mammogram)
        }
      }

      // Check if this is coming from "proceed anyway" page
      if (action === 'proceed-anyway') {
        // Validate that a reason was provided
        if (!previousMammogramTemp?.overrideReason) {
          // Set error in flash and redirect back to proceed-anyway page
          req.flash('error', {
            text: 'Enter a reason for proceeding with this appointment',
            name: 'event_previousMammogramTemp_overrideReason'
          })
          return res.redirect(
            `/clinics/${clinicId}/events/${eventId}/previous-mammograms/proceed-anyway`
          )
        }

        // Build and save the mammogram with override flag
        const mammogram = buildMammogramObject(previousMammogramTemp, {
          warningOverridden: true
        })
        saveMammogram(mammogram)

        req.flash('success', mammogramAddedMessage)

        delete data.event?.previousMammogramTemp

        const returnUrl = getReturnUrl(
          `/clinics/${clinicId}/events/${eventId}`,
          referrerChain,
          scrollTo
        )

        return res.redirect(returnUrl)
      }

      // Handle the direct cancel action from appointment-should-not-proceed.html
      if (action === 'end-immediately') {
        // Set stopping reason for the appointment
        if (!data.event.appointmentStopped) {
          data.event.appointmentStopped = {}
        }
        data.event.appointmentStopped.stoppedReason = 'recent_mammogram'
        data.event.appointmentStopped.needsReschedule = 'no' // Default to no reschedule needed

        // Build and save the mammogram
        const mammogram = buildMammogramObject(previousMammogramTemp)
        saveMammogram(mammogram)
        delete data.event?.previousMammogramTemp

        // Get participant info for message
        const participantName = getFullName(data.participant)
        const participantEventUrl = `/clinics/${clinicId}/events/${eventId}`

        // Save changes and update status
        saveTempEventToEvent(data)
        saveTempParticipantToParticipant(data)
        updateEventStatus(data, eventId, 'event_attended_not_screened')

        // Flash success message
        const successMessage = `
      ${participantName} has been 'attended not screened'. <a href="${participantEventUrl}" class="app-nowrap">View their appointment</a>`
        req.flash('success', { wrapWithHeading: successMessage })

        // Return to clinic list
        return res.redirect(`/clinics/${clinicId}/`)
      }

      // Check if this is a recent mammogram (within 6 months)
      const isRecentMammogram = checkIfRecentMammogram(previousMammogramTemp)

      // If recent mammogram detected and not already coming from warning page
      if (isRecentMammogram && action !== 'acknowledged-warning') {
        return res.redirect(
          urlWithReferrer(
            `/clinics/${clinicId}/events/${eventId}/previous-mammograms/appointment-should-not-proceed`,
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

      delete data.event?.previousMammogramTemp

      // If user acknowledged the warning page, handle their reschedule decision
      if (action === 'acknowledged-warning') {
        const needsReschedule = data.event?.appointmentStopped?.needsReschedule

        // Validate that reschedule option was selected
        if (!needsReschedule) {
          req.flash('error', {
            text: 'Select whether the appointment should be rescheduled',
            name: 'event[appointmentStopped][needsReschedule]',
            href: '#needsReschedule'
          })
          return res.redirect(
            urlWithReferrer(
              `/clinics/${clinicId}/events/${eventId}/previous-mammograms/appointment-should-not-proceed`,
              referrerChain,
              scrollTo
            )
          )
        }

        // Set stopping reason for the appointment
        if (!data.event.appointmentStopped) {
          data.event.appointmentStopped = {}
        }
        data.event.appointmentStopped.stoppedReason = ['Recent mammogram']

        // If yes, redirect to reschedule page
        if (needsReschedule === 'yes') {
          return res.redirect(
            `/clinics/${clinicId}/events/${eventId}/cancel-or-reschedule-appointment/reschedule`
          )
        } else if (needsReschedule === 'no-invite') {
          // Get participant info BEFORE saving (which clears temp data)
          const participantName = getFullName(data.participant)
          const participantEventUrl = `/clinics/${clinicId}/events/${eventId}`

          // Save changes and update status
          saveTempEventToEvent(data)
          saveTempParticipantToParticipant(data)
          updateEventStatus(data, eventId, 'event_attended_not_screened')

          // Flash success message
          const successMessage = `
    ${participantName} will be invited to the next routine appointment. <a href="${participantEventUrl}" class="app-nowrap">View their appointment</a>`
          req.flash('success', { wrapWithHeading: successMessage })

          // Return to clinic list
          return res.redirect(`/clinics/${clinicId}/`)
        }
      }

      req.flash('success', mammogramAddedMessage)

      const returnUrl = getReturnUrl(
        `/clinics/${clinicId}/events/${eventId}`,
        referrerChain,
        scrollTo
      )
      res.redirect(returnUrl)
    }
  )

  // Edit existing previous mammogram
  router.get(
    '/clinics/:clinicId/events/:eventId/previous-mammograms/edit/:mammogramId',
    (req, res) => {
      const { clinicId, eventId, mammogramId } = req.params
      const data = req.session.data

      // Find the mammogram by ID
      const mammogram = data.event?.previousMammograms?.find(
        (m) => m.id === mammogramId
      )

      if (mammogram) {
        // Copy to temp for editing
        data.event.previousMammogramTemp = { ...mammogram }
      } else {
        console.log(`Cannot find previous mammogram with ID ${mammogramId}`)
      }

      // Redirect to the form page
      res.redirect(
        urlWithReferrer(
          `/clinics/${clinicId}/events/${eventId}/previous-mammograms/form`,
          req.query.referrerChain,
          req.query.scrollTo
        )
      )
    }
  )

  // Delete previous mammogram
  router.get(
    '/clinics/:clinicId/events/:eventId/previous-mammograms/delete/:mammogramId',
    (req, res) => {
      const { clinicId, eventId, mammogramId } = req.params
      const data = req.session.data

      // Remove mammogram from array
      if (data.event?.previousMammograms) {
        data.event.previousMammograms = data.event.previousMammograms.filter(
          (m) => m.id !== mammogramId
        )
      }

      req.flash('success', 'Previous mammogram deleted')

      const returnUrl = getReturnUrl(
        `/clinics/${clinicId}/events/${eventId}`,
        req.query.referrerChain,
        req.query.scrollTo
      )
      res.redirect(returnUrl)
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
    '/clinics/:clinicId/events/:eventId/medical-information/symptoms/save',
    (req, res) => {
      const { clinicId, eventId } = req.params
      const data = req.session.data
      const action = req.body?.action || req.query.action // 'save' or 'save-and-add'
      const nextSymptomType = req.query.symptomType // camelCase symptom type
      const referrerChain = req.query.referrerChain
      const scrollTo = req.query.scrollTo

      // Save temp symptom to array
      if (data.event?.symptomTemp) {
        // Initialize medicalInformation object if needed
        if (!data.event.medicalInformation) {
          data.event.medicalInformation = {}
        }

        // Initialize symptoms array if needed
        if (!data.event.medicalInformation.symptoms) {
          data.event.medicalInformation.symptoms = []
        }

        const symptomTemp = data.event.symptomTemp
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
          hasBeenInvestigated: symptomTemp.hasBeenInvestigated,
          additionalInfo: symptomTemp.additionalInfo
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

        // Add investigation details if investigated
        if (symptomTemp.hasBeenInvestigated === 'yes') {
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
        } else if (symptomTemp.dateType === 'notSure') {
          delete symptom.approximateDuration
        }

        console.log('symptomTemp', symptomTemp)

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
          symptom.location = symptomTemp.location

          // if (symptomTemp.location?.includes('other')) {
          //   symptom.otherLocationDescription = symptomTemp.otherLocationDescription
          // }
          // Add location descriptions
          if (symptomTemp.location === 'right breast') {
            symptom.rightBreastDescription = symptomTemp.rightBreastDescription
          } else if (symptomTemp.location === 'left breast') {
            symptom.leftBreastDescription = symptomTemp.leftBreastDescription
          } else if (symptomTemp.location === 'both breasts') {
            symptom.bothBreastsDescription = symptomTemp.bothBreastsDescription
          } else if (symptomTemp.location === 'other') {
            symptom.otherLocationDescription =
              symptomTemp.otherLocationDescription
          }
        }

        // Update existing or add new
        const existingIndex = data.event.medicalInformation.symptoms.findIndex(
          (s) => s.id === symptom.id
        )
        if (existingIndex !== -1) {
          data.event.medicalInformation.symptoms[existingIndex] = symptom
        } else {
          data.event.medicalInformation.symptoms.push(symptom)
        }

        delete data.event.symptomTemp
      }

      // Redirect based on action and symptom type
      if (action === 'save-and-add') {
        if (nextSymptomType) {
          // Redirect to add specific symptom type
          res.redirect(
            `/clinics/${clinicId}/events/${eventId}/medical-information/symptoms/add?symptomType=${nextSymptomType}${referrerChain ? '&referrerChain=' + referrerChain : ''}`
          )
        } else {
          // Fallback to general add page
          res.redirect(
            urlWithReferrer(
              `/clinics/${clinicId}/events/${eventId}/medical-information/symptoms/add`,
              referrerChain,
              scrollTo
            )
          )
        }
      } else {
        // Regular save - redirect back to medical information page
        const returnUrl = getReturnUrl(
          `/clinics/${clinicId}/events/${eventId}/review-medical-information`,
          referrerChain,
          scrollTo
        )
        console.log('Redirecting to:', returnUrl, 'scrollTo:', scrollTo)
        res.redirect(returnUrl)
      }
    }
  )

  // Edit existing symptom
  router.get(
    '/clinics/:clinicId/events/:eventId/medical-information/symptoms/edit/:symptomId',
    (req, res) => {
      const { clinicId, eventId, symptomId } = req.params
      const data = req.session.data

      // Initialize medicalInformation if needed
      if (!data.event.medicalInformation) {
        data.event.medicalInformation = {}
      }

      // Check new location first
      let symptom = data.event.medicalInformation.symptoms?.find(
        (s) => s.id === symptomId
      )

      // Check old location if not found (for migration purposes)
      if (!symptom && data.event.symptoms) {
        symptom = data.event.symptoms.find((s) => s.id === symptomId)
      }

      if (symptom) {
        data.event.symptomTemp = { ...symptom }
      }

      // Go directly to details page since we already know the type
      res.redirect(
        urlWithReferrer(
          `/clinics/${clinicId}/events/${eventId}/medical-information/symptoms/details`,
          req.query.referrerChain
        )
      )
    }
  )

  // Delete symptom
  router.get(
    '/clinics/:clinicId/events/:eventId/medical-information/symptoms/delete/:symptomId',
    (req, res) => {
      const { clinicId, eventId, symptomId } = req.params
      const data = req.session.data

      // Remove symptom from new location
      if (data.event?.medicalInformation?.symptoms) {
        data.event.medicalInformation.symptoms =
          data.event.medicalInformation.symptoms.filter(
            (s) => s.id !== symptomId
          )
      }

      // Remove symptom from old location too (for migration purposes)
      if (data.event?.symptoms) {
        data.event.symptoms = data.event.symptoms.filter(
          (s) => s.id !== symptomId
        )
      }

      req.flash('success', 'Symptom deleted')

      const returnUrl = getReturnUrl(
        `/clinics/${clinicId}/events/${eventId}/review-medical-information`,
        req.query.referrerChain,
        req.query.scrollTo
      )
      res.redirect(returnUrl)
    }
  )

  // Main route in to starting an event - used to clear any temp data
  router.get(
    '/clinics/:clinicId/events/:eventId/medical-information/symptoms/add',
    (req, res) => {
      const { clinicId, eventId } = req.params
      const { symptomType } = req.query
      console.log('Adding symptom type:', symptomType)
      const data = req.session.data

      // Clear any existing temp symptom data
      delete data.event?.symptomTemp

      // If symptomType is provided, pre-populate and go to details
      if (symptomType) {
        // Find symptom type by slug
        const symptomTypeConfig = symptomTypes.find(
          (st) => st.slug === symptomType
        )

        if (symptomTypeConfig) {
          // Pre-populate symptomTemp with the selected type
          data.event.symptomTemp = {
            type: sentenceCase(symptomTypeConfig.name)
          }

          // Redirect to details page
          return res.redirect(
            urlWithReferrer(
              `/clinics/${clinicId}/events/${eventId}/medical-information/symptoms/details`,
              req.query.referrerChain,
              req.query.scrollTo
            )
          )
        }
      }

      // No symptomType or invalid type - go to type selection page
      res.redirect(
        urlWithReferrer(
          `/clinics/${clinicId}/events/${eventId}/medical-information/symptoms/type`,
          req.query.referrerChain,
          req.query.scrollTo
        )
      )
    }
  )

  // Save breast features (includes converting JSON string to structured data)
  router.post(
    '/clinics/:clinicId/events/:eventId/medical-information/record-breast-features/save',
    (req, res) => {
      const { clinicId, eventId } = req.params
      const data = req.session.data
      const referrerChain = req.query.referrerChain
      const scrollTo = req.query.scrollTo

      let conversionsCount = 0
      let errorCount = 0

      // Convert breast features raw data
      if (data.event?.medicalInformation?.breastFeaturesRaw) {
        try {
          const rawFeatures = data.event.medicalInformation.breastFeaturesRaw
          if (typeof rawFeatures === 'string') {
            data.event.medicalInformation.breastFeatures =
              JSON.parse(rawFeatures)
            // Delete the raw data once converted
            delete data.event.medicalInformation.breastFeaturesRaw
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

      // Flash error message if needed
      if (errorCount > 0) {
        req.flash(
          'error',
          'Some data could not be converted. Please check the information and try again.'
        )
      }

      // Redirect back using referrer chain
      const returnUrl = getReturnUrl(
        `/clinics/${clinicId}/events/${eventId}`,
        referrerChain,
        scrollTo
      )
      res.redirect(returnUrl)
    }
  )

  // Medical history

  // Medical history routes - add these to the events.js file

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
    '/clinics/:clinicId/events/:eventId/medical-information/medical-history/select',
    (req, res) => {
      const { clinicId, eventId } = req.params
      const data = req.session.data
      const typeSlug = data.medicalHistoryTypeSlug
      const referrerChain = req.query.referrerChain
      const scrollTo = req.query.scrollTo

      // Validate type
      if (!typeSlug || !isValidMedicalHistoryType(typeSlug)) {
        return res.redirect(
          urlWithReferrer(
            `/clinics/${clinicId}/events/${eventId}/medical-information/medical-history/type`,
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
          `/clinics/${clinicId}/events/${eventId}/medical-information/medical-history/${typeSlug}/add`,
          referrerChain,
          scrollTo
        )
      )
    }
  )

  // Add new medical history item - clear temp data and redirect to form
  router.get(
    '/clinics/:clinicId/events/:eventId/medical-information/medical-history/:type/add',
    (req, res) => {
      const { clinicId, eventId, type } = req.params

      // Validate type
      if (!isValidMedicalHistoryType(type)) {
        return res.redirect(
          `/clinics/${clinicId}/events/${eventId}/review-medical-information`
        )
      }

      // Clear any existing temp medical history data
      delete req.session.data.event?.medicalHistoryTemp

      // Redirect to the form (assumes template exists at medical-information/medical-history/[type])
      res.redirect(
        urlWithReferrer(
          `/clinics/${clinicId}/events/${eventId}/medical-information/medical-history/${type}`,
          req.query.referrerChain,
          req.query.scrollTo
        )
      )
    }
  )

  // Save medical history item - handles both 'save' and 'save and add another'
  router.post(
    '/clinics/:clinicId/events/:eventId/medical-information/medical-history/:type/save',
    (req, res) => {
      const { clinicId, eventId, type } = req.params
      const data = req.session.data
      const action = req.body.action || 'save'
      const referrerChain = req.query.referrerChain
      const scrollTo = req.query.scrollTo

      // Validate type
      if (!isValidMedicalHistoryType(type)) {
        return res.redirect(
          `/clinics/${clinicId}/events/${eventId}/review-medical-information`
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
        const medicalHistoryTemp = data.event?.medicalHistoryTemp
        const rightBreastProcedures =
          medicalHistoryTemp?.proceduresRightBreast || []
        const leftBreastProcedures =
          medicalHistoryTemp?.proceduresLeftBreast || []

        // Check if breast implants were selected in either breast
        const hasBreastImplants =
          rightBreastProcedures.includes('Breast implants') ||
          leftBreastProcedures.includes('Breast implants')

        if (hasBreastImplants) {
          // Redirect to consent page immediately - we'll save the data after consent
          return res.redirect(
            urlWithReferrer(
              `/clinics/${clinicId}/events/${eventId}/medical-information/medical-history/consent`,
              referrerChain,
              scrollTo
            )
          )
        }
      }

      let isNewItem

      // Save temp medical history to array
      if (data.event?.medicalHistoryTemp) {
        // Initialize medicalInformation object if needed
        if (!data.event.medicalInformation) {
          data.event.medicalInformation = {}
        }

        // Initialize medicalHistory object if needed
        if (!data.event.medicalInformation.medicalHistory) {
          data.event.medicalInformation.medicalHistory = {}
        }

        // Initialize array for this type if needed
        if (!data.event.medicalInformation.medicalHistory[dataKey]) {
          data.event.medicalInformation.medicalHistory[dataKey] = []
        }

        const medicalHistoryTemp = data.event.medicalHistoryTemp
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
        const existingIndex = data.event.medicalInformation.medicalHistory[
          dataKey
        ].findIndex((item) => item.id === medicalHistoryItem.id)
        if (existingIndex !== -1) {
          data.event.medicalInformation.medicalHistory[dataKey][existingIndex] =
            medicalHistoryItem
        } else {
          data.event.medicalInformation.medicalHistory[dataKey].push(
            medicalHistoryItem
          )
        }

        // Clear temp data
        delete data.event.medicalHistoryTemp
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
        delete data.event.medicalHistoryTemp

        // Redirect directly to the form instead of going through the add route
        res.redirect(
          urlWithReferrer(
            `/clinics/${clinicId}/events/${eventId}/medical-information/medical-history/${type}`,
            referrerChain,
            scrollTo
          )
        )
      } else {
        // Regular save - redirect back to medical information page
        const returnUrl = getReturnUrl(
          `/clinics/${clinicId}/events/${eventId}/review-medical-information`,
          referrerChain,
          scrollTo
        )
        res.redirect(returnUrl)
      }
    }
  )

  // Edit existing medical history item
  router.get(
    '/clinics/:clinicId/events/:eventId/medical-information/medical-history/:type/edit/:itemId',
    (req, res) => {
      const { clinicId, eventId, type, itemId } = req.params
      const data = req.session.data

      // Validate type
      if (!isValidMedicalHistoryType(type)) {
        return res.redirect(
          `/clinics/${clinicId}/events/${eventId}/review-medical-information`
        )
      }

      // Convert slug to camelCase key for data lookup
      const dataKey = getMedicalHistoryKeyFromSlug(type) || type

      // Initialize medicalInformation if needed
      if (!data.event.medicalInformation) {
        data.event.medicalInformation = {}
      }

      // Find the medical history item using the correct data key
      const medicalHistoryItem = data.event.medicalInformation.medicalHistory?.[
        dataKey
      ]?.find((item) => item.id === itemId)

      if (medicalHistoryItem) {
        // Copy to temp for editing
        data.event.medicalHistoryTemp = { ...medicalHistoryItem }
      } else {
        console.log(`Cannot find item ${itemId} in ${dataKey}`)
      }

      // Redirect to the form
      res.redirect(
        urlWithReferrer(
          `/clinics/${clinicId}/events/${eventId}/medical-information/medical-history/${type}`,
          req.query.referrerChain,
          req.query.scrollTo
        )
      )
    }
  )

  // Delete medical history item
  router.get(
    '/clinics/:clinicId/events/:eventId/medical-information/medical-history/:type/delete/:itemId',
    (req, res) => {
      const { clinicId, eventId, type, itemId } = req.params
      const data = req.session.data

      // Validate type
      if (!isValidMedicalHistoryType(type)) {
        return res.redirect(
          `/clinics/${clinicId}/events/${eventId}/review-medical-information`
        )
      }

      const typeConfig = getMedicalHistoryType(type)
      // Convert slug to camelCase key for data lookup
      const dataKey = getMedicalHistoryKeyFromSlug(type) || type

      // Remove item from array
      if (data.event?.medicalInformation?.medicalHistory?.[dataKey]) {
        data.event.medicalInformation.medicalHistory[dataKey] =
          data.event.medicalInformation.medicalHistory[dataKey].filter(
            (item) => item.id !== itemId
          )
      }

      req.flash('success', `${typeConfig.name} deleted`)

      const returnUrl = getReturnUrl(
        `/clinics/${clinicId}/events/${eventId}/review-medical-information`,
        req.query.referrerChain,
        req.query.scrollTo
      )
      res.redirect(returnUrl)
    }
  )

  // Route handler for breast implants consent – appointment cannot proceed

  router.post(
    '/clinics/:clinicId/events/:eventId/medical-information/medical-history/appointment-cannot-proceed-answer',
    (req, res) => {
      const { clinicId, eventId } = req.params
      const data = req.session.data
      const participantName = getFullName(data.participant)

      const futureScreeningPlan = data.event?.cannotProceed?.futureScreeningPlan

      // Validate that an option was selected
      if (!futureScreeningPlan) {
        req.flash('error', {
          text: 'Select whether the participant plans to attend breast screening in future',
          name: 'event[cannotProceed][futureScreeningPlan]',
          href: '#futureScreeningPlan'
        })
        return res.redirect(
          `/clinics/${clinicId}/events/${eventId}/medical-information/medical-history/appointment-cannot-proceed`
        )
      }

      // Capture session end time only if appointment was started
      const event = getEvent(data, eventId)
      if (event?.sessionDetails?.startedAt) {
        captureSessionEndTime(data, eventId, data.currentUser.id)
      }

      // Save the data
      saveTempEventToEvent(data)
      saveTempParticipantToParticipant(data)

      // Update event status to indicate cannot proceed
      updateEventStatus(data, eventId, 'event_cancelled')

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
      res.redirect(`/clinics/${clinicId}`)
    }
  )

  // Handle breast implants consent form submission
  router.post(
    '/clinics/:clinicId/events/:eventId/medical-information/medical-history/consent-answer',
    (req, res) => {
      const { clinicId, eventId } = req.params
      const data = req.session.data
      const consentGiven =
        data.event?.medicalInformation?.implantedDevices?.consentGiven
      const referrerChain = req.query.referrerChain
      const scrollTo = req.query.scrollTo

      // Validate that an option was selected
      if (!consentGiven) {
        req.flash('error', {
          text: 'Select whether they have signed the consent form',
          name: 'event[medicalInformation][implantedDevices][consentGiven]',
          href: '#consentGiven'
        })
        return res.redirect(
          `/clinics/${clinicId}/events/${eventId}/medical-information/medical-history/consent`
        )
      }

      // Handle "Yes" - full consent given
      if (consentGiven === 'yes') {
        // Save the medical history data that was in temp
        if (data.event?.medicalHistoryTemp) {
          // Initialize medicalInformation object if needed
          if (!data.event.medicalInformation) {
            data.event.medicalInformation = {}
          }

          // Initialize medicalHistory object if needed
          if (!data.event.medicalInformation.medicalHistory) {
            data.event.medicalInformation.medicalHistory = {}
          }

          // Initialize array for breast implants if needed
          if (
            !data.event.medicalInformation.medicalHistory
              .breastImplantsAugmentation
          ) {
            data.event.medicalInformation.medicalHistory.breastImplantsAugmentation =
              []
          }

          const medicalHistoryTemp = data.event.medicalHistoryTemp
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
            data.event.medicalInformation.medicalHistory.breastImplantsAugmentation.findIndex(
              (item) => item.id === medicalHistoryItem.id
            )
          if (existingIndex !== -1) {
            data.event.medicalInformation.medicalHistory.breastImplantsAugmentation[
              existingIndex
            ] = medicalHistoryItem
          } else {
            data.event.medicalInformation.medicalHistory.breastImplantsAugmentation.push(
              medicalHistoryItem
            )
          }

          // Clear temp data
          delete data.event.medicalHistoryTemp
        }

        // Show combined success message
        req.flash('success', 'Breast implants recorded and consent recorded')

        // Continue to next step in the flow
        const returnUrl = getReturnUrl(
          `/clinics/${clinicId}/events/${eventId}/review-medical-information`,
          referrerChain,
          scrollTo
        )
        res.redirect(returnUrl)
      }
      // Handle "No, but scan unaffected breast"
      else if (consentGiven.startsWith('no-continue-')) {
        const unaffectedBreast = consentGiven.replace('no-continue-', '')
        const affectedBreast = unaffectedBreast === 'left' ? 'right' : 'left'

        // Save the medical history data with partial consent
        if (data.event?.medicalHistoryTemp) {
          // Initialize medicalInformation object if needed
          if (!data.event.medicalInformation) {
            data.event.medicalInformation = {}
          }

          // Initialize medicalHistory object if needed
          if (!data.event.medicalInformation.medicalHistory) {
            data.event.medicalInformation.medicalHistory = {}
          }

          // Initialize array for breast implants if needed
          if (
            !data.event.medicalInformation.medicalHistory
              .breastImplantsAugmentation
          ) {
            data.event.medicalInformation.medicalHistory.breastImplantsAugmentation =
              []
          }

          const medicalHistoryTemp = data.event.medicalHistoryTemp
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
            data.event.medicalInformation.medicalHistory.breastImplantsAugmentation.findIndex(
              (item) => item.id === medicalHistoryItem.id
            )
          if (existingIndex !== -1) {
            data.event.medicalInformation.medicalHistory.breastImplantsAugmentation[
              existingIndex
            ] = medicalHistoryItem
          } else {
            data.event.medicalInformation.medicalHistory.breastImplantsAugmentation.push(
              medicalHistoryItem
            )
          }

          // Clear temp data
          delete data.event.medicalHistoryTemp
        }

        // Set success message
        req.flash(
          'success',
          `Consent recorded as not given for ${affectedBreast} breast, but ${unaffectedBreast} breast to be scanned`
        )

        // Redirect back to medical history page
        const returnUrl = getReturnUrl(
          `/clinics/${clinicId}/events/${eventId}/review-medical-information`,
          referrerChain,
          scrollTo
        )
        res.redirect(returnUrl)
      }
      // Handle "No, end appointment"
      else if (consentGiven === 'no') {
        // Don't save the medical history data - consent not given
        delete data.event.medicalHistoryTemp

        // Redirect to appointment cannot proceed page
        res.redirect(
          `/clinics/${clinicId}/events/${eventId}/medical-information/medical-history/appointment-cannot-proceed`
        )
      }
    }
  )

  // Imaging view - this is the main imaging page for the event

  // Generate mammogram data when simulating automatic upload
  router.get(
    '/clinics/:clinicId/events/:eventId/images-automatic',
    (req, res) => {
      const { clinicId, eventId } = req.params
      const data = req.session.data
      const eventData = getEventData(req.session.data, clinicId, eventId)

      // If no mammogram data exists, generate it
      if (!data?.event?.mammogramData) {
        // Set start time to 3 minutes ago to simulate an in-progress screening
        const startTime = dayjs().subtract(3, 'minutes').toDate()
        const mammogramData = generateMammogramImages({
          startTime,
          isSeedData: false,
          config: eventData?.participant?.config
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

        data.event.mammogramData = mammogramData
        res.locals.event = data.event
      }

      res.render('events/images-automatic', {})
    }
  )

  // Handle medical information answer
  router.post(
    '/clinics/:clinicId/events/:eventId/medical-information-answer',
    (req, res) => {
      const { clinicId, eventId } = req.params
      const data = req.session.data
      const hasRelevantMedicalInformation =
        data?.event?.medicalInformation?.hasRelevantMedicalInformation

      if (!hasRelevantMedicalInformation) {
        res.redirect(
          `/clinics/${clinicId}/events/${eventId}/medical-information-check`
        )
      } else if (hasRelevantMedicalInformation === 'yes') {
        res.redirect(
          `/clinics/${clinicId}/events/${eventId}/review-medical-information`
        )
      } else {
        res.redirect(`/clinics/${clinicId}/events/${eventId}/awaiting-images`)
      }
    }
  )

  // Handle record medical information answer
  router.post(
    '/clinics/:clinicId/events/:eventId/review-medical-information-answer',
    (req, res) => {
      const { clinicId, eventId } = req.params
      const data = req.session.data
      const imagingCanProceed = data?.event?.appointment?.imagingCanProceed

      if (!imagingCanProceed) {
        res.redirect(
          `/clinics/${clinicId}/events/${eventId}/review-medical-information`
        )
      } else if (imagingCanProceed === 'yes') {
        res.redirect(`/clinics/${clinicId}/events/${eventId}/awaiting-images`)
      } else {
        res.redirect(
          `/clinics/${clinicId}/events/${eventId}/attended-not-screened-reason`
        )
      }
    }
  )

  // Handle screening completion
  router.post(
    '/clinics/:clinicId/events/:eventId/imaging-answer',
    (req, res) => {
      const { clinicId, eventId } = req.params
      const data = req.session.data

      // Save current screening room if not already set
      if (!data.event.mammogramData.machineRoom && data.currentScreeningRoom) {
        const screeningRooms = data.screeningRooms || []
        const currentRoom = screeningRooms.find(
          (room) => room.id === data.currentScreeningRoom
        )
        if (currentRoom) {
          data.event.mammogramData.machineRoom = currentRoom.displayName
        }
      }

      // Process repeat data from form submission for automatic flow
      // The form fields are named like "event[mammogramData][repeatNeeded-RCC]"
      // and are already in data.event.mammogramData
      const mammogramData = data.event.mammogramData
      if (mammogramData.views) {
        for (const [viewKey, viewData] of Object.entries(mammogramData.views)) {
          const code = viewData.viewShortWithSide
          const imageCount = viewData.images ? viewData.images.length : 0

          if (imageCount > 1) {
            const repeatNeeded = mammogramData[`repeatNeeded-${code}`]
            const extraImageCount = imageCount - 1
            let repeatCount = 0
            let repeatReasons = null

            if (repeatNeeded === 'yes') {
              // Single extra image answered "yes"
              repeatCount = 1
              const reasons = mammogramData[`repeatReasons-${code}`]
              if (reasons && reasons.length > 0) {
                repeatReasons = reasons
              }
            } else if (repeatNeeded === 'all-repeats') {
              // All extra images were repeats
              repeatCount = extraImageCount
              const reasons = mammogramData[`repeatReasons-${code}`]
              if (reasons && reasons.length > 0) {
                repeatReasons = reasons
              }
            } else if (repeatNeeded === 'some-repeats') {
              // Some were repeats, some were additional
              repeatCount = parseInt(mammogramData[`repeatCount-${code}`]) || 0
              const reasons = mammogramData[`repeatReasons-${code}`]
              if (reasons && reasons.length > 0) {
                repeatReasons = reasons
              }
            }

            // Update view with repeat information
            viewData.repeatCount = repeatCount
            viewData.repeatReasons = repeatReasons
          }
        }
      }

      const isPartialMammography = data.event.mammogramData.isPartialMammography

      // Check if array includes 'yes' (checkbox format) or equals 'yes' (string format from manual entry)
      const hasPartialMammography = Array.isArray(isPartialMammography)
        ? isPartialMammography.includes('yes')
        : isPartialMammography === 'yes'

      // Initialize workflowStatus if it doesn't exist
      if (!data.event.workflowStatus) {
        data.event.workflowStatus = {}
      }

      // Mark the workflow step as completed regardless of partial mammography status
      data.event.workflowStatus['take-images'] = 'completed'

      // Redirect to check information page
      res.redirect(`/clinics/${clinicId}/events/${eventId}/check-information`)
    }
  )

  // Manual imaging routes

  // Handle take-images route - redirect to appropriate page based on state
  router.get('/clinics/:clinicId/events/:eventId/take-images', (req, res) => {
    const { clinicId, eventId } = req.params
    const data = req.session.data

    const isManualImageCollection =
      data.settings?.screening?.manualImageCollection
    const imagesStageCompleted =
      data.event?.workflowStatus?.['take-images'] === 'completed'

    // If manual flow and images already completed, redirect to details page for editing
    if (
      isManualImageCollection &&
      imagesStageCompleted &&
      data.event?.mammogramData?.isManualEntry
    ) {
      return res.redirect(
        `/clinics/${clinicId}/events/${eventId}/images-manual-details`
      )
    }

    // If automatic flow and images completed, redirect to automatic page
    if (
      !isManualImageCollection &&
      imagesStageCompleted &&
      data.event?.mammogramData
    ) {
      return res.redirect(
        `/clinics/${clinicId}/events/${eventId}/images-automatic`
      )
    }

    // Otherwise render the take-images template which will determine which flow to show
    res.render('events/take-images')
  })

  // Initialize or edit manual imaging - clears temp or prepopulates from existing data
  router.get('/clinics/:clinicId/events/:eventId/images-manual', (req, res) => {
    const { clinicId, eventId } = req.params
    const data = req.session.data

    // If mammogramData exists and is manual entry, prepopulate temp for editing
    if (data.event?.mammogramData?.isManualEntry) {
      const formData = convertMammogramFormatToFormData(
        data.event.mammogramData
      )
      if (formData) {
        data.event.mammogramDataTemp = formData
      }
    } else {
      // Clear any existing temp data for fresh start
      delete data.event.mammogramDataTemp
    }

    // Let the dynamic routing handle the actual rendering
    res.render('events/images-manual')
  })

  // Direct link to details page - also prepopulates if editing
  router.get(
    '/clinics/:clinicId/events/:eventId/images-manual-details',
    (req, res) => {
      const { clinicId, eventId } = req.params
      const data = req.session.data

      // If mammogramData exists and is manual entry, prepopulate temp for editing
      if (
        data.event?.mammogramData?.isManualEntry &&
        !data.event?.mammogramDataTemp
      ) {
        const formData = convertMammogramFormatToFormData(
          data.event.mammogramData
        )
        if (formData) {
          data.event.mammogramDataTemp = formData
        }
      }

      // Let the dynamic routing handle the actual rendering
      res.render('events/images-manual-details')
    }
  )

  // Direct link to repeats page - also prepopulates if editing
  router.get(
    '/clinics/:clinicId/events/:eventId/images-manual-repeats',
    (req, res) => {
      const { clinicId, eventId } = req.params
      const data = req.session.data

      // If mammogramData exists and is manual entry, prepopulate temp for editing
      if (
        data.event?.mammogramData?.isManualEntry &&
        !data.event?.mammogramDataTemp
      ) {
        const formData = convertMammogramFormatToFormData(
          data.event.mammogramData
        )
        if (formData) {
          data.event.mammogramDataTemp = formData
        }
      }

      // Let the dynamic routing handle the actual rendering
      res.render('events/images-manual-repeats')
    }
  )

  /**
   * Helper function to check if any view has multiple images (needs repeat question)
   */
  function needsRepeatQuestions(mammogramDataTemp) {
    const views = ['viewsRightBreast', 'viewsLeftBreast']
    const viewTypes = ['CC', 'MLO', 'Eklund']

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
      isPartialMammography:
        mammogramData.isPartialMammography === 'yes' ? ['yes'] : [],
      partialMammographyReasonSelect:
        mammogramData.partialMammographyReasonSelect,
      partialMammographyReasonComment:
        mammogramData.partialMammographyReasonComment,
      partialMammographyShouldReinvite:
        mammogramData.partialMammographyShouldReinvite === 'yes' ? ['yes'] : [],
      additionalDetails: mammogramData.additionalDetails,
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
        viewType: 'Eklund',
        viewName: 'Eklund',
        viewKey: 'rightEklund'
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
        viewType: 'Eklund',
        viewName: 'Eklund',
        viewKey: 'leftEklund'
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
        // For Eklund views, use full form like "Right Eklund" or "Left Eklund"
        // For standard views, use abbreviated form like "RCC" or "LMLO"
        const code =
          config.viewType === 'Eklund'
            ? `${config.side.charAt(0).toUpperCase() + config.side.slice(1)} ${config.viewType}`
            : `${config.sideCode}${config.viewType}`

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

    // Handle partial mammography reason
    let partialMammographyReason = null
    let partialMammographyShouldReinvite = null

    if (formData.isPartialMammography?.includes('yes')) {
      const reasonSelect = formData.partialMammographyReasonSelect
      const reasonComment = formData.partialMammographyReasonComment

      if (reasonSelect && reasonComment) {
        partialMammographyReason = `${reasonSelect}: ${reasonComment}`
      } else if (reasonSelect) {
        partialMammographyReason = reasonSelect
      } else if (reasonComment) {
        partialMammographyReason = reasonComment
      }

      partialMammographyShouldReinvite =
        formData.partialMammographyShouldReinvite?.includes('yes')
          ? 'yes'
          : null
    }

    return {
      isManualEntry: true,
      machineRoom: formData.machineRoom,
      views,
      isPartialMammography: formData.isPartialMammography?.includes('yes')
        ? 'yes'
        : null,
      partialMammographyReason,
      partialMammographyReasonSelect: formData.partialMammographyReasonSelect,
      partialMammographyReasonComment: formData.partialMammographyReasonComment,
      partialMammographyShouldReinvite,
      additionalDetails: formData.additionalDetails,
      metadata: {
        totalImages,
        standardViewsCompleted,
        hasRepeat,
        imagesByBreast
      }
    }
  }

  // Handle initial manual imaging form (standard vs custom)
  router.post(
    '/clinics/:clinicId/events/:eventId/images-manual-answer',
    (req, res) => {
      const { clinicId, eventId } = req.params
      const data = req.session.data
      const isStandardSet = data.event?.mammogramDataTemp?.isStandardSet

      if (!isStandardSet) {
        req.flash('error', {
          text: 'Select whether the imaging stage is complete',
          name: 'event[mammogramDataTemp][isStandardSet]'
        })
        return res.redirect(
          `/clinics/${clinicId}/events/${eventId}/images-manual`
        )
      }

      // If standard 4 images, preset the data
      if (isStandardSet === 'yes') {
        if (!data.event.mammogramDataTemp) {
          data.event.mammogramDataTemp = {}
        }

        // Preset standard views in temp
        data.event.mammogramDataTemp.viewsRightBreast = ['CC', 'MLO']
        data.event.mammogramDataTemp.viewsRightBreastCCCount = '1'
        data.event.mammogramDataTemp.viewsRightBreastMLOCount = '1'
        data.event.mammogramDataTemp.viewsLeftBreast = ['CC', 'MLO']
        data.event.mammogramDataTemp.viewsLeftBreastCCCount = '1'
        data.event.mammogramDataTemp.viewsLeftBreastMLOCount = '1'

        // Convert to final format
        const mammogramData = convertManualDataToMammogramFormat(
          data.event.mammogramDataTemp
        )
        data.event.mammogramData = mammogramData

        // Clear temp data
        delete data.event.mammogramDataTemp

        // Mark workflow as complete
        if (!data.event.workflowStatus) {
          data.event.workflowStatus = {}
        }
        data.event.workflowStatus['take-images'] = 'completed'

        // Redirect to check information
        return res.redirect(
          `/clinics/${clinicId}/events/${eventId}/check-information`
        )
      }

      // If custom details needed, go to details page
      if (isStandardSet === 'custom') {
        return res.redirect(
          `/clinics/${clinicId}/events/${eventId}/images-manual-details`
        )
      }

      // If there was a problem (no), redirect to attended-not-screened flow
      if (isStandardSet === 'no') {
        // TODO: Route to attended-not-screened flow
        return res.redirect(
          `/clinics/${clinicId}/events/${eventId}/attended-not-screened-reason`
        )
      }

      // Fallback - shouldn't reach here
      res.redirect(`/clinics/${clinicId}/events/${eventId}/images-manual`)
    }
  )

  // Handle manual imaging details form
  router.post(
    '/clinics/:clinicId/events/:eventId/images-manual-details-answer',
    (req, res) => {
      const { clinicId, eventId } = req.params
      const data = req.session.data
      const formData = data.event?.mammogramDataTemp || {}

      // Validate at least one view has a count > 0
      const viewTypes = ['CC', 'MLO', 'Eklund']
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
          name: 'event[mammogramDataTemp][viewsRightBreastCCCount]'
        })
        return res.redirect(
          `/clinics/${clinicId}/events/${eventId}/images-manual-details`
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
          `/clinics/${clinicId}/events/${eventId}/images-manual-repeats`
        )
      }

      // Convert to final format and save directly to mammogramData
      data.event.mammogramData = convertManualDataToMammogramFormat(formData)

      // Clear temp data
      delete data.event.mammogramDataTemp

      // Mark workflow as complete
      if (!data.event.workflowStatus) {
        data.event.workflowStatus = {}
      }
      data.event.workflowStatus['take-images'] = 'completed'

      // Redirect to check information
      res.redirect(`/clinics/${clinicId}/events/${eventId}/check-information`)
    }
  )

  // Handle repeat reasons form
  router.post(
    '/clinics/:clinicId/events/:eventId/images-manual-repeats-answer',
    (req, res) => {
      const { clinicId, eventId } = req.params
      const data = req.session.data

      // Clean up and normalize repeat reasons based on which option was selected
      const formData = data.event?.mammogramDataTemp || {}
      const viewCodes = [
        'RCC',
        'RMLO',
        'Right Eklund',
        'LCC',
        'LMLO',
        'Left Eklund'
      ]

      viewCodes.forEach((code) => {
        const repeatNeeded = formData[`repeatNeeded-${code}`]

        // Pick the correct set of repeatReasons based on which radio option was selected
        if (repeatNeeded === 'yes' || repeatNeeded === 'all-repeats') {
          // Use the 'all' checkbox values if they exist
          if (formData[`repeatReasonsAll-${code}`]) {
            formData[`repeatReasons-${code}`] =
              formData[`repeatReasonsAll-${code}`]
          }
          // Clean up temporary fields
          delete formData[`repeatReasonsAll-${code}`]
          delete formData[`repeatReasonsSome-${code}`]
        } else if (repeatNeeded === 'some-repeats') {
          // Use the 'some' checkbox values if they exist
          if (formData[`repeatReasonsSome-${code}`]) {
            formData[`repeatReasons-${code}`] =
              formData[`repeatReasonsSome-${code}`]
          }
          // Clean up temporary fields
          delete formData[`repeatReasonsAll-${code}`]
          delete formData[`repeatReasonsSome-${code}`]
        } else if (repeatNeeded === 'no') {
          // Clear all repeat-related data
          delete formData[`repeatReasons-${code}`]
          delete formData[`repeatReasonsAll-${code}`]
          delete formData[`repeatReasonsSome-${code}`]
          delete formData[`repeatCount-${code}`]
        }
      })

      // Convert form data (including repeat information) to final format and save
      data.event.mammogramData = convertManualDataToMammogramFormat(formData)

      // Clear temp data
      delete data.event.mammogramDataTemp

      // Mark workflow as complete
      if (!data.event.workflowStatus) {
        data.event.workflowStatus = {}
      }
      data.event.workflowStatus['take-images'] = 'completed'

      // Redirect to check information
      res.redirect(`/clinics/${clinicId}/events/${eventId}/check-information`)
    }
  )

  // End Manual imaging routes

  // Handle screening completion
  router.post(
    '/clinics/:clinicId/events/:eventId/attended-not-screened-answer',
    (req, res) => {
      const { clinicId, eventId } = req.params
      const data = req.session.data

      const participantName = getFullName(data.participant)
      const participantEventUrl = `/clinics/${clinicId}/events/${eventId}`

      const notScreenedReason = data.event.appointmentStopped.stoppedReason
      const needsReschedule = data.event.appointmentStopped.needsReschedule
      const otherDetails = data.event.appointmentStopped.otherDetails
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
            name: 'event[appointmentStopped][stoppedReason]',
            href: '#stoppedReason'
          })
        }
        if (hasOtherReasonButNoDetails) {
          req.flash('error', {
            text: 'Provide details about the other reason',
            name: 'event[appointmentStopped][otherDetails]',
            href: '#otherDetails'
          })
        }
        if (!needsReschedule) {
          req.flash('error', {
            text: 'Select whether the appointment should be rescheduled',
            name: 'event[appointmentStopped][needsReschedule]',
            href: '#needsReschedule'
          })
        }
        res.redirect(
          `/clinics/${clinicId}/events/${eventId}/attended-not-screened-reason`
        )
        return
      }

      // Capture session end time only if appointment was started
      const event = getEvent(data, eventId)
      if (event?.sessionDetails?.startedAt) {
        captureSessionEndTime(data, eventId, data.currentUser.id)
      }

      // If yes, redirect to reschedule page
      if (needsReschedule === 'yes') {
        // Save the appointmentStopped data before redirecting
        saveTempEventToEvent(data)
        saveTempParticipantToParticipant(data)
        updateEventStatus(data, eventId, 'event_attended_not_screened')

        res.redirect(
          `/clinics/${clinicId}/events/${eventId}/cancel-or-reschedule-appointment/reschedule`
        )
      } else {
        // Get participant info BEFORE saving (which clears temp data)

        saveTempEventToEvent(data)
        saveTempParticipantToParticipant(data)
        updateEventStatus(data, eventId, 'event_attended_not_screened')

        // Set success message based on choice
        let successMessage
        if (needsReschedule === 'no-invite') {
          successMessage = `
    ${participantName} will be invited to the next routine appointment. <a href="${participantEventUrl}" class="app-nowrap">View their appointment</a>`
        } else if (needsReschedule === 'no-opt-out') {
          successMessage = `
    An opt out request has been submitted for ${participantName}`
        }

        req.flash('success', { wrapWithHeading: successMessage })

        res.redirect(`/clinics/${clinicId}/`)
      }
    }
  )

  // Handle screening completion
  router.post('/clinics/:clinicId/events/:eventId/complete', (req, res) => {
    const { clinicId, eventId } = req.params

    const data = req.session.data
    const currentUser = data.currentUser
    const participantName = getFullName(data.participant)
    const participantEventUrl = `/clinics/${clinicId}/events/${eventId}`

    // Store session end details
    updateEventData(data, eventId, {
      sessionDetails: {
        ...getEvent(data, eventId).sessionDetails,
        endedAt: new Date().toISOString(),
        endedBy: currentUser.id
      }
    })

    saveTempEventToEvent(data)
    saveTempParticipantToParticipant(data)
    updateEventStatus(data, eventId, 'event_complete')

    const successMessage = `
    ${participantName} has been screened. <a href="${participantEventUrl}" class="app-nowrap">View their appointment</a>`

    req.flash('success', { wrapWithHeading: successMessage })

    res.redirect(`/clinics/${clinicId}`)

    // res.redirect(`/clinics/${clinicId}/events/${eventId}/screening-complete`)
  })

  // Handle special appointment form submission
  router.post(
    '/clinics/:clinicId/events/:eventId/special-appointment/edit-answer',
    (req, res) => {
      const { clinicId, eventId } = req.params
      const data = req.session.data
      const supportTypes = data.event?.specialAppointment?.supportTypes || []
      const temporaryReasons = data.event?.specialAppointment?.temporaryReasons

      // Validate that temporaryReasons was answered
      if (!temporaryReasons && supportTypes) {
        req.flash('error', {
          text: 'Select whether any of these reasons are temporary',
          name: 'event[specialAppointment][temporaryReasons]',
          href: '#temporaryReasons'
        })
        return res.redirect(
          `/clinics/${clinicId}/events/${eventId}/special-appointment/edit`
        )
      }

      // If user selected "yes", redirect to temporary reasons selection page
      if (temporaryReasons === 'yes' && supportTypes?.length > 0) {
        res.redirect(
          `/clinics/${clinicId}/events/${eventId}/special-appointment/temporary-reasons`
        )
      } else if (temporaryReasons === 'no' || supportTypes?.length === 0) {
        // If "no", redirect to confirm page to show what they selected
        delete data.event.specialAppointment.temporaryReasonsList
        res.redirect(
          `/clinics/${clinicId}/events/${eventId}/special-appointment/confirm`
        )
      } else {
        return res.redirect(
          `/clinics/${clinicId}/events/${eventId}/special-appointment/edit`
        )
      }
    }
  )

  // Handle temporary reasons selection form submission
  router.post(
    '/clinics/:clinicId/events/:eventId/special-appointment/temporary-reasons-answer',
    (req, res) => {
      const { clinicId, eventId } = req.params

      // After saving temporary reasons data, redirect to confirm page
      res.redirect(
        `/clinics/${clinicId}/events/${eventId}/special-appointment/confirm`
      )
    }
  )

  // Handle special appointment confirmation
  router.post(
    '/clinics/:clinicId/events/:eventId/special-appointment/confirm-answer',
    (req, res) => {
      const { clinicId, eventId } = req.params
      const data = req.session.data

      const supportTypes = data.event?.specialAppointment?.supportTypes
      const temporaryReasons = data.event?.specialAppointment?.temporaryReasons
      const temporaryReasonsList =
        data.event?.specialAppointment?.temporaryReasonsList

      if (temporaryReasons === 'no') {
        delete data.event.specialAppointment.temporaryReasonsList
      }

      // Save the data and redirect back to main event page
      saveTempEventToEvent(data)
      saveTempParticipantToParticipant(data)

      req.flash('success', 'Special appointment requirements confirmed')
      res.redirect(`/clinics/${clinicId}/events/${eventId}`)
    }
  )

  // Handle appointment note form submission
  router.post(
    '/clinics/:clinicId/events/:eventId/appointment-note-answer',
    (req, res) => {
      const { clinicId, eventId } = req.params
      const data = req.session.data

      // Save the appointment note from temp event to permanent event
      saveTempEventToEvent(data)

      req.flash('success', 'Appointment note saved')

      const returnUrl = getReturnUrl(
        `/clinics/${clinicId}/events/${eventId}`,
        req.query.referrerChain
      )
      res.redirect(returnUrl)
    }
  )

  // Delete appointment note
  router.get(
    '/clinics/:clinicId/events/:eventId/appointment-note/delete',
    (req, res) => {
      const { clinicId, eventId } = req.params
      const data = req.session.data

      // Delete the appointment note
      delete data.event.appointmentNote

      // Save changes
      saveTempEventToEvent(data)

      req.flash('success', 'Appointment note deleted')

      const returnUrl = getReturnUrl(
        `/clinics/${clinicId}/events/${eventId}/appointment-note`,
        req.query.referrerChain
      )
      res.redirect(returnUrl)
    }
  )
  // General purpose dynamic template route for events
  // This should come after any more specific routes
  router.get(
    '/clinics/:clinicId/events/:eventId/*subPaths',
    createDynamicTemplateRoute({
      templatePrefix: 'events'
    })
  )

  // Handle cancel or reschedule appointment form submission
  router.post(
    '/clinics/:clinicId/events/:eventId/cancel-or-reschedule-appointment/cancel-or-reschedule-appointment-answer',
    (req, res) => {
      const { clinicId, eventId } = req.params
      const data = req.session.data

      const participantName = getFullName(data.participant)
      const participantEventUrl = `/clinics/${clinicId}/events/${eventId}`

      const rescheduleChoice = data.event?.cancellation?.reschedule

      // Validate that a reschedule option was selected
      if (!rescheduleChoice) {
        req.flash('error', {
          text: 'Select whether the appointment should be rescheduled',
          name: 'event[cancellation][reschedule]',
          href: '#reschedule'
        })
        return res.redirect(
          `/clinics/${clinicId}/events/${eventId}/cancel-or-reschedule-appointment/details`
        )
      }

      // If yes, redirect to reschedule page
      if (rescheduleChoice === 'yes') {
        res.redirect(
          `/clinics/${clinicId}/events/${eventId}/cancel-or-reschedule-appointment/reschedule`
        )
      } else {
        // Capture session end time only if appointment was started
        const event = getEvent(data, eventId)
        if (event?.sessionDetails?.startedAt) {
          captureSessionEndTime(data, eventId, data.currentUser.id)
        }

        // Save the cancellation data
        saveTempEventToEvent(data)
        saveTempParticipantToParticipant(data)

        // Update event status to cancelled
        updateEventStatus(data, eventId, 'event_cancelled')

        // Set success message based on choice
        let successMessage
        if (rescheduleChoice === 'no-invite') {
          successMessage = `${participantName}'s appointment has been cancelled. <a href="${participantEventUrl}" class="app-nowrap">View their appointment</a>`
        } else if (rescheduleChoice === 'no-opt-out') {
          successMessage = `An opt out request has been submitted for ${participantName}. <a href="${participantEventUrl}" class="app-nowrap">View their appointment</a>`
        }

        req.flash('success', { wrapWithHeading: successMessage })

        // Return to clinic page
        res.redirect(`/clinics/${clinicId}`)
      }
    }
  )

  // Handle reschedule appointment form submission
  router.post(
    '/clinics/:clinicId/events/:eventId/cancel-or-reschedule-appointment/reschedule-answer',
    (req, res) => {
      const { clinicId, eventId } = req.params
      const data = req.session.data

      const participantName = getFullName(data.participant)
      const participantEventUrl = `/clinics/${clinicId}/events/${eventId}`

      const timing = data.event?.reschedule?.timing

      // Validate that timing was selected
      if (!timing) {
        req.flash('error', {
          text: 'Select when the appointment should be rescheduled',
          name: 'event[reschedule][timing]',
          href: '#timing'
        })
        return res.redirect(
          `/clinics/${clinicId}/events/${eventId}/cancel-or-reschedule-appointment/reschedule`
        )
      }

      // Capture session end time only if appointment was started (appointments might be rescheduled over the phone or that never started)
      const event = getEvent(data, eventId)
      if (event?.sessionDetails?.startedAt) {
        captureSessionEndTime(data, eventId, data.currentUser.id)
      }

      // Save the reschedule data
      saveTempEventToEvent(data)
      saveTempParticipantToParticipant(data)

      // Update event status to rescheduled
      updateEventStatus(data, eventId, 'event_rescheduled')

      const successMessage = `A reschedule request has been submitted for ${participantName}. <a href="${participantEventUrl}" class="app-nowrap">View their appointment</a>`

      req.flash('success', { wrapWithHeading: successMessage })

      // Return to clinic page
      res.redirect(`/clinics/${clinicId}`)
    }
  )

  // Handle undo cancel appointment
  router.get('/clinics/:clinicId/events/:eventId/undo-cancel', (req, res) => {
    const { clinicId, eventId } = req.params
    const data = req.session.data
    const event = getEvent(data, eventId)

    if (event && event.status === 'event_cancelled') {
      // Clear cancellation data
      delete data.event.cancellation
      delete data.event.reschedule

      // Save changes
      saveTempEventToEvent(data)

      // Revert to scheduled status
      updateEventStatus(data, eventId, 'event_scheduled')

      req.flash('success', 'Appointment cancellation undone')
    }

    // Use referrer system to return to originating page
    const returnUrl = getReturnUrl(
      `/clinics/${clinicId}/events/${eventId}/appointment`,
      req.query.referrerChain
    )
    res.redirect(returnUrl)
  })

  // Handle undo reschedule appointment
  router.get(
    '/clinics/:clinicId/events/:eventId/undo-reschedule',
    (req, res) => {
      const { clinicId, eventId } = req.params
      const data = req.session.data
      const event = getEvent(data, eventId)

      if (event && event.status === 'event_rescheduled') {
        // Clear reschedule and cancellation data
        delete data.event.cancellation
        delete data.event.reschedule

        // Save changes
        saveTempEventToEvent(data)

        // Revert to scheduled status
        updateEventStatus(data, eventId, 'event_scheduled')

        req.flash('success', 'Reschedule request undone')
      }

      // Use referrer system to return to originating page
      const returnUrl = getReturnUrl(
        `/clinics/${clinicId}/events/${eventId}/appointment`,
        req.query.referrerChain
      )
      res.redirect(returnUrl)
    }
  )

  // Handle undo check in
  router.get('/clinics/:clinicId/events/:eventId/undo-check-in', (req, res) => {
    const { clinicId, eventId } = req.params
    const data = req.session.data
    const event = getEvent(data, eventId)

    if (event && event.status === 'event_checked_in') {
      const participantName = getFullName(data.participant)

      // Save changes
      saveTempEventToEvent(data)

      // Revert to scheduled status
      updateEventStatus(data, eventId, 'event_scheduled')

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
      `/clinics/${clinicId}/events/${eventId}/appointment`,
      req.query.referrerChain
    )
    res.redirect(returnUrl)
  })
}
