// app/routes/appointments/medical-history.js
//
// Medical history: add, save, edit and delete per type, implants
// consent, and the appointment-cannot-proceed answer.

const {
  getFullName,
  saveTempParticipantToParticipant
} = require('../../lib/utils/participants')
const {
  getAppointment,
  saveTempAppointmentToAppointment
} = require('../../lib/utils/appointment-data')
const {
  updateAppointmentStatus
} = require('../../lib/utils/appointment-status')
const {
  getBreastCancerMissingSides,
  getBreastImplantsMissingSides,
  breastImplantsFormToItem,
  breastImplantsItemToForm,
  getMastectomyLumpectomyMissingSides,
  getBenignLumpsMissingSides,
  benignLumpsFormToItem,
  benignLumpsItemToForm,
  breastCancerFormToItem,
  breastCancerItemToForm,
  mastectomyLumpectomyFormToItem,
  mastectomyLumpectomyItemToForm
} = require('../../lib/utils/sided-medical-history')
const {
  isValidMedicalHistoryType,
  getMedicalHistoryType,
  getMedicalHistoryKeyFromSlug
} = require('../../lib/utils/medical-information')
const generateId = require('../../lib/utils/id-generator')
const {
  getReturnUrl,
  urlWithReferrer,
  modalBreakout
} = require('../../lib/utils/referrers')
const {
  OTHER_REASON,
  BILATERAL_MASTECTOMY,
  PERMANENT_EXCLUSION,
  isBilateralMastectomyWithoutImages,
  getBilateralMastectomySuccessMessage
} = require('../../lib/utils/mastectomy')
const { captureSessionEndTime } = require('./shared')

// Types whose form answers are stored in a different shape from how they are asked
const FORM_CONVERTERS = {
  breastCancer: {
    getMissingSides: getBreastCancerMissingSides,
    toItem: breastCancerFormToItem,
    toForm: breastCancerItemToForm
  },
  benignLumps: {
    getMissingSides: getBenignLumpsMissingSides,
    toItem: benignLumpsFormToItem,
    toForm: benignLumpsItemToForm
  },
  breastImplantsAugmentation: {
    getMissingSides: getBreastImplantsMissingSides,
    toItem: breastImplantsFormToItem,
    toForm: breastImplantsItemToForm
  },
  mastectomyLumpectomy: {
    getMissingSides: getMastectomyLumpectomyMissingSides,
    toItem: mastectomyLumpectomyFormToItem,
    toForm: mastectomyLumpectomyItemToForm
  }
}

// Editing mastectomy or lumpectomy skips the reason question, which is asked first when adding
const getFormPage = (dataKey, type) =>
  dataKey === 'mastectomyLumpectomy' ? `${type}-details` : type

