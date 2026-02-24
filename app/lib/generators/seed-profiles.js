// app/lib/generators/seed-profiles.js

const DEFAULT_SEED_DATA_PROFILE = 'medium'

const SEED_DATA_PROFILES = {
  low: {
    key: 'low',
    label: 'Low',
    medicalInformation: {
      probabilityOfSymptoms: 0.05,
      probabilityOfHRT: 0.2,
      probabilityOfPregnancyBreastfeeding: 0.03,
      probabilityOfOtherMedicalInfo: 0.12,
      probabilityOfBreastFeatures: 0.06,
      probabilityOfMultipleBreastFeatures: 0.2,
      probabilityOfMedicalHistory: 0.2
    },
    specialAppointment: {
      probability: 0.04
    },
    previousMammograms: {
      rate: 0.02
    },
    mammogram: {
      scenarioWeights: {
        standard: 0.85,
        extraImages: 0.04,
        technicalRepeat: 0.03,
        incomplete: 0.02,
        incompleteImperfect: 0.01
      },
      imperfectChanceForTechnicalOrIncomplete: 0.08,
      notesForReaderChanceWithoutImperfect: 0.03
    },
    imageSetSelection: {
      contextualTagWeights: {
        default: {
          normal: 0.8,
          abnormal: 0.12,
          indeterminate: 0.04,
          technical: 0.04
        },
        symptoms: {
          normal: 0.5,
          abnormal: 0.35,
          indeterminate: 0.08,
          technical: 0.07
        },
        imperfect: {
          normal: 0.2,
          abnormal: 0.1,
          indeterminate: 0,
          technical: 0.7
        },
        symptomsAndImperfect: {
          normal: 0.2,
          abnormal: 0.3,
          indeterminate: 0.05,
          technical: 0.45
        }
      }
    }
  },
  medium: {
    key: 'medium',
    label: 'Medium',
    medicalInformation: {
      probabilityOfSymptoms: 0.15,
      probabilityOfHRT: 0.3,
      probabilityOfPregnancyBreastfeeding: 0.05,
      probabilityOfOtherMedicalInfo: 0.2,
      probabilityOfBreastFeatures: 0.15,
      probabilityOfMultipleBreastFeatures: 0.3,
      probabilityOfMedicalHistory: 0.5
    },
    specialAppointment: {
      probability: 0.08
    },
    previousMammograms: {
      rate: 0.05
    },
    mammogram: {
      scenarioWeights: {
        standard: 0.7,
        extraImages: 0.1,
        technicalRepeat: 0.1,
        incomplete: 0.07,
        incompleteImperfect: 0.03
      },
      imperfectChanceForTechnicalOrIncomplete: 0.15,
      notesForReaderChanceWithoutImperfect: 0.05
    },
    imageSetSelection: {
      contextualTagWeights: {
        default: {
          normal: 0.7,
          abnormal: 0.15,
          indeterminate: 0.1,
          technical: 0.05
        },
        symptoms: {
          normal: 0.3,
          abnormal: 0.5,
          indeterminate: 0.1,
          technical: 0.1
        },
        imperfect: {
          normal: 0.1,
          abnormal: 0.1,
          indeterminate: 0,
          technical: 0.8
        },
        symptomsAndImperfect: {
          normal: 0.15,
          abnormal: 0.35,
          indeterminate: 0.05,
          technical: 0.45
        }
      }
    }
  },
  high: {
    key: 'high',
    label: 'High',
    medicalInformation: {
      probabilityOfSymptoms: 0.25,
      probabilityOfHRT: 0.35,
      probabilityOfPregnancyBreastfeeding: 0.08,
      probabilityOfOtherMedicalInfo: 0.3,
      probabilityOfBreastFeatures: 0.25,
      probabilityOfMultipleBreastFeatures: 0.45,
      probabilityOfMedicalHistory: 0.65
    },
    specialAppointment: {
      probability: 0.12
    },
    previousMammograms: {
      rate: 0.1
    },
    mammogram: {
      scenarioWeights: {
        standard: 0.45,
        extraImages: 0.15,
        technicalRepeat: 0.2,
        incomplete: 0.12,
        incompleteImperfect: 0.08
      },
      imperfectChanceForTechnicalOrIncomplete: 0.3,
      notesForReaderChanceWithoutImperfect: 0.08
    },
    imageSetSelection: {
      contextualTagWeights: {
        default: {
          normal: 0.55,
          abnormal: 0.2,
          indeterminate: 0.15,
          technical: 0.1
        },
        symptoms: {
          normal: 0.15,
          abnormal: 0.6,
          indeterminate: 0.1,
          technical: 0.15
        },
        imperfect: {
          normal: 0.05,
          abnormal: 0.1,
          indeterminate: 0,
          technical: 0.85
        },
        symptomsAndImperfect: {
          normal: 0.08,
          abnormal: 0.42,
          indeterminate: 0.05,
          technical: 0.45
        }
      }
    }
  }
}

const getSeedDataProfile = (profileName = DEFAULT_SEED_DATA_PROFILE) => {
  return (
    SEED_DATA_PROFILES[profileName] ||
    SEED_DATA_PROFILES[DEFAULT_SEED_DATA_PROFILE]
  )
}

module.exports = {
  SEED_DATA_PROFILES,
  DEFAULT_SEED_DATA_PROFILE,
  getSeedDataProfile
}
