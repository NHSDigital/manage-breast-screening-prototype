// app/lib/generators/seed-profiles.js

const DEFAULT_SEED_DATA_PROFILE = 'routine'
const CUSTOM_SEED_DATA_PROFILE = 'custom'

const isObject = (value) => {
  return value && typeof value === 'object' && !Array.isArray(value)
}

const mergeDeep = (base, override) => {
  if (!isObject(base) || !isObject(override)) {
    return override === undefined ? base : override
  }

  const result = { ...base }

  Object.keys(override).forEach((key) => {
    const baseValue = base[key]
    const overrideValue = override[key]

    if (isObject(baseValue) && isObject(overrideValue)) {
      result[key] = mergeDeep(baseValue, overrideValue)
      return
    }

    result[key] = overrideValue
  })

  return result
}

const SEED_DATA_PROFILE_DEFAULTS = {
  imageReading: {
    probabilityFirstReaderOpinionMatchesImages: 0.95
  },
  medicalInformation: {
    probabilityOfSymptoms: 0.05,
    probabilityOfHRT: 0.2,
    probabilityOfPregnancyBreastfeeding: 0.01,
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
      standard: 0.95,
      extraImages: 0.02,
      technicalRepeat: 0.01,
      incomplete: 0.01,
      incompleteImperfect: 0.01
    },
    imperfectChanceForTechnicalOrIncomplete: 0.08,
    notesForReaderChanceWithoutImperfect: 0.03
  },
  imageSetSelection: {
    contextualTagWeights: {
      default: {
        normal: 0.87,
        abnormal: 0.09,
        indeterminate: 0.02,
        technical: 0.02
      },
      symptoms: {
        normal: 0.7,
        abnormal: 0.15,
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
}

const SEED_DATA_PROFILE_DEFINITIONS = [
  {
    key: 'routine',
    label: 'Routine',
    settings: {}
  },
  {
    key: 'medium',
    label: 'Medium',
    settings: {
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
          }
        }
      }
    }
  },
  {
    key: 'high',
    label: 'High',
    settings: {
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
        probability: 0.2
      },
      previousMammograms: {
        rate: 0.2
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
            normal: 0.45,
            abnormal: 0.3,
            indeterminate: 0.15,
            technical: 0.1
          }
        }
      }
    }
  },
  {
    divider: true,
    label: '---'
  },
  {
    key: 'allNormals',
    label: 'All normals',
    settings: {
      medicalInformation: {
        probabilityOfSymptoms: 0.0
      },
      mammogram: {
        scenarioWeights: {
          standard: 1,
          extraImages: 0,
          technicalRepeat: 0,
          incomplete: 0,
          incompleteImperfect: 0
        },
        imperfectChanceForTechnicalOrIncomplete: 0,
        notesForReaderChanceWithoutImperfect: 0
      },
      previousMammograms: {
        rate: 0
      },
      imageSetSelection: {
        contextualTagWeights: {
          default: {
            normal: 1,
            abnormal: 0,
            indeterminate: 0,
            technical: 0
          }
        }
      }
    }
  },
  {
    key: 'highAbnormalities',
    label: 'High abnormalities',
    settings: {
      imageSetSelection: {
        contextualTagWeights: {
          default: {
            normal: 0.5,
            abnormal: 0.35,
            indeterminate: 0.1,
            technical: 0.05
          }
        }
      }
    }
  },
  {
    key: 'highSymptoms',
    label: 'High symptoms',
    settings: {
      medicalInformation: {
        probabilityOfSymptoms: 0.5
      }
    }
  }
]

const SEED_DATA_PROFILES = Object.fromEntries(
  SEED_DATA_PROFILE_DEFINITIONS.filter((definition) => !definition.divider).map(
    (profile) => {
      const profileSettings = profile.settings || {}

      return [
        profile.key,
        {
          key: profile.key,
          label: profile.label,
          ...mergeDeep(SEED_DATA_PROFILE_DEFAULTS, profileSettings)
        }
      ]
    }
  )
)

const getSeedDataProfile = (profileName = DEFAULT_SEED_DATA_PROFILE) => {
  return (
    SEED_DATA_PROFILES[profileName] ||
    SEED_DATA_PROFILES[DEFAULT_SEED_DATA_PROFILE]
  )
}

const cloneDeep = (value) => {
  return JSON.parse(JSON.stringify(value))
}

const getSeedDataProfileOptionsWithCustom = () => {
  return [
    ...getSeedDataProfileOptions(),
    {
      key: CUSTOM_SEED_DATA_PROFILE,
      label: 'Custom'
    }
  ]
}

const createDefaultCustomProfile = (
  baseProfileKey = DEFAULT_SEED_DATA_PROFILE
) => {
  const baseProfile = getSeedDataProfile(baseProfileKey)

  return {
    ...cloneDeep(baseProfile),
    key: CUSTOM_SEED_DATA_PROFILE,
    label: 'Custom'
  }
}

const createSeedProfilesState = () => {
  return {
    selectedKey: DEFAULT_SEED_DATA_PROFILE,
    customBaseKey: DEFAULT_SEED_DATA_PROFILE,
    options: getSeedDataProfileOptionsWithCustom(),
    profiles: {
      ...cloneDeep(SEED_DATA_PROFILES),
      [CUSTOM_SEED_DATA_PROFILE]: createDefaultCustomProfile()
    }
  }
}

const ensureSeedProfilesState = (settings = {}) => {
  if (!isObject(settings.seedProfiles)) {
    settings.seedProfiles = createSeedProfilesState()
    return settings.seedProfiles
  }

  const state = settings.seedProfiles

  if (!state.selectedKey) {
    state.selectedKey = DEFAULT_SEED_DATA_PROFILE
  }

  if (!state.customBaseKey) {
    state.customBaseKey = DEFAULT_SEED_DATA_PROFILE
  }

  if (!Array.isArray(state.options) || state.options.length === 0) {
    state.options = getSeedDataProfileOptionsWithCustom()
  }

  if (!isObject(state.profiles)) {
    state.profiles = cloneDeep(SEED_DATA_PROFILES)
  }

  if (!isObject(state.profiles[CUSTOM_SEED_DATA_PROFILE])) {
    state.profiles[CUSTOM_SEED_DATA_PROFILE] = createDefaultCustomProfile(
      state.customBaseKey
    )
  }

  return state
}

const getSeedDataProfileFromState = (
  seedProfilesState,
  profileName = DEFAULT_SEED_DATA_PROFILE
) => {
  if (isObject(seedProfilesState?.profiles)) {
    const selectedProfile = seedProfilesState.profiles[profileName]
    if (selectedProfile) {
      return {
        ...selectedProfile,
        key: selectedProfile.key || profileName,
        label: selectedProfile.label || profileName
      }
    }
  }

  return getSeedDataProfile(profileName)
}

const getSeedDataProfileOptions = () => {
  return SEED_DATA_PROFILE_DEFINITIONS.map((definition) => {
    if (definition.divider) {
      return {
        divider: true,
        label: definition.label || '---'
      }
    }

    return {
      key: definition.key,
      label: definition.label
    }
  })
}

module.exports = {
  SEED_DATA_PROFILES,
  SEED_DATA_PROFILE_DEFINITIONS,
  SEED_DATA_PROFILE_DEFAULTS,
  DEFAULT_SEED_DATA_PROFILE,
  CUSTOM_SEED_DATA_PROFILE,
  mergeDeep,
  createSeedProfilesState,
  ensureSeedProfilesState,
  getSeedDataProfileFromState,
  getSeedDataProfile,
  getSeedDataProfileOptions,
  getSeedDataProfileOptionsWithCustom
}
