# Data Generator Reference

This document explains the architecture and patterns used in the seed data generation system.

## Overview

The prototype uses generators to create realistic test data for participants, events, and associated medical information. Data generation follows a hierarchical pattern where each generator can be configured, overridden, and tested independently.

## Architecture

### Data Flow

The main orchestrator is `generate-seed-data.js` which calls generators in sequence:

```
generate-seed-data.js (main orchestrator)
  │
  ├─> participant-generator.js
  │     Creates test participants (with overrides from test scenarios)
  │     Creates random participants
  │     Can create additional participants on-demand during clinic generation
  │
  ├─> clinic-generator.js
  │     Creates clinics with slots for each BSU
  │
  ├─> event-generator.js
  │     Creates events by assigning participants to clinic slots
  │     │
  │     └─> medical-information-generator.js (for completed events only)
  │           ├─> symptoms-generator.js
  │           ├─> hrt-generator.js
  │           ├─> pregnancy-and-breastfeeding-generator.js
  │           ├─> other-medical-information-generator.js
  │           ├─> breast-features-generator.js
  │           └─> medical-history-generator.js
  │
  └─> reading-generator.js
        Adds reading/outcome data to events
```

**Key points:**

- Generators are called sequentially by the main orchestrator
- Medical information is only generated for **completed events**
- Participants are mostly created upfront, but can be generated on-demand
- Reading data is added after all events are created

### Storage Locations

**Participant level:**

- Basic demographics
- NHS number, GP details
- Persistent information

**Event level:**

- Medical information collected during appointments
- Session details (who, when, where)
- Event-specific data

**Key principle:** Medical information is stored at the **event level**, representing data collected during specific appointments.

## Generator Pattern

### Standard Structure

```javascript
// app/lib/generators/[name]-generator.js

const { faker } = require('@faker-js/faker')
const weighted = require('weighted')
const generateId = require('../utils/id-generator')

/**
 * Generate a single item
 * @param {object} [options] - Generation options
 * @returns {object} Generated item
 */
const generateItem = (options = {}) => {
  return {
    id: generateId(),
    // ... fields here
    dateAdded: new Date().toISOString(),
    addedByUserId: options.addedByUserId || null
  }
}

/**
 * Generate multiple items with probability controls
 * @param {object} [options] - Generation options
 * @param {number} [options.probability] - Chance of having any items (0-1)
 * @param {number} [options.maxItems] - Maximum number of items
 * @returns {Array} Array of generated items
 */
const generateItems = (options = {}) => {
  const { probability = 0.15, maxItems = 3 } = options

  // Layer 1: Do they have any at all?
  if (Math.random() > probability) {
    return []
  }

  // Layer 2: How many?
  const numberOfItems = weighted.select({
    1: 0.7,
    2: 0.2,
    3: 0.1
  })

  // Generate items
  return Array.from({ length: Math.min(numberOfItems, maxItems) }, () =>
    generateItem(options)
  )
}

module.exports = {
  generateItem,
  generateItems
}
```

### Key Principles

1. **Export both singular and plural functions** - Flexibility for different use cases
2. **Accept options parameter** - Enables configuration and overrides
3. **Use weighted randomization** - Creates realistic distributions
4. **Use faker for realistic data** - Convincing names, dates, text
5. **Generate IDs consistently** - Use shared `generateId()` utility

## Probability Management

### Layered Probabilities

Use multiple probability layers to create realistic distributions:

```javascript
// Layer 1: Overall probability - do they have ANY medical history?
if (Math.random() > 0.20) return {}

// Layer 2: Which types do they have?
const numberOfTypes = weighted.select({
  1: 0.6,
  2: 0.3,
  3: 0.1
})

// Layer 3: How many of each type?
const numberOfItems = weighted.select({
  1: 0.8,
  2: 0.15,
  3: 0.05
})
```

### Weighted Selection

```javascript
const weighted = require('weighted')

// Select one item based on weights
const choice = weighted.select({
  'option1': 0.7,  // 70% chance
  'option2': 0.2,  // 20% chance
  'option3': 0.1   // 10% chance
})

// Select multiple items
const items = weighted.select(
  ['item1', 'item2', 'item3'],
  [0.5, 0.3, 0.2],
  2  // select 2 items
)
```

### Default Probabilities

Set default probabilities in the generator, allow overrides via options:

```javascript
const generateMedicalInformation = (options = {}) => {
  const {
    probabilityOfSymptoms = 0.85,  // Default: 85%
    probabilityOfHRT = 0.30,       // Default: 30%
    config  // May contain overrides
  } = options

  // Use defaults unless overridden
  const symptoms = generateSymptoms({
    probability: probabilityOfSymptoms,
    ...options
  })
}
```

## Configuration & Overrides

### Test Scenarios

Test scenarios live in `app/data/test-scenarios.js` and allow creating specific test cases:

