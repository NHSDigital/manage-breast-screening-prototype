// app/lib/utils/breast-cancer-history.js
//
// Converts between the breast cancer form (one list per question, with a side
// answer for each item) and the stored per-breast fields that the summaries
// and generators read.

const SIDED_QUESTIONS = [
  {
    formField: 'procedures',
    storedField: 'procedures',
    items: {
      Lumpectomy: 'lumpectomySide',
      Mastectomy: 'mastectomySide'
    }
  },
  {
    formField: 'otherSurgery',
    storedField: 'otherSurgery',
    items: {
      'Lymph node surgery': 'lymphNodeSurgerySide',
      'Reconstruction': 'reconstructionSide',
      'Symmetrisation': 'symmetrisationSide'
    }
  },
  {
    formField: 'treatment',
    storedField: 'treatment',
    items: {
      'Breast radiotherapy': 'breastRadiotherapySide',
      'Lymph node radiotherapy': 'lymphNodeRadiotherapySide'
    }
  }
]

// Treatments that affect the whole body, so have no side
const WHOLE_BODY_TREATMENTS = ['Chemotherapy', 'Hormone therapy']
const OTHER_TREATMENT = 'Other, or not known'

const SIDE_FIELD_NAMES = SIDED_QUESTIONS.flatMap((question) =>
  Object.values(question.items)
)

const toArray = (value) => {
  if (!value) {
    return []
  }
  return Array.isArray(value) ? value : [value]
}

/**
 * Convert the breast cancer form answers into the stored per-breast fields
 *
 * An item with no side chosen is not recorded against either breast.
 *
 * @param {object} formData - The medicalHistoryTemp object posted by the form
 * @returns {object} Copy of formData with the form-only fields replaced by
 * proceduresRightBreast, proceduresLeftBreast, otherSurgeryRightBreast,
 * otherSurgeryLeftBreast, treatmentRightBreast, treatmentLeftBreast and
 * systemicTreatments
 */
const breastCancerFormToItem = (formData = {}) => {
  const item = { ...formData }

  SIDED_QUESTIONS.forEach((question) => {
    const selected = toArray(formData[question.formField])
    const right = []
    const left = []

    Object.entries(question.items).forEach(([name, sideField]) => {
      if (!selected.includes(name)) {
        return
      }
      const side = formData[sideField]
      if (side === 'Right' || side === 'Both') {
        right.push(name)
      }
      if (side === 'Left' || side === 'Both') {
        left.push(name)
      }
    })

    item[`${question.storedField}RightBreast`] = right
    item[`${question.storedField}LeftBreast`] = left
    delete item[question.formField]
  })

  const selectedTreatments = toArray(formData.treatment)
  item.systemicTreatments = [...WHOLE_BODY_TREATMENTS, OTHER_TREATMENT].filter(
    (name) => selectedTreatments.includes(name)
  )
  if (!item.systemicTreatments.includes(OTHER_TREATMENT)) {
    delete item.otherTreatmentDetails
  }

  SIDE_FIELD_NAMES.forEach((sideField) => delete item[sideField])

  return item
}

/**
 * Convert a stored breast cancer item into the answers the form pre-fills from
 *
 * @param {object} item - Stored breast cancer history item
 * @returns {object} Copy of item with the form fields (procedures,
 * otherSurgery, treatment and a side field for each sided item) added
 */
const breastCancerItemToForm = (item = {}) => {
  const formData = { ...item }

  SIDED_QUESTIONS.forEach((question) => {
    const right = toArray(item[`${question.storedField}RightBreast`])
    const left = toArray(item[`${question.storedField}LeftBreast`])
    const selected = []

    Object.entries(question.items).forEach(([name, sideField]) => {
      const onRight = right.includes(name)
      const onLeft = left.includes(name)
      if (!onRight && !onLeft) {
        return
      }
      selected.push(name)
      formData[sideField] =
        onRight && onLeft ? 'Both' : onRight ? 'Right' : 'Left'
    })

    formData[question.formField] = selected
  })

  formData.treatment = [
    ...formData.treatment,
    ...toArray(item.systemicTreatments)
  ]

  return formData
}

module.exports = {
  breastCancerFormToItem,
  breastCancerItemToForm
}
