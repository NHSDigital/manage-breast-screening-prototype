// app/routes/appointments/imaging-automatic.js
//
// Automatic imaging: simulated mammogram data, the imaging
// answer, the worklist-connection retry flow, the troubleshooting fallback to
// manual mode, and the take-images gate that routes between automatic and
// manual flows.

const dayjs = require('dayjs')
const {
  getFullName,
  getShortName
} = require('../../lib/utils/participants')
const {
  createIssue,
  getOpenIssuesFor
} = require('../../lib/utils/issues')
const {
  generateMammogramImages
} = require('../../lib/generators/mammogram-generator')
const {
  getAppointmentData
} = require('../../lib/utils/appointment-data')
const {
  getReturnUrl,
  urlWithReferrer
} = require('../../lib/utils/referrers')
const { getImageSetForAppointment } = require('../../lib/utils/mammogram-images')
const {
  ensureSeedProfilesState,
  getSeedDataProfileFromState
} = require('../../lib/generators/seed-profiles')

// Problems on the automatic images page that make the mammographer fall back
// to manual image mode, each raising an issue so the images are reconciled
// after the appointment. Keyed by the `issue` param images-manual expects.
const IMAGE_TROUBLESHOOTING_ISSUES = {
  'worklist-participant': {
    type: 'wrong_participant_images',
    description:
      'Switched to manual image mode: a different participant’s images were displayed'
  },
  'wrong-image-count': {
    type: 'other',
    description:
      'Switched to manual image mode: the wrong number of images were displayed'
  },
  'incorrect-image-labels': {
    type: 'transposed_images',
    description: 'Switched to manual image mode: images had incorrect labels'
  }
}

module.exports = (router) => {
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

  // Troubleshooting fallback from the automatic images page: raise an issue
  // for the problem, then continue in manual image mode. Arriving again for a
  // problem that already has an open issue on the episode raises nothing new.
  router.get(
    '/clinics/:clinicId/appointments/:appointmentId/images-troubleshooting-answer',
    (req, res) => {
      const { clinicId, appointmentId } = req.params
      const data = req.session.data
      const problem = req.query.issue
      const manualImagesUrl = `/clinics/${clinicId}/appointments/${appointmentId}/images-manual`

      const troubleshootingIssue = IMAGE_TROUBLESHOOTING_ISSUES[problem]
      if (!troubleshootingIssue) {
        return res.redirect(manualImagesUrl)
      }

      const manualImagesUrlWithProblem = `${manualImagesUrl}?issue=${problem}`
      // An open issue of the same type is the same problem, except for
      // "Something else", where only this problem's own description matches
      const alreadyRaised = getOpenIssuesFor(
        data,
        data.appointment.episodeId
      ).some(
        (issue) =>
          issue.type === troubleshootingIssue.type &&
          (issue.type !== 'other' ||
            issue.description === troubleshootingIssue.description)
      )

      if (!alreadyRaised) {
        const issue = createIssue(data, {
          type: troubleshootingIssue.type,
          description: troubleshootingIssue.description,
          raisedBy: data.currentUser?.id,
          raisedFrom: 'appointment',
          appointmentId
        })

        if (issue) {
          const issueUrl = urlWithReferrer(
            `/review/issues/${issue.id}`,
            manualImagesUrlWithProblem
          )
          req.flash('success', {
            html: `<p class="nhsuk-notification-banner__heading">Issue raised for ${getShortName(data.participant)}</p>
<p class="nhsuk-body"><a class="nhsuk-notification-banner__link" href="${issueUrl}">View issue</a></p>`
          })
        }
      }

      res.redirect(manualImagesUrlWithProblem)
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
      data.settings?.appointment?.addedToWorklist !== 'false' ||
      data.appointment?.isOnWorklist === true

    // Manual mode is true if the global setting says so, OR this specific
    // appointment was switched to manual (e.g. via the retry-connection page).
    const isManualImageCollection =
      data.settings?.appointment?.manualImageCollection === 'true' ||
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
}
