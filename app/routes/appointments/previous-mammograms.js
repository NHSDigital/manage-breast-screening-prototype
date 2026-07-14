// app/routes/appointments/previous-mammograms.js
//
// Previous mammograms: add, save, edit and delete.

const dayjs = require('dayjs')
const {
  getFullName,
  saveTempParticipantToParticipant
} = require('../../lib/utils/participants')
const {
  saveTempAppointmentToAppointment,
  updateAppointmentStatus
} = require('../../lib/utils/appointment-data')
const generateId = require('../../lib/utils/id-generator')
const {
  getReturnUrl,
  urlWithReferrer,
  modalBreakout
} = require('../../lib/utils/referrers')

module.exports = (router) => {
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
        updateAppointmentStatus(data, appointmentId, 'attended_not_screened')

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
          updateAppointmentStatus(data, appointmentId, 'attended_not_screened')

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
}
