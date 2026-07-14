// app/routes/appointments/imaging-manual.js
//
// Manual imaging: entering image details and repeats by hand.

const { getImageSetForAppointment } = require('../../lib/utils/mammogram-images')

module.exports = (router) => {
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
}
