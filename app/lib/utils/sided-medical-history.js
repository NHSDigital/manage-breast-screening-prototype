// app/lib/utils/sided-medical-history.js
//
// Converts between the medical history forms that ask which breast each item
// applies to (one list per question, with a side answer for each item) and the
// stored per-breast fields that the summaries and generators read.

// Each form field is a list of checkboxes. Its items are stored in one or more
// per-breast fields, for example proceduresRightBreast, and each item has a
// side field holding Right, Left or Both.
const BREAST_CANCER_FORM = {
  lists: [
    {
      formField: 'procedures',
      groups: [
        {
          storedField: 'procedures',
          items: {
            Lumpectomy: 'lumpectomySide',
            Mastectomy: 'mastectomySide'
          }
        }
      ]
    },
    {
      formField: 'otherSurgery',
      groups: [
        {
          storedField: 'otherSurgery',
          items: {
            'Lymph node surgery': 'lymphNodeSurgerySide',
            'Reconstruction': 'reconstructionSide',
            'Symmetrisation': 'symmetrisationSide'
          }
        }
      ]
    },
    {
      formField: 'treatment',
      groups: [
        {
          storedField: 'treatment',
          items: {
            'Breast radiotherapy': 'breastRadiotherapySide',
            'Lymph node radiotherapy': 'lymphNodeRadiotherapySide'
          }
        }
      ]
    }
  ],
  // Items with no side, stored in a single list alongside any details
  unsided: {
    formField: 'treatment',
    storedField: 'systemicTreatments',
    items: ['Chemotherapy', 'Hormone therapy', 'Other, or not known'],
    otherItem: 'Other, or not known',
    detailsField: 'otherTreatmentDetails'
  }
}

const MASTECTOMY_LUMPECTOMY_FORM = {
  lists: [
    {
      formField: 'procedures',
      groups: [
        {
          storedField: 'procedures',
          items: {
            Lumpectomy: 'lumpectomySide',
            Mastectomy: 'mastectomySide'
          }
        },
        {
          storedField: 'otherSurgery',
          items: {
            Reconstruction: 'reconstructionSide',
            Symmetrisation: 'symmetrisationSide'
          }
        }
      ]
    }
  ],
  unsided: {
    formField: 'procedures',
    storedField: 'otherProcedures',
    items: ['Other'],
    otherItem: 'Other',
    detailsField: 'otherProcedureDetails'
  }
}

const BREAST_IMPLANTS_FORM = {
  lists: [
    {
      formField: 'procedures',
      groups: [
        {
          storedField: 'procedures',
          items: {
            'Breast implants': 'breastImplantsSide',
            'Other, or not known': 'otherAugmentationSide'
          }
        }
      ]
    }
  ]
}

const toArray = (value) => {
  if (!value) {
    return []
  }
  return Array.isArray(value) ? value : [value]
}

const getSideFieldNames = (config) =>
  config.lists.flatMap((list) =>
    list.groups.flatMap((group) => Object.values(group.items))
  )

/**
 * Convert form answers into the stored per-breast fields
 *
 * Forms must be checked with the missing sides helpers first: an item with no
 * side chosen is not recorded against either breast.
 *
 * @param {object} config - Form definition
 * @param {object} formData - The medicalHistoryTemp object posted by the form
 * @returns {object} Copy of formData with the form-only fields replaced by the
 * per-breast fields and the unsided list
 */
