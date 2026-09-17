// app/routes/appointments/symptoms.js
//
// Symptoms: add, save, edit and delete.

const generateId = require('../../lib/utils/id-generator')
const {
  getReturnUrl,
  urlWithReferrer,
  modalBreakout
} = require('../../lib/utils/referrers')
const { sentenceCase } = require('../../lib/utils/strings')
const symptomTypes = require('../../data/symptom-types')

module.exports = (router) => {
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

        // For new symptoms, record when and who added them
        if (isNewSymptom) {
          symptom.dateAdded = new Date().toISOString()
          symptom.addedByUserId = data.currentUser?.id
        } else {
          symptom.addedByUserId = symptomTemp.addedByUserId
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

        // Sign noted by the mammographer rather than reported by the participant
        const observedValue = symptomTemp.isMammographerObserved
        symptom.isMammographerObserved = Array.isArray(observedValue)
          ? observedValue.includes('yes')
          : observedValue === 'yes' || observedValue === true

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
}
