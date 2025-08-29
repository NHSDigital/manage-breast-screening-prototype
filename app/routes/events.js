// app/routes/events.js
const dayjs = require('dayjs')
const _ = require('lodash')

const {
  generateMammogramImages
} = require('../lib/generators/mammogram-generator')
const { createDynamicTemplateRoute } = require('../lib/utils/dynamic-routing')
const {
  getEvent,
  saveTempEventToEvent,
  updateEventStatus,
  updateEventData
} = require('../lib/utils/event-data')
const generateId = require('../lib/utils/id-generator')
const {
  getFullName,
  saveTempParticipantToParticipant
} = require('../lib/utils/participants')
const { getReturnUrl, urlWithReferrer } = require('../lib/utils/referrers')

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

  return {
    clinic,
    event,
    participant,
    unit
  }
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
    res.locals.clinic = originalEventData.clinic

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
    const defaultDestination = `/clinics/${req.params.clinicId}/events/${req.params.eventId}/identity`
    const finalDestination = returnTo
      ? `/clinics/${req.params.clinicId}/events/${req.params.eventId}/${returnTo}`
      : defaultDestination

    res.redirect(finalDestination)
  })

  // Leave appointment - revert status from in_progress back to checked_in
  router.get('/clinics/:clinicId/events/:eventId/leave', (req, res) => {
    const { clinicId, eventId } = req.params
    const data = req.session.data
    const event = getEvent(data, eventId)

    // Only allow leaving if the event is currently in progress
    if (event?.status === 'event_in_progress') {
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

  // Event within clinic context
  router.get('/clinics/:clinicId/events/:eventId', (req, res) => {
    const { clinicId, eventId } = req.params
    // res.render('events/show', {
    // })
    res.redirect(`/clinics/${clinicId}/events/${eventId}/appointment`)
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
      delete req.session.data?.event?.previousMammogramTemp
      res.render('events/previous-mammograms/edit')
    }
  )

  // Save data about a mammogram
  router.post(
    '/clinics/:clinicId/events/:eventId/previous-mammograms-answer',
    (req, res) => {
      const { clinicId, eventId } = req.params
      const data = req.session.data
      const previousMammogram = data.event?.previousMammogramTemp
      const action = req.body.action
      const referrerChain = req.query.referrerChain
      const scrollTo = req.query.scrollTo

      const mammogramAddedMessage = 'Previous mammogram added'

      // Check if this is coming from "proceed anyway" page
      if (action === 'proceed-anyway') {
        // Validate that a reason was provided
        if (!previousMammogram?.overrideReason) {
          // Set error in flash and redirect back to proceed-anyway page
          req.flash('error', {
            text: 'Enter a reason for proceeding with this appointment',
            name: 'event_previousMammogramTemp_overrideReason'
          })
          return res.redirect(
            `/clinics/${clinicId}/events/${eventId}/previous-mammograms/proceed-anyway`
          )
        }

        // Save the mammogram with override flag and reason
        if (!data.event.previousMammograms) {
          data.event.previousMammograms = []
        }

        data.event.previousMammograms.push({
          ...previousMammogram,
          warningOverridden: true
        })

        req.flash('success', mammogramAddedMessage)

        delete data.event?.previousMammogramTemp
        // return res.redirect(`/clinics/${clinicId}/events/${eventId}`)

        const returnUrl = getReturnUrl(
          `/clinics/${clinicId}/events/${eventId}`,
          referrerChain,
          scrollTo
        )

        res.redirect(returnUrl)
      }

      // Handle the direct cancel action from appointment-should-not-proceed.html
      if (action === 'end-immediately') {
        // Set stopping reason for the appointment
        if (!data.event.appointmentStopped) {
          data.event.appointmentStopped = {}
        }
        data.event.appointmentStopped.stoppedReason = 'recent_mammogram'
        data.event.appointmentStopped.needsReschedule = 'no' // Default to no reschedule needed

        // Add the mammogram to history
        if (!data.event.previousMammograms) {
          data.event.previousMammograms = []
        }
        data.event.previousMammograms.push(previousMammogram)
        delete data.event?.previousMammogramTemp

        // Save changes and update status
        saveTempEventToEvent(data)
        saveTempParticipantToParticipant(data)
        updateEventStatus(data, eventId, 'event_attended_not_screened')

        // Get participant info for message
        const participantName = getFullName(data.participant)
        const participantEventUrl = `/clinics/${clinicId}/events/${eventId}`

        // Flash success message
        const successMessage = `
      ${participantName} has been 'attended not screened'. <a href="${participantEventUrl}" class="app-nowrap">View their appointment</a>`
        req.flash('success', { wrapWithHeading: successMessage })

        // Return to clinic list
        return res.redirect(`/clinics/${clinicId}/`)
      }

      // Check if this is a recent mammogram (within 6 months)
      const isRecentMammogram = checkIfRecentMammogram(previousMammogram)

      // If recent mammogram detected and not already coming from warning page
      if (isRecentMammogram && action !== 'continue') {
        return res.redirect(
          urlWithReferrer(
            `/clinics/${clinicId}/events/${eventId}/previous-mammograms/appointment-should-not-proceed`,
            referrerChain,
            scrollTo
          )
        )
      }

      // Normal flow - save the mammogram
      if (previousMammogram) {
        if (!data.event.previousMammograms) {
          data.event.previousMammograms = []
        }
        data.event.previousMammograms.push(previousMammogram)
      }

      delete data.event?.previousMammogramTemp

      // If user clicked "continue" on warning page, start the appointment cancellation flow
      if (action === 'continue') {
        // Set stopping reason for the appointment
        if (!data.event.appointmentStopped) {
          data.event.appointmentStopped = {}
        }
        data.event.appointmentStopped.stoppedReason = 'recent_mammogram'
        data.event.appointmentStopped.needsReschedule = 'no' // Default to no reschedule needed

        return res.redirect(
          `/clinics/${clinicId}/events/${eventId}/attended-not-screened-reason`
        )
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

  // Helper function to check if mammogram was taken within the last 6 months
  function checkIfRecentMammogram(mammogram) {
    if (!mammogram) return false

    const now = dayjs()
    const sixMonthsAgo = now.subtract(6, 'month')

    // Check based on date type
    if (mammogram.dateType === 'dateKnown' && mammogram.dateTaken) {
      const date = mammogram.dateTaken
      if (date.year && date.month && date.day) {
        const mammogramDate = dayjs(
          `${date.year}-${String(date.month).padStart(2, '0')}-${String(date.day).padStart(2, '0')}`
        )
        return mammogramDate.isAfter(sixMonthsAgo)
      }
    } else if (
      mammogram.dateType === 'approximateDate' &&
      mammogram.approximateDate
    ) {
      // Try to parse approximate date text
      const approxText = mammogram.approximateDate.toLowerCase()

      // Check for common time patterns that would indicate recent mammogram
      if (
        approxText.includes('month ago') ||
        approxText.includes('1 month') ||
        approxText.includes('2 month') ||
        approxText.includes('3 month') ||
        approxText.includes('4 month') ||
        approxText.includes('5 month') ||
        approxText.includes('last month') ||
        approxText.includes('weeks ago') ||
        approxText.includes('few weeks') ||
        approxText.includes('last week') ||
        approxText.includes('days ago')
      ) {
        return true
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
      const action = req.body.action || req.query.action // 'save' or 'save-and-add'
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

        symptom.hasStopped = symptomTemp?.hasStopped?.includes('yes')
          ? true
          : false

        if (symptom.hasStopped) {
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
          `/clinics/${clinicId}/events/${eventId}/record-medical-information`,
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
        `/clinics/${clinicId}/events/${eventId}/record-medical-information`,
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
        // Map camelCase symptom types to display names
        const symptomTypeMap = {
          lump: 'Lump',
          swellingOrShapeChange: 'Swelling or shape change',
          skinChange: 'Skin change',
          nippleChange: 'Nipple change',
          other: 'Other'
        }

        const fullSymptomType = symptomTypeMap[symptomType]

        if (fullSymptomType) {
          // Pre-populate symptomTemp with the selected type
          data.event.symptomTemp = {
            type: fullSymptomType
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

  // Specific route for imaging view
  router.get('/clinics/:clinicId/events/:eventId/images', (req, res) => {
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
      data.event.mammogramData = mammogramData
      res.locals.event = data.event
    }

    res.render('events/images', {})
  })

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
          `/clinics/${clinicId}/events/${eventId}/record-medical-information`
        )
      } else {
        res.redirect(`/clinics/${clinicId}/events/${eventId}/awaiting-images`)
      }
    }
  )

  // Handle record medical information answer
  router.post(
    '/clinics/:clinicId/events/:eventId/record-medical-information-answer',
    (req, res) => {
      const { clinicId, eventId } = req.params
      const data = req.session.data
      const imagingCanProceed = data?.event?.appointment?.imagingCanProceed

      if (!imagingCanProceed) {
        res.redirect(
          `/clinics/${clinicId}/events/${eventId}/record-medical-information`
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
      const isPartialMammography = data.event.mammogramData.isPartialMammography

      if (!isPartialMammography) {
        res.redirect(`/clinics/${clinicId}/events/${eventId}/imaging`)
      } else {
        data.event.workflowStatus.images = 'completed'
        res.redirect(`/clinics/${clinicId}/events/${eventId}/review`)
      }
    }
  )

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
      const otherReasonDetails = data.event.appointmentStopped.otherDetails
      const hasOtherReasonButNoDetails =
        notScreenedReason?.includes('other') && !otherReasonDetails

      if (
        !notScreenedReason ||
        !needsReschedule ||
        hasOtherReasonButNoDetails
      ) {
        if (!notScreenedReason) {
          req.flash('error', {
            text: 'A reason for why this appointment cannot continue must be provided',
            name: 'event[appointmentStopped][stoppedReason]',
            href: '#stoppedReason'
          })
        }
        if (hasOtherReasonButNoDetails) {
          req.flash('error', {
            text: 'Explain why this appointment cannot proceed',
            name: 'event[appointmentStopped][otherDetails]',
            href: '#otherDetails'
          })
        }
        if (!needsReschedule) {
          req.flash('error', {
            text: 'Select whether the participant needs to be invited for another appointment',
            name: 'event[appointmentStopped][needsReschedule]',
            href: '#needsReschedule'
          })
        }
        res.redirect(
          `/clinics/${clinicId}/events/${eventId}/attended-not-screened-reason`
        )
        return
      }

      saveTempEventToEvent(data)
      saveTempParticipantToParticipant(data)
      updateEventStatus(data, eventId, 'event_attended_not_screened')

      const successMessage = `
    ${participantName} has been 'attended not screened'. <a href="${participantEventUrl}" class="app-nowrap">View their appointment</a>`
      req.flash('success', { wrapWithHeading: successMessage })

      res.redirect(`/clinics/${clinicId}/`)
    }
  )

  // Handle screening completion
  router.post('/clinics/:clinicId/events/:eventId/complete', (req, res) => {
    const { clinicId, eventId } = req.params

    const data = req.session.data
    const participantName = getFullName(data.participant)
    const participantEventUrl = `/clinics/${clinicId}/events/${eventId}`

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

      console.log('Support types:', supportTypes)

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

      const temporaryReasons = data.event?.specialAppointment?.temporaryReasons

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

  // General purpose dynamic template route for events
  // This should come after any more specific routes
  router.get(
    '/clinics/:clinicId/events/:eventId/*subPaths',
    createDynamicTemplateRoute({
      templatePrefix: 'events'
    })
  )
}
