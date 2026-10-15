// app/data/test-scenarios.js

/**
 * Test scenarios define specific participants and appointments that should always exist
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
        appointmentId: '5gpn41oi',
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
          status: 'checked_in',
          approximateTime: '10:30',
          checkInTime: '10:10'
        }
      }
    }
  },
  {
    // Scheduled earlier than Janet (9:30) but checked in later (10:20), so
    // sorting the clinic list by Time and by Checked in gives a different order
    participant: {
      id: 'd4f8a1c2',
      demographicInformation: {
        firstName: 'Priya',
        middleName: null,
        lastName: 'Shah',
        dateOfBirth: '1958-11-03',
        ethnicGroup: null,
        ethnicBackground: null
      },
      config: {
        appointmentId: 'ck1shah0',
        defaultRiskLevel: 'routine',
        scheduling: {
          whenRelativeToToday: 0,
          status: 'checked_in',
          approximateTime: '9:30',
          checkInTime: '10:20'
        }
      }
    }
  },
  {
    // Longest wait of the checked-in group: scheduled 9:15, checked in 9:20
    participant: {
      id: 'e7b23f90',
      demographicInformation: {
        firstName: 'Margaret',
        middleName: null,
        lastName: 'Osei',
        dateOfBirth: '1961-05-19',
        ethnicGroup: null,
        ethnicBackground: null
      },
      config: {
        appointmentId: 'ck2osei1',
        defaultRiskLevel: 'routine',
        scheduling: {
          whenRelativeToToday: 0,
          status: 'checked_in',
          approximateTime: '9:15',
          checkInTime: '9:20'
        }
      }
    }
  },
  {
    // Screened pair that shows screening order differs from arrival order:
    // Harriet checked in first (9:00) but was screened later (9:30)
    participant: {
      id: 'f1a2b3c4',
      demographicInformation: {
        firstName: 'Harriet',
        middleName: null,
        lastName: 'Nguyen',
        dateOfBirth: '1957-02-14',
        ethnicGroup: null,
        ethnicBackground: null
      },
      config: {
        appointmentId: 'scrq0001',
        defaultRiskLevel: 'routine',
        scheduling: {
          whenRelativeToToday: 0,
          status: 'complete',
          approximateTime: '9:00',
          checkInTime: '9:00',
          screenedAt: '9:30'
        }
      }
    }
  },
  {
    // Carmen checked in later (9:20) than Harriet but was screened earlier
    // (9:25), so sorting by Screened by differs from arrival and scheduled time
    participant: {
      id: 'a9b8c7d6',
      demographicInformation: {
        firstName: 'Carmen',
        middleName: null,
        lastName: 'Lewis',
        dateOfBirth: '1960-08-09',
        ethnicGroup: null,
        ethnicBackground: null
      },
      config: {
        appointmentId: 'scrp0002',
        defaultRiskLevel: 'routine',
        scheduling: {
          whenRelativeToToday: 0,
          status: 'complete',
          approximateTime: '9:20',
          checkInTime: '9:20',
          screenedAt: '9:25'
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
        appointmentId: '1fefyh1q',
        defaultRiskLevel: 'routine',
        scheduling: {
          whenRelativeToToday: 0,
          status: 'complete',
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
        appointmentId: '0gdof6fh',
        defaultRiskLevel: 'routine',
        repeatViews: [],
        missingViews: [],
        scheduling: {
          whenRelativeToToday: 0,
          status: 'in_progress',
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
