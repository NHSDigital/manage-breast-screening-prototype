// tests/e2e/sided-medical-history.spec.js

const { test, expect } = require('@playwright/test')
const {
  getBenignLumpsMissingSides,
  benignLumpsFormToItem,
  benignLumpsItemToForm,
  getBreastImplantsMissingSides,
  breastImplantsFormToItem,
  breastImplantsItemToForm,
  getBreastCancerMissingSides,
  breastCancerFormToItem,
  breastCancerItemToForm,
  getMastectomyLumpectomyMissingSides,
  mastectomyLumpectomyFormToItem,
  mastectomyLumpectomyItemToForm
} = require('../../app/lib/utils/sided-medical-history')
const {
  generateBreastCancerItem,
  generateMastectomyLumpectomyItem
} = require('../../app/lib/generators/medical-information/medical-history-generator')

const converters = [
  {
    name: 'breast cancer',
    formData: {
      procedures: ['Mastectomy'],
      mastectomySide: 'Both',
      treatment: ['Breast radiotherapy', 'Chemotherapy'],
      breastRadiotherapySide: 'Left'
    },
    toItem: breastCancerFormToItem,
    toForm: breastCancerItemToForm,
    getMissingSides: getBreastCancerMissingSides,
    missingSideData: { procedures: ['Mastectomy'] }
  },
  {
    name: 'benign lumps',
    formData: {
      procedures: ['Lump removed', 'Not known'],
      lumpRemovedSide: 'Left',
      notKnownDetails: 'Side not recorded'
    },
    toItem: benignLumpsFormToItem,
    toForm: benignLumpsItemToForm,
    getMissingSides: getBenignLumpsMissingSides,
    missingSideData: { procedures: ['Lump removed'] }
  },
  {
    name: 'breast implants',
    formData: {
      procedures: ['Breast implants', 'Other, or not known'],
      breastImplantsSide: 'Both',
      otherAugmentationDetails: 'Implant type not recorded'
    },
    toItem: breastImplantsFormToItem,
    toForm: breastImplantsItemToForm,
    getMissingSides: getBreastImplantsMissingSides,
    missingSideData: { procedures: ['Breast implants'] }
  },
  {
    name: 'mastectomy or lumpectomy',
    formData: {
      procedures: ['Mastectomy', 'Reconstruction', 'Other'],
      mastectomySide: 'Both',
      reconstructionSide: 'Left',
      otherProcedureDetails: 'Other procedure'
    },
    toItem: mastectomyLumpectomyFormToItem,
    toForm: mastectomyLumpectomyItemToForm,
    getMissingSides: getMastectomyLumpectomyMissingSides,
    missingSideData: { procedures: ['Mastectomy'] }
  }
]

for (const converter of converters) {
  test(`${converter.name} answers round-trip through stored side fields`, () => {
    const item = converter.toItem(converter.formData)
    expect(converter.toForm(item)).toMatchObject(converter.formData)
  })

  test(`${converter.name} requires a side for selected procedures`, () => {
    expect(converter.getMissingSides(converter.missingSideData)).toHaveLength(1)
  })
}

test('generated unknown cancer location uses the form option', () => {
  const originalRandom = Math.random
  Math.random = () => 0.999999

  try {
    expect(generateBreastCancerItem().cancerLocation).toEqual(['Not known'])
  } finally {
    Math.random = originalRandom
  }
})

test('generated mastectomies include a matching imaging follow-up answer', () => {
  const generators = [
    generateBreastCancerItem,
    generateMastectomyLumpectomyItem
  ]

  for (const generateItem of generators) {
    const item = Array.from({ length: 100 }, generateItem).find(
      (historyItem) =>
        historyItem.proceduresRightBreast?.includes('Mastectomy') ||
        historyItem.proceduresLeftBreast?.includes('Mastectomy')
    )
    expect(item).toBeDefined()

    const mastectomyOnRight =
      item.proceduresRightBreast?.includes('Mastectomy')
    const mastectomyOnLeft = item.proceduresLeftBreast?.includes('Mastectomy')
    const mastectomySide =
      mastectomyOnRight && mastectomyOnLeft
        ? 'Both'
        : mastectomyOnRight
          ? 'Right'
          : 'Left'

    expect(item.mastectomyImagingFor).toBe(mastectomySide)
    if (mastectomySide === 'Both') {
      expect(['None', 'Right', 'Left', 'Both']).toContain(
        item.mastectomyImagingSide
      )
    } else {
      expect([mastectomySide === 'Right' ? 'Left' : 'Right', 'Both']).toContain(
        item.mastectomyImagingSide
      )
    }
  }
})
