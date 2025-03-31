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
    generatedData: path.join(__dirname, 'data/generated'),
  },

  // Clinic settings
  clinics: {
    // Timings
    slotDurationMinutes: 8,

    // Target percentages
    targetBookingPercent: 130, // 150% represents overbooking (e.g. 60 bookings for 40 slots)
    targetAttendancePercent: 100, // 100% of original capacity (not overbooking)

    // Date range for generating data
    daysToGenerate: 18,
    daysBeforeToday: 14,
    historicPeriodCount: 1, // Number of historic periods to generate

    simulatedTime: '11:30', // 24h format
  },
  reading: {
    blindReading: 'true', // Enable blind reading
  },
  screening: {
    outcomes: {
      screening: {
        clear: 0.95,
        needs_further_tests: 0.04,
        cancer_detected: 0.01,
      },
      assessment: {
        clear: 0.4,
        needs_further_tests: 0.45,
        cancer_detected: 0.15,
      },
    },
  },

  // Data generation settings
  generation: {
    numberOfParticipants: 1000,
    bookingProbability: 0.8, // 80% of slots are booked
  },
}
