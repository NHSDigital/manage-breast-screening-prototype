// app/config.js

// Use this file to change prototype configuration.
const path = require('path')

module.exports = {
  // Service name
  serviceName: 'Manage breast screening',

  // Port to run nodemon on locally
  port: 2000,

  // Automatically stores form data, and send to all views
  useAutoStoreData: 'true',

  // Enable cookie-based session store (persists on restart)
  // Please note 4KB cookie limit per domain, cookies too large will silently be ignored
  useCookieSessionStore: 'false',

  // Enable or disable built-in docs and examples.
  useDocumentation: true,

  paths: {
    generatedData: path.join(__dirname, 'data/generated')
  },

  // Clinic settings
  clinics: {
    // Timings
    slotDurationMinutes: 8,

    // Target percentages
    targetBookingPercent: 130, // 150% represents overbooking (e.g. 60 bookings for 40 slots)
    targetAttendancePercent: 100, // 100% of original capacity (not overbooking)

    // Date range for generating data
    daysToGenerate: 13,
    daysBeforeToday: 11,
    historicPeriodCount: 1, // Number of historic periods to generate

    simulatedTime: '10:30' // 24h format
  },
  reading: {
    blindReading: 'true', // Enable blind reading
    urgentThreshold: 10, // 10 days and over
    priorityThreshold: 7, // 7 days and over
    mammogramImageSource: 'diagrams', // 'diagrams' or 'real'
    // View order for mammogram display: 'cc-first' or 'mlo-first'
    // Right breast views always on left, left breast views on right
    mammogramViewOrder: 'cc-first',
    // Distribution of image set tags (must sum to 1.0)
    // These are the base weights - they get adjusted based on event context
    // (symptoms, imperfect images, etc.)
    opinionBannerDurationMs: 3000,
    mammogramTagWeights: {
      normal: 0.7,
      abnormal: 0.15,
      indeterminate: 0.1,
      technical: 0.05
    }
  },
  screening: {
    outcomes: {
      screening: {
        clear: 0.95,
        needs_further_tests: 0.04,
        cancer_detected: 0.01
      },
      assessment: {
        clear: 0.4,
        needs_further_tests: 0.45,
        cancer_detected: 0.15
      }
    }
  },

  // Data generation settings
  generation: {
    numberOfParticipants: 1000,
    bookingProbability: 0.8 // 80% of slots are booked
  }
}
