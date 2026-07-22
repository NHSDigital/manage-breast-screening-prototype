// app/routes/appointments/medical-information.js
//
// Medical information beyond the CRUD sections: recording breast
// features, and the has-relevant-information / review answers.

const {
  getReturnUrl,
  modalBreakout
} = require('../../lib/utils/referrers')
const { getAppointmentData } = require('../../lib/utils/appointment-data')

module.exports = (router) => {
  // Auto-save breast density factors when checkboxes are changed
  router.post(
    '/clinics/:clinicId/appointments/:appointmentId/medical-information/breast-density-factors-save',
    (req, res) => {
      const data = req.session.data
      const postedFactors = req.body?.appointment?.medicalInformation?.breastDensityFactors

      // No posted factors means all options are currently unchecked
      const factors = Array.isArray(postedFactors)
        ? postedFactors
        : postedFactors
          ? [postedFactors]
          : []

      if (!data.appointment) {
        data.appointment = {}
      }

      if (!data.appointment.medicalInformation) {
        data.appointment.medicalInformation = {}
      }

      data.appointment.medicalInformation.breastDensityFactors = factors

      // Keep a draft cache outside auto-stored form keys so later form posts
      // cannot accidentally clear the latest autosaved checkbox state.
      if (!data._medicalInformationDraft) {
        data._medicalInformationDraft = {}
      }
      data._medicalInformationDraft.breastDensityFactors = factors

      res.status(204).send()
    }
  )

  // Save other medical information while preserving breast density factors
  router.post(
    '/clinics/:clinicId/appointments/:appointmentId/medical-information/other-medical-information-save',
    (req, res) => {
      const { clinicId, appointmentId } = req.params
      const data = req.session.data
      const referrerChain = req.query.referrerChain
      const scrollTo = req.query.scrollTo

      const appointmentMedicalInformation = data?.appointment?.medicalInformation
      const postedBreastDensityFactors =
        appointmentMedicalInformation?.breastDensityFactors
      const cachedBreastDensityFactors =
        data?._medicalInformationDraft?.breastDensityFactors

      const normalisedPostedBreastDensityFactors =
        Array.isArray(postedBreastDensityFactors)
          ? postedBreastDensityFactors
          : postedBreastDensityFactors
            ? [postedBreastDensityFactors]
            : undefined

      if (normalisedPostedBreastDensityFactors) {
        if (!data._medicalInformationDraft) {
          data._medicalInformationDraft = {}
        }
        data._medicalInformationDraft.breastDensityFactors =
          normalisedPostedBreastDensityFactors
      }

      // If this submission did not include factors, keep the last saved values
      if (!normalisedPostedBreastDensityFactors)
      {
        const savedAppointmentData = getAppointmentData(data, clinicId, appointmentId)
        const savedBreastDensityFactors =
          savedAppointmentData?.appointment?.medicalInformation?.breastDensityFactors

        if (cachedBreastDensityFactors)
        {
          data.appointment.medicalInformation.breastDensityFactors =
            cachedBreastDensityFactors
        }
        else if (savedBreastDensityFactors)
        {
          data.appointment.medicalInformation.breastDensityFactors =
            savedBreastDensityFactors
        }
      }

      const returnUrl = getReturnUrl(
        `/clinics/${clinicId}/appointments/${appointmentId}/review-medical-information`,
        referrerChain,
        scrollTo
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
