// app/data/test-scenarios.js

/**
 * Test scenarios define specific participants and events that should always exist
 * in the generated data. This ensures we have consistent test cases.
 *
 * Only specify what needs to be consistent - any unspecified fields will be randomly generated.
 * This allows natural variation while maintaining key test conditions.
 */
module.exports = [
  {
    participant: {
      id: 'bc724e9f',
      demographicInformation: {
        firstName: 'Janet',
        middleName: null,
        lastName: 'Williams',
        dateOfBirth: '1959-07-22',
        ethnicGroup: null,
        ethnicBackground: null
      },
      config: {
        eventId: '5gpn41oi',
        defaultRiskLevel: 'routine',
        repeatViews: ['RMLO'],
        missingViews: [], // ensure all views are present
        specialAppointment: {
          supportTypes: ['Physical restriction'],
          physicalRestrictionDetails:
            'Uses wheelchair, needs accessible positioning and additional time for transfers',
          temporaryReasons: 'no'
        },
        scheduling: {
          whenRelativeToToday: 0,
          status: 'event_checked_in',
          approximateTime: '10:30'
        }
      }
    }
  },
  {
    participant: {
      id: 'v0jt1us8',
      demographicInformation: {
        firstName: 'Angelina',
        middleName: null,
        lastName: 'Renner',
        ethnicGroup: null,
        ethnicBackground: null
      },
      config: {
        eventId: '1fefyh1q',
        defaultRiskLevel: 'routine',
        scheduling: {
          whenRelativeToToday: 0,
          status: 'event_complete',
          approximateTime: '9:45'
        },
        // Force 100% of all medical information types for testing
        medicalInformation: {
          probabilityOfSymptoms: 1.0,
          probabilityOfHRT: 1.0,
          probabilityOfPregnancyBreastfeeding: 1.0,
          probabilityOfOtherMedicalInfo: 1.0,
          probabilityOfBreastFeatures: 1.0,
          probabilityOfMedicalHistory: 1.0,
          forceMedicalHistoryTypes: [
            'breastCancer',
            'implantedMedicalDevice',
            'breastImplantsAugmentation',
            'mastectomyLumpectomy',
            'cysts',
            'benignLumps',
            'otherProcedures'
          ]
        }
      }
    }
  },
  {
    participant: {
      id: 'aab45c3d',
      demographicInformation: {
        firstName: 'Dianna',
        lastName: 'McIntosh',
        middleName: 'Rose',
        dateOfBirth: '1964-03-15',
        ethnicGroup: null,
        ethnicBackground: null
      },
      extraNeeds: null,
      config: {
        eventId: '0gdof6fh',
        defaultRiskLevel: 'routine',
        repeatViews: [],
        missingViews: [],
        scheduling: {
          whenRelativeToToday: 0,
          status: 'event_in_progress',
          approximateTime: '11:30'
          // slotIndex: 20,
        },
        workflowStatus: {
          'appointment': 'started',
          'confirm-identity': 'completed',
          'review-medical-information': 'completed',
          'awaiting-images': 'completed',
          'take-images': 'completed'
        },
        // Force 100% of all medical information types for testing
        medicalInformation: {
          probabilityOfSymptoms: 1.0,
          probabilityOfHRT: 1.0,
          probabilityOfPregnancyBreastfeeding: 1.0,
          probabilityOfOtherMedicalInfo: 1.0,
          probabilityOfBreastFeatures: 1.0,
          probabilityOfMedicalHistory: 1.0,
          forceMedicalHistoryTypes: [
            'breastCancer',
            'implantedMedicalDevice',
            'breastImplantsAugmentation',
            'mastectomyLumpectomy',
            'cysts',
            'benignLumps',
            'otherProcedures'
          ]
        }
      }
    }
  }
]
