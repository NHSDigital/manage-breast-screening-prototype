// app/routes/appointments/medical-information.js
//
// Medical information beyond the CRUD sections: recording breast
// features, and the has-relevant-information / review answers.

const {
  getReturnUrl,
  modalBreakout
} = require('../../lib/utils/referrers')

module.exports = (router) => {
  // Auto-save the HRT answer as it's changed
  //
  // HRT is edited in place on the review page rather than on a sub-page with
  // its own submit, so there's no form post to carry it. The fields are named
  // against the appointment, so auto-store-data has already written them to
  // the temp appointment by the time this runs - the route exists only to give
  // the fetch something to post to that doesn't render a whole page. Without
  // JavaScript the surrounding form's submit saves the same fields the same way.
  router.post(
    '/clinics/:clinicId/appointments/:appointmentId/medical-information/hrt-save',
    (req, res) => {
      res.status(204).send()
    }
  )

  // Delete pregnancy and breastfeeding
  router.get(
    '/clinics/:clinicId/appointments/:appointmentId/medical-information/pregnancy-and-breastfeeding/delete',
    (req, res) => {
      const { clinicId, appointmentId } = req.params
      const data = req.session.data

      if (data.appointment?.medicalInformation) {
        delete data.appointment.medicalInformation.pregnancyAndBreastfeeding
      }

      req.flash('success', 'Pregnancy and breastfeeding deleted')

      const returnUrl = getReturnUrl(
        `/clinics/${clinicId}/appointments/${appointmentId}/review-medical-information`,
        req.query.referrerChain,
        req.query.scrollTo
      )

      res.redirect(modalBreakout(returnUrl))
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
