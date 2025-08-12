// app/data/medical-history-types.js

module.exports = {
  implantedMedicalDevices: {
    name: 'Implanted medical devices',
    slug: 'implanted-medical-devices',
    canHaveMultiple: true,
  },
  breastImplantsAugmentation: {
    name: 'Breast implants or augmentation',
    slug: 'breast-implants-augmentation',
    canHaveMultiple: true,
  },
  nonCancerousBreastSurgeries: {
    name: 'Non-cancerous breast surgeries',
    slug: 'non-cancerous-breast-surgeries',
    canHaveMultiple: true,
  },
  cysts: {
    name: 'Cysts',
    slug: 'cysts',
    canHaveMultiple: true,
  },
  lumpRemovalBiopsy: {
    name: 'Lump removal or biopsy',
    slug: 'lump-removal-biopsy',
    canHaveMultiple: true,
  },
  lymphNodeSurgery: {
    name: 'Lymph node surgery',
    slug: 'lymph-node-surgery',
    canHaveMultiple: true,
  },
  mastectomy: {
    name: 'Mastectomy',
    slug: 'mastectomy',
    canHaveMultiple: false,
  },
  otherBreastChestProcedures: {
    name: 'Other breast or chest procedures',
    slug: 'other-breast-chest-procedures',
    canHaveMultiple: true,
  }
}