const formToItem = (config, formData = {}) => {
  const item = { ...formData }

  config.lists.forEach((list) => {
    const selected = toArray(formData[list.formField])

    list.groups.forEach((group) => {
      const right = []
      const left = []

      Object.entries(group.items).forEach(([name, sideField]) => {
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

      item[`${group.storedField}RightBreast`] = right
      item[`${group.storedField}LeftBreast`] = left
    })

    delete item[list.formField]
  })

  const { unsided } = config
  if (unsided) {
    const selectedUnsided = toArray(formData[unsided.formField])
    item[unsided.storedField] = unsided.items.filter((name) =>
      selectedUnsided.includes(name)
    )
    if (!item[unsided.storedField].includes(unsided.otherItem)) {
      delete item[unsided.detailsField]
    }
  }

  getSideFieldNames(config).forEach((sideField) => delete item[sideField])

  return item
}

/**
 * Convert a stored item into the answers the form pre-fills from
 *
 * @param {object} config - Form definition
 * @param {object} item - Stored medical history item
 * @returns {object} Copy of item with the form fields (the checkbox lists and
 * a side field for each sided item) added
 */
const itemToForm = (config, item = {}) => {
  const formData = { ...item }

  config.lists.forEach((list) => {
    const selected = []

    list.groups.forEach((group) => {
      const right = toArray(item[`${group.storedField}RightBreast`])
      const left = toArray(item[`${group.storedField}LeftBreast`])

      Object.entries(group.items).forEach(([name, sideField]) => {
        const onRight = right.includes(name)
        const onLeft = left.includes(name)
        if (!onRight && !onLeft) {
          return
        }
        selected.push(name)
        formData[sideField] =
          onRight && onLeft ? 'Both' : onRight ? 'Right' : 'Left'
      })
    })

    formData[list.formField] = selected
  })

  const { unsided } = config
  if (unsided) {
    formData[unsided.formField] = [
      ...toArray(formData[unsided.formField]),
      ...toArray(item[unsided.storedField])
    ]
  }

  return formData
}

const getMissingSides = (config, formData = {}) =>
  config.lists.flatMap((list) => {
    const selected = toArray(formData[list.formField])
    return list.groups.flatMap((group) =>
      Object.entries(group.items)
        .filter(
          ([name, sideField]) => selected.includes(name) && !formData[sideField]
        )
        .map(([name, sideField]) => ({
          sideField,
          text: `Select which ${/lymph node/i.test(name) ? 'side' : 'breast'} for ${name.toLowerCase()}`
        }))
    )
  })

/**
 * List the ticked items that have no side chosen
 *
 * @param {object} formData - The medicalHistoryTemp object posted by the breast cancer form
 * @returns {Array<{sideField: string, text: string}>} Side field name and error message for each
 */
const getBreastCancerMissingSides = (formData) =>
  getMissingSides(BREAST_CANCER_FORM, formData)

/**
 * List the ticked items that have no side chosen
 *
 * @param {object} formData - The medicalHistoryTemp object posted by the mastectomy or lumpectomy form
 * @returns {Array<{sideField: string, text: string}>} Side field name and error message for each
 */
const getMastectomyLumpectomyMissingSides = (formData) =>
  getMissingSides(MASTECTOMY_LUMPECTOMY_FORM, formData)

/**
 * List the ticked items that have no side chosen
 *
 * @param {object} formData - The medicalHistoryTemp object posted by the breast implants or augmentation form
 * @returns {Array<{sideField: string, text: string}>} Side field name and error message for each
 */
const getBreastImplantsMissingSides = (formData) =>
  getMissingSides(BREAST_IMPLANTS_FORM, formData)

/**
 * Convert breast cancer form answers into the stored per-breast fields
 *
 * @param {object} formData - The medicalHistoryTemp object posted by the form
 * @returns {object} Item with proceduresRightBreast, proceduresLeftBreast,
 * otherSurgeryRightBreast, otherSurgeryLeftBreast, treatmentRightBreast,
 * treatmentLeftBreast and systemicTreatments
 */
const breastCancerFormToItem = (formData) =>
  formToItem(BREAST_CANCER_FORM, formData)

/**
 * Convert a stored breast cancer item into the answers its form pre-fills from
 *
 * @param {object} item - Stored breast cancer history item
 * @returns {object} Item with the form fields added
 */
const breastCancerItemToForm = (item) => itemToForm(BREAST_CANCER_FORM, item)

/**
 * Convert mastectomy or lumpectomy form answers into the stored per-breast fields
 *
 * @param {object} formData - The medicalHistoryTemp object posted by the form
 * @returns {object} Item with proceduresRightBreast, proceduresLeftBreast,
 * otherSurgeryRightBreast, otherSurgeryLeftBreast and otherProcedures
 */
const mastectomyLumpectomyFormToItem = (formData) =>
  formToItem(MASTECTOMY_LUMPECTOMY_FORM, formData)

/**
 * Convert a stored mastectomy or lumpectomy item into the answers its form pre-fills from
 *
 * @param {object} item - Stored mastectomy or lumpectomy history item
 * @returns {object} Item with the form fields added
 */
const mastectomyLumpectomyItemToForm = (item) =>
  itemToForm(MASTECTOMY_LUMPECTOMY_FORM, item)

/**
 * Convert breast implants or augmentation form answers into the stored per-breast fields
 *
 * @param {object} formData - The medicalHistoryTemp object posted by the form
 * @returns {object} Item with proceduresRightBreast and proceduresLeftBreast
 */
const breastImplantsFormToItem = (formData) =>
  formToItem(BREAST_IMPLANTS_FORM, formData)

/**
 * Convert a stored breast implants or augmentation item into the answers its form pre-fills from
 *
 * @param {object} item - Stored breast implants or augmentation history item
 * @returns {object} Item with the form fields added
 */
const breastImplantsItemToForm = (item) =>
  itemToForm(BREAST_IMPLANTS_FORM, item)

module.exports = {
  getBreastImplantsMissingSides,
  breastImplantsFormToItem,
  breastImplantsItemToForm,
  getBreastCancerMissingSides,
  getMastectomyLumpectomyMissingSides,
  breastCancerFormToItem,
  breastCancerItemToForm,
  mastectomyLumpectomyFormToItem,
  mastectomyLumpectomyItemToForm
}
