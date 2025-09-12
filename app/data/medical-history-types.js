// app/data/medical-history-types.js

module.exports = [
  {
    type: 'breastCancer',
    name: 'Breast cancer',
    slug: 'breast-cancer',
    canHaveMultiple: true,
    yearLabel: 'Diagnosis year'
  },
  {
    type: 'implantedMedicalDevice',
    name: 'Implanted medical device',
    slug: 'implanted-medical-device',
    canHaveMultiple: true,
    yearLabel: 'Procedure year'
  },
  {
    type: 'breastImplantsAugmentation',
    name: 'Breast implants or augmentation',
    slug: 'breast-implants-augmentation',
    canHaveMultiple: false,
    yearLabel: 'Procedure year'
  },
  {
    type: 'mastectomyLumpectomy',
    name: 'Mastectomy or lumpectomy',
    slug: 'mastectomy-lumpectomy',
    canHaveMultiple: true,
    yearLabel: 'Surgery year'
  },
  {
    type: 'cysts',
    name: 'Cysts',
    slug: 'cysts',
    canHaveMultiple: false
  },
  {
    type: 'benignLumps',
    name: 'Benign lumps',
    slug: 'benign-lumps',
    canHaveMultiple: true,
    yearLabel: 'Procedure year'
  },
  {
    type: 'otherProcedures',
    name: 'Other procedures',
    slug: 'other-procedures',
    canHaveMultiple: true,
    yearLabel: 'Procedure year'
  }
]
