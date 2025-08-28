// app/data/breast-screening-units.js

module.exports = [
  {
    id: 'm5ekcxvu', // Must be hardcoded so it matches generated data
    name: 'West of London BSS',
    address: {
      line1: 'Breast services',
      line2: 'Carring Cross Hospital',
      line3: 'Fulham Palace Rd',
      city: 'London',
      postcode: 'W6 8RF'
    },
    phoneNumber: '01865235621',
    abbreviation: 'ECX',
    // clinicTypes: ['screening', 'assessment'], // Can do both
    clinicTypes: ['screening'],
    riskLevelHandling: ['routine', 'family history'],
    // Default operating hours for the BSU
    sessionPatterns: [
      // {
      //   name: 'full_day',
      //   type: 'single',
      //   sessions: [
      //     { startTime: '09:00', endTime: '17:00' },
      //   ],
      // },
      {
        name: 'split_day',
        type: 'paired',
        sessions: [
          { startTime: '09:00', endTime: '12:00' },
          { startTime: '13:00', endTime: '17:00' }
        ]
      }
    ],
    locations: [
      {
        id: 'duif1ywp', // Must be hardcoded so it matches generated data
        name: 'West of London BSS',
        type: 'hospital',
        isMainSite: true,
        // Main sites can handle all supported risk levels
        riskLevelHandling: ['routine', 'family history'],
        address: {
          line1: 'Breast Screening Unit',
          line2: 'Worthing Hospital',
          line3: 'Lyndhurst Rd',
          line4: 'Headington',
          city: 'Worthing',
          postcode: 'BN11 2DH'
        }
      },
      {
        id: '2yt5dukk', // Must be hardcoded so it matches generated data
        name: 'Mobile Unit JA1 CP7',
        type: 'mobile_unit',
        isMainSite: false,
        clinicTypes: ['screening'], // Can only do screening
        // Mobile units only handle routine screening
        riskLevelHandling: ['routine'],
        registration: 'JA1 CP7'
        // Override BSU session patterns for this location
        // sessionPatterns: [
        //   {
        //     name: 'full_day',
        //     type: 'single',
        //     sessions: [
        //       { startTime: '09:00', endTime: '17:00' },
        //     ],
        //   },
        // ],
      }
      // {
      //   id: 'acxcdcnj', // Must be hardcoded so it matches generated data
      //   name: 'Mobile Unit WX71 HCR',
      //   type: 'mobile_unit',
      //   isMainSite: false,
      //   clinicTypes: ['screening'], // Can only do screening
      //   // Mobile units only handle routine screening
      //   riskLevelHandling: [
      //     'routine',
      //   ],
      //   registration: 'WX71 HCR',
      //   // Override BSU session patterns for this location
      //   sessionPatterns: [
      //     {
      //       name: 'full_day',
      //       type: 'single',
      //       sessions: [
      //         { startTime: '09:00', endTime: '17:00' },
      //       ],
      //     },
      //   ],
      // },
    ]
  }
]
