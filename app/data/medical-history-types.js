// app/data/medical-history-types.js

module.exports = [
    {
    type: 'breastCancer',
    name: 'Breast cancer',
    slug: 'breast-cancer',
    canHaveMultiple: true,
  },
  {
    type: 'implantedMedicalDevice',
    name: 'Implanted medical device',
    slug: 'implanted-medical-device',
    canHaveMultiple: true,
  },
  {
    type: 'breastImplantsAugmentation',
    name: 'Breast implants or augmentation',
    slug: 'breast-implants-augmentation',
    canHaveMultiple: false,
  },
  {
    type: 'mastectomyLumpectomy',
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
    type: 'benignLumps',
    name: 'Benign lumps',
    slug: 'benign-lumps',
    canHaveMultiple: true,
  },
  {
    type: 'otherProcedures',
    name: 'Other procedures',
    slug: 'other-procedures',
    canHaveMultiple: true,
  }
]