```javascript
// app/data/test-scenarios.js
module.exports = [
  {
    participant: {
      id: 'test-scenario-001',
      demographicInformation: {
        firstName: 'Sarah',
        lastName: 'Test'
      },
      config: {
        // Event configuration
        eventId: 'evt-001',
        scheduling: {
          whenRelativeToToday: 0,
          status: 'event_complete'
        },

        // Generator overrides
        forceMedicalHistoryTypes: ['breastCancer'],
        probabilityOfSymptoms: 1.0  // Force symptoms
      }
    }
  }
]
```

### Override Patterns

**Pattern 1: Complete Override** - Replace all generated data

```javascript
const generateItems = (options = {}) => {
  // Allow complete override from test scenarios
  if (options.items) {
    return options.items
  }

  // Normal generation...
}
```

**Pattern 2: Forced Inclusion** - Guarantee specific items appear

```javascript
const generateItems = (options = {}) => {
  const { forceTypes = [] } = options
  const items = []

  // First, generate forced types
  forceTypes.forEach(type => {
    items.push(generateItem({ type }))
  })

  // Then add random types if desired
  if (Math.random() < someProbability) {
    // Add additional items...
  }

  return items
}
```

**Pattern 3: Probability Override** - Control likelihood

```javascript
const generateItems = (options = {}) => {
  const {
    probability = 0.15,  // Default
    config
  } = options

  // Config can override probability
  const actualProbability = config?.probabilityOverride ?? probability

  if (Math.random() > actualProbability) {
    return []
  }

  // Generate items...
}
```

### Config Flow

Configuration flows from test scenarios through the generator hierarchy:

```javascript
// In event-generator.js
const event = generateEvent({
  participant,  // Contains participant.config
  // ...
})

// Inside generateEvent, for completed events:
const medicalInfo = generateMedicalInformation({
  addedByUserId: event.sessionDetails.startedBy,
  config: participant.config  // Pass config down
})

// In medical-information-generator.js
const symptoms = generateSymptoms({
  ...options,
  forceSymptomTypes: config?.forceSymptomTypes  // Use config
})
```

## Umbrella Generator Pattern

For complex data with multiple sub-generators, use an umbrella generator to orchestrate:

```javascript
// app/lib/generators/medical-information-generator.js

const { generateSymptoms } = require('./medical-information/symptoms-generator')
const { generateHRT } = require('./medical-information/hrt-generator')
// ... other generators

const generateMedicalInformation = (options = {}) => {
  const {
    addedByUserId,
    probabilityOfSymptoms = 0.85,
    probabilityOfHRT = 0.30,
    config
  } = options

  const medicalInfo = {}

  // Generate each component
  const symptoms = generateSymptoms({
    probability: probabilityOfSymptoms,
    addedByUserId,
    forceTypes: config?.forceSymptomTypes
  })

  if (symptoms.length > 0) {
    medicalInfo.symptoms = symptoms
  }

  const hrt = generateHRT({
    probability: probabilityOfHRT
  })

  if (hrt) {
    medicalInfo.hrt = hrt
  }

  // Only return if we generated anything
  return medicalInfo
}
```

**Benefits:**

- Single point of orchestration
- Default probabilities in one place
- Simplified integration with parent generators
- Easy to add new sub-generators

## Common Patterns

### Avoiding Duplicates

```javascript
// Track used items to avoid duplicates
const usedTypes = new Set()
const items = []

while (items.length < numberOfItems) {
  const availableTypes = allTypes.filter(type => !usedTypes.has(type))
  if (availableTypes.length === 0) break

  const type = weighted.select(weightsByType(availableTypes))
  items.push(generateItem({ type }))
  usedTypes.add(type)
}
```

### User Attribution

Medical information should be attributed to the user who collected it:

```javascript
// In event-generator.js
if (isCompleted(eventStatus)) {
  const medicalInfo = generateMedicalInformation({
    addedByUserId: event.sessionDetails.startedBy  // Who ran appointment
  })
}

// In sub-generators
const generateItem = (options = {}) => {
  return {
    id: generateId(),
    // ...
    dateAdded: new Date().toISOString(),
    addedByUserId: options.addedByUserId || null
  }
}
```

### Conditional Fields

Only include fields when relevant:

```javascript
const item = {
  id: generateId(),
  status: weighted.select({
    'yes': 0.4,
    'no-recently-stopped': 0.3,
    'no': 0.3
  })
}

// Conditional fields based on status
if (item.status === 'yes') {
  item.duration = faker.helpers.arrayElement(['6 months', '2 years', '5 years'])
} else if (item.status === 'no-recently-stopped') {
  item.durationSinceStopped = faker.helpers.arrayElement(['two weeks ago', 'one month ago'])
  item.durationBeforeStopping = faker.helpers.arrayElement(['3 years', '5 years'])
}
```

### Realistic Date Generation

```javascript
const dayjs = require('dayjs')

// Random past date
const date = faker.date.past({ years: 5 })

// Year only
const year = faker.number.int({ min: 2015, max: 2024 }).toString()

// Month and year object
const monthYear = {
  month: faker.number.int({ min: 1, max: 12 }),
  year: faker.number.int({ min: 2018, max: 2024 })
}

// Relative date
const relativeDate = faker.helpers.arrayElement([
  'about 3 months ago',
  'earlier this year',
  'last summer'
])
```

