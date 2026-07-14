// app/routes/appointments/medical-information.js
//
// Medical information beyond the CRUD sections: recording breast
// features, and the has-relevant-information / review answers.

const {
  getReturnUrl,
  modalBreakout
} = require('../../lib/utils/referrers')

module.exports = (router) => {
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

  const medicalHistoryTypes = require('../../data/medical-history-types')

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
}
