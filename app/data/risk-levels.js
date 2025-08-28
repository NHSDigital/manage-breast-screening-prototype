// app/data/risk-levels.js

module.exports = {
  'routine': {
    weight: 0.7,
    frequency: 36, // months
    ageRange: {
      upper: 70,
      lower: 50
    }
  },
  'family history': {
    weight: 0.25,
    frequency: 12, // months
    ageRange: {
      upper: 50,
      lower: 40
    }
  },
  'high': {
    weight: 0.05,
    frequency: 12, // months
    ageRange: {
      upper: 70,
      lower: 50
    }
  }
  // veryHigh: {
  //   frequency: 12, // months
  //   ageRange: {
  //     upper: 40,
  //   }
  // }
}
