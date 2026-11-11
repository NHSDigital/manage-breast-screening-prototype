// app/lib/utils/sided-medical-history.js
//
// Converts between the medical history forms that ask which breast each item
// applies to (one list per question, with a side answer for each item) and the
// stored per-breast fields that the summaries and generators read.

// Each form field is a list of checkboxes. Its items are stored in one or more
// per-breast fields, for example proceduresRightBreast, and each item has a
// side field holding Right, Left or Both.
const breastCancer = {
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

const mastectomyLumpectomy = {
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

const benignLumps = {
  lists: [
    {
      formField: 'procedures',
      groups: [
        {
          storedField: 'procedures',
          items: {
            'Needle biopsy': 'needleBiopsySide',
            'Lump removed': 'lumpRemovedSide'
          }
        }
      ]
    }
  ],
  unsided: {
    formField: 'procedures',
    storedField: 'otherProcedures',
    items: ['Not known'],
    otherItem: 'Not known',
    detailsField: 'notKnownDetails'
  }
}

const breastImplantsAugmentation = {
  lists: [
    {
      formField: 'procedures',
      groups: [
        {
          storedField: 'procedures',
          items: {
            'Breast implants': 'breastImplantsSide'
          }
        }
      ]
    }
  ],
  unsided: {
    formField: 'procedures',
    storedField: 'otherProcedures',
    items: ['Other, or not known'],
    otherItem: 'Other, or not known',
    detailsField: 'otherAugmentationDetails'
  }
}

// Forms that ask a side for each item, keyed by medical history type
const SIDED_FORMS = {
  breastCancer,
  mastectomyLumpectomy,
  benignLumps,
  breastImplantsAugmentation
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
 * Convert medical history form answers into the stored per-breast fields
 *
 * Types without a sided form are returned as a plain copy. Check the form with
 * getMissingMedicalHistorySides first: an item with no side chosen is not
 * recorded against either breast.
 *
 * @param {object} formData - The medicalHistoryTemp object posted by the form
 * @param {string} type - Medical history type, for example 'breastCancer'
 * @returns {object} Copy of formData with the checkbox lists and side fields
 * replaced by per-breast fields (such as proceduresRightBreast) and the unsided list
 * @example
 * {{ appointment.medicalHistoryTemp | medicalHistoryFormToItem("breastImplantsAugmentation") }}
 */
const medicalHistoryFormToItem = (formData = {}, type) => {
  const config = SIDED_FORMS[type]
  const item = { ...formData }

  if (!config) {
    return item
  }

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
  const selectedUnsided = toArray(formData[unsided.formField])
  item[unsided.storedField] = unsided.items.filter((name) =>
    selectedUnsided.includes(name)
  )
  if (!item[unsided.storedField].includes(unsided.otherItem)) {
    delete item[unsided.detailsField]
  }

  getSideFieldNames(config).forEach((sideField) => delete item[sideField])

  return item
}

/**
 * Convert a stored medical history item into the answers its form pre-fills from
 *
 * Types without a sided form are returned as a plain copy.
 *
 * @param {object} item - Stored medical history item
 * @param {string} type - Medical history type, for example 'breastCancer'
 * @returns {object} Copy of item with the checkbox lists and a side field for
 * each sided item added
 */
const medicalHistoryItemToForm = (item = {}, type) => {
  const config = SIDED_FORMS[type]
  const formData = { ...item }

  if (!config) {
    return formData
  }

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
  formData[unsided.formField] = [
    ...toArray(formData[unsided.formField]),
    ...toArray(item[unsided.storedField])
  ]

  return formData
}

/**
 * List the ticked items on a medical history form that have no side chosen
 *
 * @param {object} formData - The medicalHistoryTemp object posted by the form
 * @param {string} type - Medical history type, for example 'breastCancer'
 * @returns {Array<{sideField: string, text: string}>} Side field name and error
 * message for each, or an empty list for types without a sided form
 */
const getMissingMedicalHistorySides = (formData = {}, type) => {
  const config = SIDED_FORMS[type]

  if (!config) {
    return []
  }

  return config.lists.flatMap((list) => {
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
}

module.exports = {
  medicalHistoryFormToItem,
  medicalHistoryItemToForm,
  getMissingMedicalHistorySides
}
