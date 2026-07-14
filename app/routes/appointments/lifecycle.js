// app/routes/appointments/lifecycle.js
//
// The appointment lifecycle: starting, resuming, pausing and
// exiting an appointment, checking in (and undoing check-in), attended-not-
// screened, and completion. Status changes here also move the appointment's
// episode along (see updateAppointmentStatus).

const {
  getFullName,
  saveTempParticipantToParticipant
} = require('../../lib/utils/participants')
const {
  getAppointment,
  saveTempAppointmentToAppointment,
  updateAppointmentData
} = require('../../lib/utils/appointment-data')
const { updateAppointmentStatus } = require('../../lib/utils/appointment-status')
const {
  getReturnUrl,
  urlWithReferrer,
  modalBreakout
} = require('../../lib/utils/referrers')
const { captureSessionEndTime } = require('./shared')

module.exports = (router) => {
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
      appointment?.status === 'scheduled' ||
      appointment?.status === 'checked_in'
    ) {
      // Update status to in progress
      updateAppointmentStatus(data, req.params.appointmentId, 'in_progress')

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

    if (appointment?.status === 'paused') {
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
      updateAppointmentStatus(data, req.params.appointmentId, 'in_progress')

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
        updateAppointmentStatus(data, appointmentId, 'paused')
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
      if (appointment?.status === 'in_progress') {
        if (exitAction === 'discard') {
          // Discard changes - reset workflow and revert to checked in
          delete data.appointment.workflowStatus

          // Revert status back to checked in
          updateAppointmentStatus(data, appointmentId, 'checked_in')

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
          updateAppointmentStatus(data, appointmentId, 'paused')
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
        if (appointment?.status !== 'checked_in') {
          updateAppointmentStatus(data, appointmentId, 'checked_in')
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
        updateAppointmentStatus(data, appointmentId, 'attended_not_screened')

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
      isIncompleteMammography ? 'partially_screened' : 'complete'
    )

    const successMessage = `
    ${participantName} has been screened. <a href="${participantAppointmentUrl}" class="app-nowrap">View their appointment</a>`

    req.flash('success', { wrapWithHeading: successMessage })

    res.redirect(`/clinics/${clinicId}`)

    // res.redirect(`/clinics/${clinicId}/appointments/${appointmentId}/screening-complete`)
  })

  // Handle undo check in
  router.get('/clinics/:clinicId/appointments/:appointmentId/undo-check-in', (req, res) => {
    const { clinicId, appointmentId } = req.params
    const data = req.session.data
    const appointment = getAppointment(data, appointmentId)

    if (appointment && appointment.status === 'checked_in') {
      const participantName = getFullName(data.participant)

      // Save changes
      saveTempAppointmentToAppointment(data)

      // Revert to scheduled status
      updateAppointmentStatus(data, appointmentId, 'scheduled')

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