module.exports = (router) => {
  // Select medical history type - choose which type to add
  router.post(
    '/clinics/:clinicId/appointments/:appointmentId/medical-information/medical-history/select',
    (req, res) => {
      const { clinicId, appointmentId } = req.params
      const data = req.session.data
      const typeSlug = data.medicalHistoryTypeSlug
      const referrerChain = req.query.referrerChain
      const scrollTo = req.query.scrollTo

      // Validate type
      if (!typeSlug || !isValidMedicalHistoryType(typeSlug)) {
        return res.redirect(
          urlWithReferrer(
            `/clinics/${clinicId}/appointments/${appointmentId}/medical-information/medical-history/type`,
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
          `/clinics/${clinicId}/appointments/${appointmentId}/medical-information/medical-history/${typeSlug}/add`,
          referrerChain,
          scrollTo
        )
      )
    }
  )

  // Add new medical history item - clear temp data and redirect to form
  router.get(
    '/clinics/:clinicId/appointments/:appointmentId/medical-information/medical-history/:type/add',
    (req, res) => {
      const { clinicId, appointmentId, type } = req.params

      // Validate type
      if (!isValidMedicalHistoryType(type)) {
        return res.redirect(
          `/clinics/${clinicId}/appointments/${appointmentId}/review-medical-information`
        )
      }

      // Clear any existing temp medical history data
      delete req.session.data.appointment?.medicalHistoryTemp

      // Redirect to the form (assumes template exists at medical-information/medical-history/[type])
      res.redirect(
        urlWithReferrer(
          `/clinics/${clinicId}/appointments/${appointmentId}/medical-information/medical-history/${type}`,
          req.query.referrerChain,
          req.query.scrollTo
        )
      )
    }
  )

  // Mastectomy or lumpectomy: breast cancer has its own form, any other reason
  // goes on to the procedure questions
  router.post(
    '/clinics/:clinicId/appointments/:appointmentId/medical-information/medical-history/mastectomy-lumpectomy-reason-answer',
    (req, res) => {
      const { clinicId, appointmentId } = req.params
      const reason =
        req.session.data.appointment?.medicalHistoryTemp
          ?.mastectomyLumpectomySurgeryReason
      const historyUrl = `/clinics/${clinicId}/appointments/${appointmentId}/medical-information/medical-history`

      if (!reason) {
        req.flash('error', {
          text: 'Select why this surgery was done',
          name: 'appointment[medicalHistoryTemp][mastectomyLumpectomySurgeryReason]',
          href: '#mastectomyLumpectomySurgeryReason'
        })
        return res.redirect(
          urlWithReferrer(
            `${historyUrl}/mastectomy-lumpectomy`,
            req.query.referrerChain,
            req.query.scrollTo
          )
        )
      }

      const nextPage =
        reason === 'Breast cancer'
          ? 'breast-cancer/add'
          : 'mastectomy-lumpectomy-details'

      res.redirect(
        urlWithReferrer(
          `${historyUrl}/${nextPage}`,
          req.query.referrerChain,
          req.query.scrollTo
        )
      )
    }
  )

  // Save medical history item - handles both 'save' and 'save and add another'
  router.post(
    '/clinics/:clinicId/appointments/:appointmentId/medical-information/medical-history/:type/save',
    (req, res) => {
      const { clinicId, appointmentId, type } = req.params
      const data = req.session.data
      const action = req.body.action || 'save'
      const referrerChain = req.query.referrerChain
      const scrollTo = req.query.scrollTo

      // Validate type
      if (!isValidMedicalHistoryType(type)) {
        return res.redirect(
          `/clinics/${clinicId}/appointments/${appointmentId}/review-medical-information`
        )
      }

      const typeConfig = getMedicalHistoryType(type)
      // Convert slug to camelCase key for data storage
      const dataKey = getMedicalHistoryKeyFromSlug(type) || type

      const missingSides = FORM_CONVERTERS[dataKey]
        ? FORM_CONVERTERS[dataKey].getMissingSides(
            data.appointment?.medicalHistoryTemp
          )
        : []

      if (missingSides.length) {
        missingSides.forEach(({ sideField, text }) =>
          req.flash('error', {
            text,
            name: `appointment[medicalHistoryTemp][${sideField}]`,
            href: `#${sideField}`
          })
        )
        return res.redirect(
          urlWithReferrer(
            `/clinics/${clinicId}/appointments/${appointmentId}/medical-information/medical-history/${getFormPage(dataKey, type)}`,
            referrerChain,
            scrollTo
          )
        )
      }

      // A mastectomy needs a follow-up on which breasts will be imaged,
      // asked again only if the mastectomy side changes
      const formTemp = data.appointment?.medicalHistoryTemp
      let endWithoutImages = false
      if (formTemp && FORM_CONVERTERS[dataKey]) {
        const mastectomySide = []
          .concat(formTemp.procedures || [])
          .includes('Mastectomy')
          ? formTemp.mastectomySide
          : undefined
        const hasMastectomy = ['Right', 'Left', 'Both'].includes(mastectomySide)
        const medicalHistoryItem = FORM_CONVERTERS[dataKey].toItem(formTemp)
        endWithoutImages =
          hasMastectomy &&
          isBilateralMastectomyWithoutImages(medicalHistoryItem)

        if (hasMastectomy && formTemp.mastectomyImagingFor !== mastectomySide) {
          return res.redirect(
            urlWithReferrer(
              `/clinics/${clinicId}/appointments/${appointmentId}/medical-information/medical-history/mastectomy-imaging`,
              referrerChain,
              scrollTo
            )
          )
        }

        const remainingImagingSide =
          mastectomySide === 'Right' ? 'Left' : 'Right'
        const allowedImagingSides =
          mastectomySide === 'Both'
            ? ['None', 'Right', 'Left', 'Both']
            : [remainingImagingSide, 'Both']

        if (
          hasMastectomy &&
          !allowedImagingSides.includes(formTemp.mastectomyImagingSide)
        ) {
          req.flash('error', {
            text: 'Select whether any images need to be taken',
            name: 'appointment[medicalHistoryTemp][mastectomyImagingSide]',
            href: '#mastectomyImagingSide'
          })
          return res.redirect(
            urlWithReferrer(
              `/clinics/${clinicId}/appointments/${appointmentId}/medical-information/medical-history/mastectomy-imaging`,
              referrerChain,
              scrollTo
            )
          )
        }

        if (mastectomySide === 'Both') {
          const selectedDetails =
            formTemp.mastectomyImagingDetailsTemp?.[
              formTemp.mastectomyImagingSide
            ]
          if (selectedDetails) {
            formTemp.mastectomyImagingDetails = selectedDetails
          } else {
            delete formTemp.mastectomyImagingDetails
          }
          delete formTemp.mastectomyImagingDetailsTemp
        } else if (formTemp.mastectomyImagingSide !== 'Both') {
          delete formTemp.mastectomyImagingDetails
        }

        if (!hasMastectomy) {
          delete formTemp.mastectomyImagingFor
          delete formTemp.mastectomyImagingSide
          delete formTemp.mastectomyImagingDetails
        }
      }

      // Check if consent is needed for breast implants BEFORE processing the data
      if (
        type === 'breast-implants-augmentation' ||
        type === 'breastImplantsAugmentation'
      ) {
        const medicalHistoryTemp = data.appointment?.medicalHistoryTemp
          ? breastImplantsFormToItem(data.appointment.medicalHistoryTemp)
          : undefined
        const rightBreastProcedures =
          medicalHistoryTemp?.proceduresRightBreast || []
        const leftBreastProcedures =
          medicalHistoryTemp?.proceduresLeftBreast || []

        // Check if breast implants were selected in either breast
        const hasBreastImplants =
          rightBreastProcedures.includes('Breast implants') ||
          leftBreastProcedures.includes('Breast implants')

        // Check if implants have been removed
        const implantsRemoved =
          Array.isArray(medicalHistoryTemp?.implantsRemoved) &&
          medicalHistoryTemp.implantsRemoved.includes(
            'Implants have been removed'
          )

        // Check if consent was already given (editing existing item)
        const alreadyConsented = medicalHistoryTemp?.consentGiven

        // Only show consent page if:
        // - Breast implants are selected
        // - AND implants have NOT been removed
        // - AND consent has NOT already been given
        if (hasBreastImplants && !implantsRemoved && !alreadyConsented) {
          // The consent page and its answer routes read the stored per-breast fields
          data.appointment.medicalHistoryTemp = medicalHistoryTemp

          // Redirect to consent page immediately - we'll save the data after consent
          return res.redirect(
            urlWithReferrer(
              `/clinics/${clinicId}/appointments/${appointmentId}/medical-information/medical-history/consent`,
              referrerChain,
              scrollTo
            )
          )
        }
      }

      let isNewItem

      // Save temp medical history to array
      if (data.appointment?.medicalHistoryTemp) {
        // Initialize medicalInformation object if needed
        if (!data.appointment.medicalInformation) {
          data.appointment.medicalInformation = {}
        }

        // Initialize medicalHistory object if needed
        if (!data.appointment.medicalInformation.medicalHistory) {
          data.appointment.medicalInformation.medicalHistory = {}
        }

        // Initialize array for this type if needed
        if (!data.appointment.medicalInformation.medicalHistory[dataKey]) {
          data.appointment.medicalInformation.medicalHistory[dataKey] = []
        }

        const medicalHistoryTemp = FORM_CONVERTERS[dataKey]
          ? FORM_CONVERTERS[dataKey].toItem(data.appointment.medicalHistoryTemp)
          : data.appointment.medicalHistoryTemp
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
        const existingIndex =
          data.appointment.medicalInformation.medicalHistory[dataKey].findIndex(
            (item) => item.id === medicalHistoryItem.id
          )
        if (existingIndex !== -1) {
          data.appointment.medicalInformation.medicalHistory[dataKey][
            existingIndex
          ] = medicalHistoryItem
        } else {
          data.appointment.medicalInformation.medicalHistory[dataKey].push(
            medicalHistoryItem
          )
        }

        // Clear temp data
        delete data.appointment.medicalHistoryTemp
      }

      if (endWithoutImages) {
        saveTempAppointmentToAppointment(data)
        return res.redirect(
          urlWithReferrer(
            `/clinics/${clinicId}/appointments/${appointmentId}/medical-information/medical-history/bilateral-mastectomy-cannot-proceed`,
            referrerChain,
            scrollTo
          )
        )
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
        delete data.appointment.medicalHistoryTemp

        // Redirect directly to the form instead of going through the add route
        res.redirect(
          urlWithReferrer(
            `/clinics/${clinicId}/appointments/${appointmentId}/medical-information/medical-history/${type}`,
            referrerChain,
            scrollTo
          )
        )
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

  router.post(
    '/clinics/:clinicId/appointments/:appointmentId/medical-information/medical-history/bilateral-mastectomy-cannot-proceed-answer',
    (req, res) => {
      const { clinicId, appointmentId } = req.params
      const data = req.session.data
      const participantName = getFullName(data.participant)

      const medicalHistory =
        data.appointment?.medicalInformation?.medicalHistory || {}
      const hasBilateralMastectomyWithoutImages = [
        'breastCancer',
        'mastectomyLumpectomy'
      ].some((type) =>
        (medicalHistory[type] || []).some(isBilateralMastectomyWithoutImages)
      )

      if (
        data.appointment?.status !== 'in_progress' ||
        !hasBilateralMastectomyWithoutImages
      ) {
        req.flash('error', {
          text: 'Confirm that no images are needed after a bilateral mastectomy before ending this appointment'
        })
        return res.redirect(modalBreakout(`/clinics/${clinicId}/`))
      }

      if (data.appointment?.sessionDetails?.startedAt) {
        captureSessionEndTime(data, appointmentId, data.currentUser.id)
      }

      data.appointment.appointmentStopped = {
        stoppedReason: [OTHER_REASON],
        otherDetails: BILATERAL_MASTECTOMY,
        needsReschedule: PERMANENT_EXCLUSION
      }

      const participantAppointmentUrl = `/clinics/${clinicId}/appointments/${appointmentId}`
      saveTempAppointmentToAppointment(data)
      saveTempParticipantToParticipant(data)
      updateAppointmentStatus(data, appointmentId, 'attended_not_screened')

      const successMessage = getBilateralMastectomySuccessMessage(
        participantName,
        participantAppointmentUrl
      )
      req.flash('success', { wrapWithHeading: successMessage })

      res.redirect(modalBreakout(`/clinics/${clinicId}/`))
    }
  )

  // Edit existing medical history item
  router.get(
    '/clinics/:clinicId/appointments/:appointmentId/medical-information/medical-history/:type/edit/:itemId',
    (req, res) => {
      const { clinicId, appointmentId, type, itemId } = req.params
      const data = req.session.data

      // Validate type
      if (!isValidMedicalHistoryType(type)) {
        return res.redirect(
          `/clinics/${clinicId}/appointments/${appointmentId}/review-medical-information`
        )
      }

      // Convert slug to camelCase key for data lookup
      const dataKey = getMedicalHistoryKeyFromSlug(type) || type

      // Initialize medicalInformation if needed
      if (!data.appointment.medicalInformation) {
        data.appointment.medicalInformation = {}
      }

      // Find the medical history item using the correct data key
      const medicalHistoryItem =
        data.appointment.medicalInformation.medicalHistory?.[dataKey]?.find(
          (item) => item.id === itemId
        )

      if (medicalHistoryItem) {
        // Copy to temp for editing
        data.appointment.medicalHistoryTemp = FORM_CONVERTERS[dataKey]
          ? FORM_CONVERTERS[dataKey].toForm(medicalHistoryItem)
          : { ...medicalHistoryItem }
      } else {
        console.log(`Cannot find item ${itemId} in ${dataKey}`)
      }

      const formPage = getFormPage(dataKey, type)

      res.redirect(
        urlWithReferrer(
          `/clinics/${clinicId}/appointments/${appointmentId}/medical-information/medical-history/${formPage}`,
          req.query.referrerChain,
          req.query.scrollTo
        )
      )
    }
  )

  // Delete medical history item
  router.get(
    '/clinics/:clinicId/appointments/:appointmentId/medical-information/medical-history/:type/delete/:itemId',
    (req, res) => {
      const { clinicId, appointmentId, type, itemId } = req.params
      const data = req.session.data

      // Validate type
      if (!isValidMedicalHistoryType(type)) {
        return res.redirect(
          `/clinics/${clinicId}/appointments/${appointmentId}/review-medical-information`
        )
      }

      const typeConfig = getMedicalHistoryType(type)
      // Convert slug to camelCase key for data lookup
      const dataKey = getMedicalHistoryKeyFromSlug(type) || type

      // Remove item from array
      if (data.appointment?.medicalInformation?.medicalHistory?.[dataKey]) {
        data.appointment.medicalInformation.medicalHistory[dataKey] =
          data.appointment.medicalInformation.medicalHistory[dataKey].filter(
            (item) => item.id !== itemId
          )
      }

      req.flash('success', `${typeConfig.name} deleted`)

      const returnUrl = getReturnUrl(
        `/clinics/${clinicId}/appointments/${appointmentId}/review-medical-information`,
        req.query.referrerChain,
        req.query.scrollTo
      )
      res.redirect(modalBreakout(returnUrl))
    }
  )

  // Route handler for breast implants consent – appointment cannot proceed

  router.post(
    '/clinics/:clinicId/appointments/:appointmentId/medical-information/medical-history/appointment-cannot-proceed-answer',
    (req, res) => {
      const { clinicId, appointmentId } = req.params
      const data = req.session.data
      const participantName = getFullName(data.participant)

      const futureScreeningPlan =
        data.appointment?.cannotProceed?.futureScreeningPlan

      // Validate that an option was selected
      if (!futureScreeningPlan) {
        req.flash('error', {
          text: 'Select whether the participant plans to attend breast screening in future',
          name: 'appointment[cannotProceed][futureScreeningPlan]',
          href: '#futureScreeningPlan'
        })
        return res.redirect(
          `/clinics/${clinicId}/appointments/${appointmentId}/medical-information/medical-history/appointment-cannot-proceed`
        )
      }

      // Capture session end time only if appointment was started
      const appointment = getAppointment(data, appointmentId)
      if (appointment?.sessionDetails?.startedAt) {
        captureSessionEndTime(data, appointmentId, data.currentUser.id)
      }

      // Save the data
      saveTempAppointmentToAppointment(data)
      saveTempParticipantToParticipant(data)

      // Update appointment status to indicate cannot proceed
      updateAppointmentStatus(data, appointmentId, 'cancelled')

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
      res.redirect(modalBreakout(`/clinics/${clinicId}`))
    }
  )

  // Handle breast implants consent form submission
  router.post(
    '/clinics/:clinicId/appointments/:appointmentId/medical-information/medical-history/consent-answer',
    (req, res) => {
      const { clinicId, appointmentId } = req.params
      const data = req.session.data
      const consentGiven =
        data.appointment?.medicalInformation?.implantedDevices?.consentGiven
      const referrerChain = req.query.referrerChain
      const scrollTo = req.query.scrollTo

      // Validate that an option was selected
      if (!consentGiven) {
        req.flash('error', {
          text: 'Select whether they have signed the consent form',
          name: 'appointment[medicalInformation][implantedDevices][consentGiven]',
          href: '#consentGiven'
        })
        return res.redirect(
          `/clinics/${clinicId}/appointments/${appointmentId}/medical-information/medical-history/consent`
        )
      }

      // Handle "Yes" - full consent given
      if (consentGiven === 'yes') {
        // Save the medical history data that was in temp
        if (data.appointment?.medicalHistoryTemp) {
          // Initialize medicalInformation object if needed
          if (!data.appointment.medicalInformation) {
            data.appointment.medicalInformation = {}
          }

          // Initialize medicalHistory object if needed
          if (!data.appointment.medicalInformation.medicalHistory) {
            data.appointment.medicalInformation.medicalHistory = {}
          }

          // Initialize array for breast implants if needed
          if (
            !data.appointment.medicalInformation.medicalHistory
              .breastImplantsAugmentation
          ) {
            data.appointment.medicalInformation.medicalHistory.breastImplantsAugmentation =
              []
          }

          const medicalHistoryTemp = data.appointment.medicalHistoryTemp
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
            data.appointment.medicalInformation.medicalHistory.breastImplantsAugmentation.findIndex(
              (item) => item.id === medicalHistoryItem.id
            )
          if (existingIndex !== -1) {
            data.appointment.medicalInformation.medicalHistory.breastImplantsAugmentation[
              existingIndex
            ] = medicalHistoryItem
          } else {
            data.appointment.medicalInformation.medicalHistory.breastImplantsAugmentation.push(
              medicalHistoryItem
            )
          }

          // Clear temp data
          delete data.appointment.medicalHistoryTemp
        }

        // Show combined success message
        req.flash('success', 'Breast implants added and consent recorded')

        // Continue to next step in the flow
        const returnUrl = getReturnUrl(
          `/clinics/${clinicId}/appointments/${appointmentId}/review-medical-information`,
          referrerChain,
          scrollTo
        )
        res.redirect(modalBreakout(returnUrl))
      }
      // Handle "No, but scan unaffected breast"
      else if (consentGiven.startsWith('no-continue-')) {
        const unaffectedBreast = consentGiven.replace('no-continue-', '')
        const affectedBreast = unaffectedBreast === 'left' ? 'right' : 'left'

        // Save the medical history data with partial consent
        if (data.appointment?.medicalHistoryTemp) {
          // Initialize medicalInformation object if needed
          if (!data.appointment.medicalInformation) {
            data.appointment.medicalInformation = {}
          }

          // Initialize medicalHistory object if needed
          if (!data.appointment.medicalInformation.medicalHistory) {
            data.appointment.medicalInformation.medicalHistory = {}
          }

          // Initialize array for breast implants if needed
          if (
            !data.appointment.medicalInformation.medicalHistory
              .breastImplantsAugmentation
          ) {
            data.appointment.medicalInformation.medicalHistory.breastImplantsAugmentation =
              []
          }

          const medicalHistoryTemp = data.appointment.medicalHistoryTemp
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
            data.appointment.medicalInformation.medicalHistory.breastImplantsAugmentation.findIndex(
              (item) => item.id === medicalHistoryItem.id
            )
          if (existingIndex !== -1) {
            data.appointment.medicalInformation.medicalHistory.breastImplantsAugmentation[
              existingIndex
            ] = medicalHistoryItem
          } else {
            data.appointment.medicalInformation.medicalHistory.breastImplantsAugmentation.push(
              medicalHistoryItem
            )
          }

          // Clear temp data
          delete data.appointment.medicalHistoryTemp
        }

        // Set success message
        req.flash(
          'success',
          `Consent recorded as not given for ${affectedBreast} breast, but ${unaffectedBreast} breast to be scanned`
        )

        // Redirect back to medical history page
        const returnUrl = getReturnUrl(
          `/clinics/${clinicId}/appointments/${appointmentId}/review-medical-information`,
          referrerChain,
          scrollTo
        )
        res.redirect(modalBreakout(returnUrl))
      }
      // Handle "No, end appointment"
      else if (consentGiven === 'no') {
        // Don't save the medical history data - consent not given
        delete data.appointment.medicalHistoryTemp

        // Redirect to appointment cannot proceed page
        res.redirect(
          `/clinics/${clinicId}/appointments/${appointmentId}/medical-information/medical-history/appointment-cannot-proceed`
        )
      }
    }
  )
}
