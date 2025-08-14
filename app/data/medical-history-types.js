// app/data/medical-history-types.js

module.exports = [
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
    type: 'nonCancerousBreastSurgeries',
    name: 'Non-cancerous breast surgeries',
    slug: 'non-cancerous-breast-surgeries',
    canHaveMultiple: true,
  },
  {
    type: 'cysts',
    name: 'Cysts',
    slug: 'cysts',
    canHaveMultiple: true,
  },
  {
    type: 'lumpRemovalBiopsy',
    name: 'Lump removal or biopsy',
    slug: 'lump-removal-biopsy',
    canHaveMultiple: true,
  },
  {
    type: 'lymphNodeSurgery',
    name: 'Lymph node surgery',
    slug: 'lymph-node-surgery',
    canHaveMultiple: true,
  },
  {
    type: 'mastectomy',
    name: 'Mastectomy',
    slug: 'mastectomy',
    canHaveMultiple: false,
  },
  {
    type: 'otherBreastChestProcedures',
    name: 'Other breast or chest procedures',
    slug: 'other-breast-chest-procedures',
    canHaveMultiple: true,
  }
]