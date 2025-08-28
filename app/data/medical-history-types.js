// app/data/medical-history-types.js

module.exports = [
    {
    type: 'breastCancer',
    name: 'Breast cancer',
    slug: 'breast-cancer',
    canHaveMultiple: false,
  },
  {
    type: 'implantedMedicalDevices',
    name: 'Implanted medical devices',
    slug: 'implanted-medical-devices',
    canHaveMultiple: true,
  },
  {
    type: 'breastImplantsAugmentation',
    name: 'Breast implants or augmentation',
    slug: 'breast-implants-augmentation',
    canHaveMultiple: true,
  },
  {
    type: 'mastectomy-lumpectomy',
    name: 'Mastectomy or lumpectomy',
    slug: 'mastectomy-lumpectomy',
    canHaveMultiple: true,
  },
  {
    type: 'cysts',
    name: 'Cysts',
    slug: 'cysts',
    canHaveMultiple: false,
  },
  {
    type: 'lumpRemovalBiopsy',
    name: 'Lump removal or biopsy',
    slug: 'lump-removal-biopsy',
    canHaveMultiple: true,
  },
  {
    type: 'otherProcedures',
    name: 'Other procedures',
    slug: 'other-procedures',
    canHaveMultiple: true,
  }
]