## Testing & Distributions

### Testing-Friendly vs Realistic

**For user research testing:**

- Higher probabilities to ensure features appear
- 30-40% chance of medical history (vs realistic 15-25%)
- More edge cases than would occur naturally

**For stakeholder demos:**

- Lower, more realistic probabilities
- Reflects actual NHS screening population

### Adjusting Probabilities

```javascript
// Testing mode - high probability
const TESTING_MODE = {
  probabilityOfSymptoms: 0.85,      // 85%
  probabilityOfMedicalHistory: 0.40  // 40%
}

// Realistic mode - lower probability
const REALISTIC_MODE = {
  probabilityOfSymptoms: 0.15,      // 15%
  probabilityOfMedicalHistory: 0.20  // 20%
}
```

Use test scenarios to create specific high-probability cases when needed.

## File Organization

```
app/lib/generators/
├── participant-generator.js          # Generates participant records
├── event-generator.js                # Generates event records
├── medical-information-generator.js  # Umbrella generator
├── medical-information/              # Sub-generators
│   ├── symptoms-generator.js
│   ├── hrt-generator.js
│   └── medical-history-generator.js
└── [new]-generator.js                # New generators here
```

**Naming conventions:**

- `generateItem()` - Single item
- `generateItems()` - Array of items
- `generate[Type]()` - Specific type/variant

## Utilities

### ID Generation

```javascript
const generateId = require('../utils/id-generator')

const item = {
  id: generateId(),  // Generates unique ID
  // ...
}
```

### Faker

```javascript
const { faker } = require('@faker-js/faker')

// Names
faker.person.firstName()
faker.person.lastName()

// Dates
faker.date.past({ years: 5 })
faker.date.future({ years: 2 })

// Selection
faker.helpers.arrayElement(['option1', 'option2', 'option3'])
faker.helpers.arrayElements(['a', 'b', 'c'], { min: 1, max: 2 })

// Text
faker.lorem.sentence()
faker.lorem.paragraph()
```

## Running Generators

```bash
# Generate seed data
node app/lib/generate-seed-data.js

# Generated data stored in
app/data/generated/
```

Generated files are gitignored and created on-demand when the app starts.

## Integration Points

### Main Orchestrator (generate-seed-data.js)

```javascript
// 1. Create test participants with overrides
const testParticipants = testScenarios.map((scenario) => {
  return generateParticipant({
    ethnicities,
    breastScreeningUnits,
    overrides: scenario.participant  // Test scenario overrides
  })
})

// 2. Create random participants
const randomParticipants = Array.from(
  { length: config.generation.numberOfParticipants },
  () => generateParticipant({ ethnicities, breastScreeningUnits })
)

// 3. Generate clinics for each BSU and date
const clinics = generateClinicsForBSU({
  date: date.toDate(),
  breastScreeningUnit: unit
})

// 4. Generate events by allocating participants to slots
const event = generateEvent({
  slot,
  participant,
  clinic,
  outcomeWeights: config.screening.outcomes[clinic.clinicType],
  forceStatus: scenario?.participant?.config?.scheduling?.status
})

// 5. Generate reading data after all events created
const eventsWithReadingData = generateReadingData(
  sortedEvents,
  users
)
```

### In event-generator.js

Medical information is generated for completed events only:

```javascript
// Lines 246-258 in event-generator.js
if (isCompleted(eventStatus)) {
  // Generate medical information (symptoms, medical history, etc.)
  const medicalInformation = generateMedicalInformation({
    addedByUserId: event.sessionDetails.startedBy,
    config: participant.config,
    // Allow config to override probabilities
    ...(participant.config?.medicalInformation || {})
  })

  if (Object.keys(medicalInformation).length > 0) {
    event.medicalInformation = medicalInformation
  }
}
```

### On-Demand Participant Creation

If no participants are available for a slot, a new one is created:

```javascript
// In generate-seed-data.js, inside generateClinicsForDay()
if (availableParticipants.length === 0) {
  const newParticipant = generateParticipant({
    ethnicities,
    breastScreeningUnits: [unit],
    riskLevel: selectedRiskLevel
  })
  participants.push(newParticipant)
  availableParticipants.push(newParticipant)
}
```

## Common Pitfalls

1. **Don't store event data on participants** - Medical information goes on events
2. **Check `canHaveMultiple` flags** - Some types limited to single entry
3. **Pass config through** - Test scenario config must flow to sub-generators
4. **Attribute to correct user** - Use `sessionDetails.startedBy` for medical info
5. **Layer probabilities** - Avoid too many participants with rare conditions
6. **Match form structure** - Generated data must match what forms expect

## Summary

The generator system provides:

- **Hierarchical structure** - Generators call sub-generators
- **Flexible configuration** - Defaults, overrides, test scenarios
- **Realistic distributions** - Weighted probabilities and faker data
- **Testability** - Force specific cases when needed
- **Maintainability** - Consistent patterns and file organization

When creating new generators, follow these patterns for consistency and maintainability.
