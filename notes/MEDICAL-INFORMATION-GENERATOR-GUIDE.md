# Medical Information Generator Guide

This document explains how medical information is generated and stored in the seed data system, specifically to guide the implementation of a consolidated medical information generator.

## Overview

The prototype generates seed data to populate a breast screening management system. **Medical information** is the umbrella term covering:

- **Medical history** (breast cancer, mastectomy, implants, etc.) - ✅ _implemented (4 of 7 types)_
- **Symptoms** (lumps, pain, nipple changes, etc.) - ✅ _implemented_
- **HRT** - ✅ _implemented_
- **Pregnancy and breastfeeding** - ✅ _implemented_
- **Other medical information** (freetext) - ✅ _implemented_
- **Breast features** (moles, scars, etc.) - ✅ _implemented_

## Data Architecture

### Storage Locations

#### Participant Object

```javascript
participant: {
  id: string,
  medicalInformation: {
    nhsNumber: string,
    gp: { name, practiceName, address }
  },
}
```

#### Event Object

```javascript
event: {
  id: string,
  participantId: string,
  medicalInformation: {
    symptoms: [],                    // ✅ Array of symptom objects
    hrt: {},                         // ✅ HRT information
    pregnancyAndBreastfeeding: {},   // ✅ Pregnancy and breastfeeding status
    otherMedicalInformation: string, // ✅ Freetext medical info
    breastFeatures: [],              // ✅ Array of breast feature objects
    medicalHistory: {                // Object with arrays for each type
      breastCancer: [],
      mastectomyLumpectomy: [],
      implantedMedicalDevice: [],
      breastImplantsAugmentation: [],
      cysts: [],
      benignLumps: [],
      otherProcedures: []
    }
  }
}
```

**Important:** Medical information is primarily stored at the **event level**, not the participant level. This is intentional as it represents information collected during appointments.

## Generator Pattern

### File Structure

Generators live in `app/lib/generators/` and follow a consistent pattern:

```
app/lib/generators/
├── participant-generator.js                      # Generates participant records
├── event-generator.js                            # Generates event records
├── medical-information-generator.js              # ✅ Umbrella generator for all medical info
├── medical-information/                          # ✅ Subfolder for medical info generators
│   ├── symptoms-generator.js                     # ✅ Generates symptoms
│   ├── hrt-generator.js                          # ✅ Generates HRT data
│   ├── pregnancy-and-breastfeeding-generator.js  # ✅ Generates pregnancy/breastfeeding data
│   ├── other-medical-information-generator.js    # ✅ Generates freetext medical info
│   └── breast-features-generator.js              # ✅ Generates breast features
├── special-appointment-generator.js
└── [new]-generator.js                            # Your new generator here
```

### Generator Template

```javascript
// app/lib/generators/[type]-generator.js

const { faker } = require('@faker-js/faker')
const weighted = require('weighted')
const generateId = require('../utils/id-generator')

// Configuration with weights and options
const CONFIG = {
  // Define options with weights for realistic distribution
  someOption: {
    weight: 0.5,
    values: ['option1', 'option2']
  }
}

/**
 * Generate a single item
 * @param {object} [options] - Generation options
 * @returns {object} Generated item
 */
const generateItem = (options = {}) => {
  return {
    id: generateId(),
    // ... your fields here
    dateAdded: new Date().toISOString(),
    addedByUserId: options.addedByUserId || null
  }
}

/**
 * Generate multiple items
 * @param {object} [options] - Generation options
 * @param {number} [options.probability] - Chance of having any items (0-1)
 * @param {number} [options.maxItems] - Maximum number of items to generate
 * @returns {Array} Array of generated items
 */
const generateItems = (options = {}) => {
  const { probability = 0.15, maxItems = 3 } = options

  // Check if they have any items at all
  if (Math.random() > probability) {
    return []
  }

  // Weighted selection for how many
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

1. **Use weighted randomization** - Makes data feel realistic
2. **Export both singular and plural functions** - Allows flexibility
3. **Accept an options parameter** - Enables overrides for test scenarios
4. **Use faker for realistic fake data** - Generates convincing names, dates, etc.
5. **Generate IDs consistently** - Use the shared `generateId()` utility

## Existing Medical Information Generators

### Symptoms Generator

**File:** `app/lib/generators/symptoms-generator.js`

**Key features:**

- Generates symptoms based on symptom types from `app/data/symptom-types.js`
- Each symptom type has configuration (weight, requiresLocation, descriptions)
- Handles type-specific fields (e.g., nippleChangeType for nipple changes)
- Marks symptoms as significant based on type
- 15% probability of participants having symptoms
- Weighted towards 1 symptom (80%), 2 symptoms (15%), 3 symptoms (5%)

**Data structure:**

```javascript
{
  id: string,
  type: string,                    // e.g., 'Lump', 'Breast pain'
  dateType: string,                // 'dateKnown', 'Less than 3 months', etc.
  hasBeenInvestigated: 'yes'|'no',
  isSignificant: boolean,
  location: string,                // For most types
  // Type-specific fields...
  dateAdded: string (ISO),
  addedByUserId: string
}
```

**Integration:** Called from umbrella generator for completed events only.

### HRT Generator

**File:** `app/lib/generators/medical-information/hrt-generator.js`

**Key features:**

- Generates HRT (hormone replacement therapy) information
- Three status options: currently taking, recently stopped, or no HRT
- Conditional fields populate based on status
- 30% default probability of having HRT data

**Data structure:**

```javascript
{
  hrtQuestion: 'yes' | 'no-recently-stopped' | 'no',
  // If 'yes':
  hrtDuration: string,                    // e.g., '3 years', '18 months'
  // If 'no-recently-stopped':
  hrtDurationSinceStopped: string,        // e.g., 'two weeks ago'
  hrtDurationBeforeStopping: string       // e.g., '5 years'
}
```

**Integration:** Called from umbrella generator for completed events only.

### Pregnancy and Breastfeeding Generator

**File:** `app/lib/generators/medical-information/pregnancy-and-breastfeeding-generator.js`

**Key features:**

- Generates pregnancy and breastfeeding status
- Smart logic: if pregnant → not breastfeeding; if recently pregnant → likely breastfeeding
- Conditional fields populate based on status
- 5% default probability (appropriate for screening age group)

**Data structure:**

```javascript
{
  pregnancyStatus: 'yes' | 'noButRecently' | 'noNotPregnant',
  // If 'yes':
  currentlyPregnantDetails: string,       // e.g., 'due in November'
  // If 'noButRecently':
  recentlyPregnantDetails: string,        // e.g., 'gave birth one month ago'

  breastfeedingStatus: 'yes' | 'recentlyStopped' | 'no',
  // If 'yes':
  currentlyBreastfeedingDuration: string, // e.g., 'for 6 months'
  // If 'recentlyStopped':
  recentlyBreastfeedingDuration: string   // e.g., 'two weeks ago'
}
```

**Integration:** Called from umbrella generator for completed events only.

### Other Medical Information Generator

**File:** `app/lib/generators/medical-information/other-medical-information-generator.js`

**Key features:**

- Generates freetext medical information
- Realistic examples of other health conditions and medications
- Simple string field
- 15% default probability

**Data structure:**

```javascript
string  // e.g., 'Takes warfarin for atrial fibrillation. Last INR check was two weeks ago.'
```

**Integration:** Called from umbrella generator for completed events only.

### Breast Features Generator

**File:** `app/lib/generators/medical-information/breast-features-generator.js`

**Key features:**

- Generates visible breast features marked on anatomical diagram
- Feature types: moles, warts, non-surgical scars, bruising/trauma, other
- Uses anatomical regions from breast diagram with SVG coordinates
- Separate probability controls for having any features vs multiple features
- Smart positioning with slight randomness to avoid perfect centering
- Weighted towards more visible anatomical areas
- Avoids generating multiple features in same region
- 20% default probability of having any features
- 30% chance of multiple if they have any (weighted towards 2 features)

**Data structure:**

```javascript
[
  {
    id: number,                       // Unique ID
    number: number,                   // Display number (1, 2, 3...)
    text: string,                     // e.g., 'Mole', 'Wart', 'Other: Birthmark'
    region: string,                   // Anatomical region name (e.g., 'upper outer')
    side: string,                     // 'left', 'right', or 'center'
    centerX: number,                  // SVG X coordinate for positioning
    centerY: number                   // SVG Y coordinate for positioning
  }
]
```

**Integration:** Called from umbrella generator for completed events only. No user attribution needed (features are visual markers, not clinical records).

## Medical History Types Status

**Implemented (4/7):**
- ✅ Breast cancer
- ✅ Implanted medical device
- ✅ Breast implants/augmentation
- ✅ Mastectomy/lumpectomy

**To implement (3/7):**
- Cysts
- Benign lumps
- Other procedures

## Medical History Types

### Configuration

Medical history types are defined in `app/data/medical-history-types.js`:

```javascript
{
  type: 'breastCancer',           // camelCase - used as data key
  name: 'Breast cancer',          // Display name
  slug: 'breast-cancer',          // kebab-case - used in URLs
  canHaveMultiple: true,          // Can add multiple entries
  yearLabel: 'Diagnosis year'     // Label for year field
}
```

### Common Fields

All medical history items should include:

```javascript
{
  id: string,                      // Unique ID
  dateAdded: string (ISO),         // When added
  addedBy: string,                 // User ID who added it
  procedureYear: string,           // Optional year (if applicable)
  additionalDetails: string,       // Optional free text
  treatmentLocation: string        // Optional location
}
```

### Type-Specific Fields

#### Breast Cancer

- `cancerLocation`: array - ['Right breast', 'Left breast', 'Does not know']
- `proceduresRightBreast`: string - Lumpectomy, Mastectomy types, etc.
- `proceduresLeftBreast`: string
- `otherSurgeryRightBreast`: array - Lymph node surgery, Reconstruction, etc.
- `otherSurgeryLeftBreast`: array
- `treatmentRightBreast`: array - Radiotherapy types
- `treatmentLeftBreast`: array
- `systemicTreatments`: array - Chemotherapy, Hormone therapy, etc.
- `otherTreatmentDetails`: string (if 'Other treatment' selected)

#### Mastectomy/Lumpectomy

- `proceduresRightBreast`: string - Procedure type
- `proceduresLeftBreast`: string
- `otherSurgeryRightBreast`: array - Reconstruction, Symmetrisation
- `otherSurgeryLeftBreast`: array
- `mastectomyLumpectomySurgeryReason`: string - Risk reduction, Gender-affirmation, etc.
- `mastectomyLumpectomySurgeryReasonDetails`: string (if 'Other reason')

#### Breast Implants/Augmentation

- `proceduresRightBreast`: array - Breast implants, Breast reduction, etc.
- `proceduresLeftBreast`: array
- `breastAugmentationReason`: string - Reconstruction, Cosmetic, etc.
- `consentGiven`: 'yes'|'no' (required if breast implants selected)

#### Implanted Medical Device

- `deviceTypes`: array - Pacemaker, Insulin pump, etc.
- `deviceLocation`: string - Location description

#### Cysts

- `cystLocation`: array - Right breast, Left breast, Both breasts
- `lastDrained`: object - { month, year } (optional)

#### Benign Lumps

- `lumpLocation`: array - Right breast, Left breast, Both breasts
- `lumpType`: string - Fibroadenoma, Papilloma, etc.

#### Other Procedures

- `procedureDetails`: string - Free text description
- `procedureLocation`: array - Right breast, Left breast, Both breasts

## Integration Points

### In event-generator.js

✅ **Implemented:** Medical information is added to completed events using the umbrella generator:

```javascript
// Around line 246 in event-generator.js
if (isCompleted(eventStatus)) {
  // Generate medical information (symptoms, medical history, etc.)
  // All attributed to the user who ran the appointment
  const medicalInformation = generateMedicalInformation({
    addedByUserId: event.sessionDetails.startedBy,
    config: participant.config
  })

  // Store medical information if any was generated
  if (Object.keys(medicalInformation).length > 0) {
    event.medicalInformation = medicalInformation
  }
}
```

**Key improvements:**
- ✅ All medical information attributed to `sessionDetails.startedBy` (user who ran the appointment)
- ✅ Default probabilities set only in umbrella generator (single source of truth)
- ✅ Supports config overrides for test scenarios

### ✅ Umbrella Generator (Implemented)

**Goal:** Reduce complexity in `event-generator.js` by creating a unified medical information generator.

✅ **Created:** `app/lib/generators/medical-information-generator.js`

```javascript
// app/lib/generators/medical-information-generator.js

const { generateSymptoms } = require('./medical-information/symptoms-generator')
const { generateHRT } = require('./medical-information/hrt-generator')
const {
  generatePregnancyAndBreastfeeding
} = require('./medical-information/pregnancy-and-breastfeeding-generator')
const {
  generateOtherMedicalInformation
} = require('./medical-information/other-medical-information-generator')
const {
  generateBreastFeatures
} = require('./medical-information/breast-features-generator')

/**
 * Generate complete medical information for an event
 *
 * All medical information is attributed to the user who ran the appointment
 *
 * @param {object} options - Generation options
 * @param {string} [options.addedByUserId] - User ID who collected this information
 * @param {number} [options.probabilityOfSymptoms=0.85] - Chance of having symptoms
 * @param {number} [options.probabilityOfHRT=0.30] - Chance of having HRT data
 * @param {number} [options.probabilityOfPregnancyBreastfeeding=0.05] - Chance of pregnancy/breastfeeding
 * @param {number} [options.probabilityOfOtherMedicalInfo=0.15] - Chance of other medical info
 * @param {number} [options.probabilityOfBreastFeatures=0.20] - Chance of having breast features
 * @param {object} [options.config] - Participant config for overrides
 * @returns {object} Complete medicalInformation object
 */
const generateMedicalInformation = (options = {}) => {
  const {
    addedByUserId,
    probabilityOfSymptoms = 0.85,
    probabilityOfHRT = 0.30,
    probabilityOfPregnancyBreastfeeding = 0.05,
    probabilityOfOtherMedicalInfo = 0.15,
    probabilityOfBreastFeatures = 0.20,
    config
  } = options

  const medicalInfo = {}

  // Generate symptoms
  const symptoms = generateSymptoms({
    probabilityOfSymptoms,
    addedByUserId
  })

  if (symptoms.length > 0) {
    medicalInfo.symptoms = symptoms
  }

  // Generate HRT information
  const hrt = generateHRT({
    probability: probabilityOfHRT
  })

  if (hrt) {
    medicalInfo.hrt = hrt
  }

  // Generate pregnancy and breastfeeding information
  const pregnancyAndBreastfeeding = generatePregnancyAndBreastfeeding({
    probability: probabilityOfPregnancyBreastfeeding
  })

  if (pregnancyAndBreastfeeding) {
    medicalInfo.pregnancyAndBreastfeeding = pregnancyAndBreastfeeding
  }

  // Generate other medical information
  const otherMedicalInformation = generateOtherMedicalInformation({
    probability: probabilityOfOtherMedicalInfo
  })

  if (otherMedicalInformation) {
    medicalInfo.otherMedicalInformation = otherMedicalInformation
  }

  // Generate breast features
  const breastFeatures = generateBreastFeatures({
    probabilityOfAnyFeatures: probabilityOfBreastFeatures,
    config
  })

  if (breastFeatures && breastFeatures.length > 0) {
    medicalInfo.breastFeatures = breastFeatures
  }

  // Future: Add medical history generation here
  // const medicalHistory = generateMedicalHistory({
  //   addedByUserId,
  //   probability: 0.20,
  //   config
  // })
  // if (Object.keys(medicalHistory).length > 0) {
  //   medicalInfo.medicalHistory = medicalHistory
  // }

  return medicalInfo
}

module.exports = {
  generateMedicalInformation
}
```

**Key points:**
- ✅ Default probabilities set here (single source of truth)
- ✅ Passes `addedByUserId` to all sub-generators
- ✅ Medical info generators organized in `medical-information/` subfolder
- ✅ Breast features generation integrated

### ✅ Medical History Generator (Implemented)

**File:** `app/lib/generators/medical-information/medical-history-generator.js`

**Implemented types:**
- ✅ Breast cancer (can have multiple)
- ✅ Implanted medical device (can have multiple)
- ✅ Breast implants/augmentation (single entry, includes consent)
- ✅ Mastectomy/lumpectomy (can have multiple)

**Remaining types:**
- Cysts (single entry only)
- Benign lumps (can have multiple)
- Other procedures (can have multiple)

**Notes:**
- All field names corrected to match forms (`year` not `procedureYear`, `location` not `treatmentLocation`)
- Currently set to 100% probability for all types (testing mode)
- Each type has independent probability check allowing multiple types per event

## Common Patterns & Helpers

### Weighted Random Selection

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

### Generating Dates

```javascript
const dayjs = require('dayjs')

// Random date in past
const date = faker.date.past({ years: 5 })

// Specific date format
const year = dayjs().subtract(faker.number.int({ min: 1, max: 10 }), 'year').year()

// Month and year object (common pattern)
const dateObject = {
  month: faker.number.int({ min: 1, max: 12 }),
  year: faker.number.int({ min: 2015, max: 2024 })
}
```

### Avoiding Duplicates

```javascript
// Track used types/items to avoid duplicates
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

## Gotchas and Pitfalls

### 1. CamelCase vs Kebab-Case

**Problem:** Medical history types use different casing in different contexts.

- **Data storage:** camelCase (e.g., `breastCancer`)
- **URLs:** kebab-case (e.g., `breast-cancer`)
- **Display:** Sentence case (e.g., 'Breast cancer')

**Solution:** The routes handle this conversion. Stick to camelCase in generated data.

```javascript
// In events.js routes
const dataKey = getMedicalHistoryKeyFromSlug(type) || type
// Converts 'breast-cancer' → 'breastCancer'
```

### 2. Event vs Participant Storage

**Problem:** It's tempting to store medical history on the participant.

**Solution:** Medical information goes on events, not participants. This represents information collected during appointments.

### 3. Multiple Entries

**Problem:** Some types can have multiple entries, some cannot.

**Solution:** Check the `canHaveMultiple` flag in `medical-history-types.js`. Store as array regardless, but limit generation accordingly.

```javascript
const typeConfig = medicalHistoryTypes.find(t => t.type === 'cysts')
const maxItems = typeConfig.canHaveMultiple ? 3 : 1
```

### 4. Required vs Optional Fields

**Problem:** Some fields are always required, some only in certain conditions.

**Solution:**

- Always include: `id`, `dateAdded`, `addedBy`
- Conditionally include based on other selections
- Make `procedureYear`, `additionalDetails`, `treatmentLocation` optional
- Check underlying form views to see how data is collected

```javascript
// Example: Only include details if 'Other' was selected
if (item.reason === 'Other reason') {
  item.reasonDetails = faker.lorem.sentence()
}
```

### 5. Probability Management

**Problem:** Too many participants with medical history looks unrealistic.

**Solution:** Use layered probabilities:

1. 20% chance of ANY medical history
2. If yes, weighted selection of which types (favour common ones)
3. For each type, weighted selection of how many entries (favour 1)

```javascript
// Layer 1: Any medical history?
if (Math.random() > 0.20) return {}

// Layer 2: Which types?
const numberOfTypes = weighted.select({
  1: 0.6,
  2: 0.3,
  3: 0.1
})

// Layer 3: How many of each type? (if canHaveMultiple)
const numberOfItems = weighted.select({
  1: 0.8,
  2: 0.15,
  3: 0.05
})
```

### 6. User IDs

**Problem:** Need to attribute who added medical information.

**Solution:** event generator sets a user who completed the appointment - use this user when attributing data

### 7. Test Scenarios & Explicit Overrides

**Problem:** Need specific test data for user research, but test scenarios are awkwardly implemented and passed around.

**Current state:** Test scenarios in `app/data/test-scenarios.js` allow overriding participant/event data, but the implementation is clunky:

- Passed through multiple function calls
- Inconsistent parameter naming
- Hard to track what can be overridden

**Solution:** Support both complete overrides and forced inclusion in your generators.

#### Complete Override (Replace All)

```javascript
// Medical history generator
const generateMedicalHistory = (options = {}) => {
  // Allow complete override for test scenarios
  if (options.medicalHistory) {
    return options.medicalHistory
  }

  // Normal generation...
}
```

#### Forced Inclusion (Guarantee Specific Items)

```javascript
// Medical history generator
const generateMedicalHistory = (options = {}) => {
  const {
    forceMedicalHistoryTypes = [],  // Force specific types to be included
    users = []
  } = options

  const history = {}

  // First, generate any forced types
  forceMedicalHistoryTypes.forEach(type => {
    if (type === 'breastCancer') {
      history.breastCancer = generateBreastCancerHistory({ users })
    }
    // ... other types
  })

  // Then add random types if we want more variety
  if (Math.random() < someOtherProbability) {
    // Add additional random types...
  }

  return history
}
```

#### Example Usage in Test Scenarios

```javascript
// app/data/test-scenarios.js
{
  participant: {
    id: 'test-123',
    config: {
      // Force this participant to have specific medical history
      forceMedicalHistoryTypes: ['breastCancer', 'implantedDevice'],

      // Or provide complete medical history data
      medicalHistory: {
        breastCancer: [{
          id: 'bc-001',
          cancerLocation: ['Left breast'],
          proceduresLeftBreast: 'Lumpectomy',
          procedureYear: '2018'
        }]
      }
    }
  }
}
```

#### Pattern for Umbrella Generator

```javascript
// medical-information-generator.js
const generateMedicalInformation = (options = {}) => {
  const { config } = options
  const medicalInfo = {}

  // Generate symptoms (with possible override)
  const symptoms = generateSymptoms({
    ...options,
    forceSymptomTypes: config?.forceSymptomTypes
  })
  if (symptoms.length > 0) {
    medicalInfo.symptoms = symptoms
  }

  // Generate medical history (with possible override)
  const medicalHistory = generateMedicalHistory({
    ...options,
    medicalHistory: config?.medicalHistory,  // Complete override
    forceMedicalHistoryTypes: config?.forceMedicalHistoryTypes  // Force types
  })
  if (Object.keys(medicalHistory).length > 0) {
    medicalInfo.medicalHistory = medicalHistory
  }

  return medicalInfo
}
```

**Note:** This is a known issue - test scenarios work but could be better architected in future refactoring.

### 8. Breast-Specific Fields

**Problem:** Many medical history types ask about left/right breast separately.

**Solution:** Use consistent field naming pattern:

```javascript
{
  proceduresRightBreast: string | array,
  proceduresLeftBreast: string | array,
  // Can have different values/selections for each side
}
```

Not all participants will have procedures on both breasts - weight accordingly:

```javascript
const breastSelection = weighted.select({
  'right-only': 0.4,
  'left-only': 0.4,
  'both': 0.15,
  'neither': 0.05
})
```

### 9. Date Flexibility

**Problem:** Not all dates are known precisely.

**Solution:** Support multiple date formats:

- Specific date: `{ day, month, year }`
- Month/Year: `{ month, year }`
- Year only: `{ year }`
- Approximate: `"About 3 years ago"`

```javascript
const dateType = weighted.select({
  'year-only': 0.6,
  'month-year': 0.3,
  'unknown': 0.1
})
```

### 10. Consistency Within Event

**Problem:** Data should be consistent (e.g., if they had breast cancer, relevant procedures should be present).

**Solution:** Generate related fields together and check for consistency:

```javascript
// If they had breast cancer on right side, they should have procedures
if (cancerLocation.includes('Right breast')) {
  proceduresRightBreast = generateCancerProcedure('right')
}
```

### 11. Inconsistent Generator Arguments

**Problem:** Generator function arguments have evolved organically and are inconsistent.

**Examples of inconsistency:**

- Some generators accept `{ users }`, others `{ addedByUserId }`
- Some use `probability`, others `probabilityOfSymptoms`
- Parameters added over time without refactoring existing ones

**Solution for new generators:**

- Document what parameters you accept
- Try to follow existing patterns where they make sense
- Don't worry about perfect consistency - it's a known issue
- Focus on making your generator work correctly

```javascript
// Your generator - be clear about what you accept
/**
 * @param {object} options
 * @param {number} [options.probability=0.20] - Chance of having medical history
 * @param {Array} [options.users=[]] - Array of user objects for attribution
 * @param {object} [options.config] - Participant config for overrides
 */
const generateMedicalHistory = (options = {}) => {
  // Extract what you need, provide defaults
  const { probability = 0.20, users = [], config } = options
  // ...
}
```

## Data Distribution Priorities

**Important:** This is a prototype for usability testing, not a realistic simulation.

### Prioritize Test Coverage Over Realism

- **Over-include** features you want to test in research sessions
- Don't aim for NHS-realistic statistics
- Make edge cases more common if they're important to test

Should be possible to set general propabilities, but also say that a test scenario has high probabilities.

**Example probabilities for good test coverage:**

```javascript
// Testing-friendly distributions (not realistic)
const MEDICAL_HISTORY_PROBABILITY = 0.30  // 30% have history (higher than real)

const HISTORY_TYPE_WEIGHTS = {
  breastCancer: 0.15,           // 15% (higher to ensure we test this)
  mastectomyLumpectomy: 0.20,   // 20% (common in testing)
  breastImplants: 0.10,         // 10% (higher than real 1-3%)
  implantedDevice: 0.15,        // 15% (higher to test consent flows)
  cysts: 0.20,                  // 20% (common, good for testing)
  benignLumps: 0.15,            // 15%
  otherProcedures: 0.05         // 5%
}
```

### When Realism Matters

Use lower, more realistic probabilities if:

- You want to see what a "normal" clinic day looks like
- Testing search/filtering features (need more records without the feature)
- Demonstrating the system to stakeholders

**Realistic NHS distributions** (for reference only):

- Any medical history: 15-25% of screening participants
- Breast cancer history: 2-5%
- Benign conditions: 10-15%
- Breast implants: 1-3%
- Previous surgery: 3-6%
- Implanted devices: 2-4%

### Recommendation

**Start high** (30-40% probability) to ensure features appear in testing, then adjust down if needed.

## Testing Your Generator

### Manual Testing

1. Run the generator: `node app/lib/generate-seed-data.js`
2. Check generated files in `app/data/generated/`
3. Load the app: `npm run dev`
4. Navigate to events and check medical information displays correctly

### Verification Checklist

- [ ] Data structure matches routes expectations
- [ ] All required fields are present
- [ ] Optional fields appear sometimes, not always
- [ ] Distributions look realistic (not too many/few)
- [ ] Related fields are consistent with each other
- [ ] Different types have different probabilities
- [ ] Data displays correctly in UI
- [ ] Edit/delete flows work with generated data

## Supporting Test Scenarios: Practical Examples

### Example: Medical History with Override Support

Here's how to structure the medical history generator to support test scenarios:

```javascript
// app/lib/generators/medical-history-generator.js

const { faker } = require('@faker-js/faker')
const weighted = require('weighted')
const generateId = require('../utils/id-generator')
const medicalHistoryTypes = require('../../data/medical-history-types')

const BREAST_CANCER_PROCEDURES = {
  'right-only': 0.4,
  'left-only': 0.4,
  'both': 0.15,
  'unknown': 0.05
}

const PROCEDURE_TYPES = [
  'Lumpectomy',
  'Mastectomy (tissue remaining)',
  'Mastectomy (no tissue remaining)',
  'No procedure'
]

const generateBreastCancerItem = (options = {}) => {
  const { addedByUserId } = options

  // Determine which breast(s) affected
  const breastAffected = weighted.select(BREAST_CANCER_PROCEDURES)

  const item = {
    id: generateId(),
    dateAdded: new Date().toISOString(),
    addedBy: addedByUserId
  }

  // Cancer location
  if (breastAffected === 'right-only') {
    item.cancerLocation = ['Right breast']
  } else if (breastAffected === 'left-only') {
    item.cancerLocation = ['Left breast']
  } else if (breastAffected === 'both') {
    item.cancerLocation = ['Right breast', 'Left breast']
  } else {
    item.cancerLocation = ['Does not know']
  }

  // Procedures (if known)
  if (breastAffected !== 'unknown') {
    if (breastAffected === 'right-only' || breastAffected === 'both') {
      item.proceduresRightBreast = faker.helpers.arrayElement(PROCEDURE_TYPES)
    }
    if (breastAffected === 'left-only' || breastAffected === 'both') {
      item.proceduresLeftBreast = faker.helpers.arrayElement(PROCEDURE_TYPES)
    }
  }

  // Year (70% of time)
  if (Math.random() < 0.7) {
    item.procedureYear = faker.number.int({ min: 2010, max: 2023 }).toString()
  }

  // Treatment details (50% of time)
  if (Math.random() < 0.5) {
    item.systemicTreatments = faker.helpers.arrayElements(
      ['Chemotherapy', 'Hormone therapy'],
      { min: 0, max: 2 }
    )
  }

  return item
}

const generateMedicalHistory = (options = {}) => {
  const {
    probability = 0.20,
    users = [],
    medicalHistory,  // Complete override
    forceMedicalHistoryTypes = []  // Force specific types
  } = options

  // Support complete override from test scenarios
  if (medicalHistory) {
    return medicalHistory
  }

  const history = {}
  const addedByUserId = users.length > 0
    ? faker.helpers.arrayElement(users).id
    : null

  // Always generate forced types first
  if (forceMedicalHistoryTypes.includes('breastCancer')) {
    const numberOfItems = weighted.select({
      1: 0.9,
      2: 0.1
    })
    history.breastCancer = Array.from({ length: numberOfItems }, () =>
      generateBreastCancerItem({ addedByUserId })
    )
  }

  // If we have forced types, skip probability check - we already have history
  if (forceMedicalHistoryTypes.length === 0) {
    // Check if they have any medical history (normal random generation)
    if (Math.random() > probability) {
      return {}
    }
  }

  // Generate additional random types (if we want more variety beyond forced types)
  const hasBreastCancer =
    !history.breastCancer && Math.random() < 0.25  // 25% of those with history

  if (hasBreastCancer) {
    const numberOfItems = weighted.select({
      1: 0.9,
      2: 0.1
    })
    history.breastCancer = Array.from({ length: numberOfItems }, () =>
      generateBreastCancerItem({ addedByUserId })
    )
  }

  // Add other types here...

  return history
}

module.exports = {
  generateMedicalHistory,
  generateBreastCancerItem
}
```

### Example: Test Scenario with Medical History

```javascript
// app/data/test-scenarios.js
module.exports = [
  {
    participant: {
      id: 'medical-history-test',
      demographicInformation: {
        firstName: 'Sarah',
        lastName: 'Johnson',
        dateOfBirth: '1965-03-15'
      },
      config: {
        eventId: 'evt-medical-001',
        defaultRiskLevel: 'routine',

        // Force this participant to have breast cancer and implanted device
        forceMedicalHistoryTypes: ['breastCancer', 'implantedMedicalDevice'],

        // Or provide specific medical history data
        // medicalHistory: {
        //   breastCancer: [{
        //     id: 'bc-specific',
        //     cancerLocation: ['Left breast'],
        //     proceduresLeftBreast: 'Lumpectomy',
        //     procedureYear: '2018',
        //     systemicTreatments: ['Chemotherapy', 'Hormone therapy']
        //   }]
        // },

        scheduling: {
          whenRelativeToToday: 0,
          status: 'event_complete',
          approximateTime: '10:00'
        }
      }
    }
  }
]
```

### How Config Flows Through

```javascript
// In event-generator.js
const event = generateEvent({
  slot,
  participant,
  clinic,
  // ...
})

// Inside generateEvent, for completed events:
if (isCompleted(eventStatus)) {
  // Pass participant config to medical information generator
  const medicalInfo = generateMedicalInformation({
    users,
    config: participant.config  // Contains forceMedicalHistoryTypes, etc.
  })

  if (Object.keys(medicalInfo).length > 0) {
    event.medicalInformation = medicalInfo
  }
}
```

## Implementation Progress

### ✅ Completed

1. ✅ **Created umbrella generator:** `app/lib/generators/medical-information-generator.js`
   - Orchestrates all medical information generation
   - Reduces complexity in event-generator.js
   - Calls out to specialized generators
   - Default probabilities set as single source of truth

2. ✅ **Organized file structure:**
   - Moved symptoms generator to `app/lib/generators/medical-information/`
   - Medical info generators now in dedicated subfolder

3. ✅ **Updated event-generator.js:**
   - Replaced direct `generateSymptoms()` calls with `generateMedicalInformation()`
   - Simplified medical information logic
   - All medical info attributed to `sessionDetails.startedBy`

4. ✅ **Fixed user attribution:**
   - All medical information attributed to the user who ran the appointment
   - Consistent across all medical info types

5. ✅ **Implemented symptoms generator:**
   - Moved to `app/lib/generators/medical-information/symptoms-generator.js`
   - 85% default probability
   - Generates realistic symptom data matching form structure

6. ✅ **Implemented HRT generator:**
   - Created `app/lib/generators/medical-information/hrt-generator.js`
   - 30% default probability
   - Conditional fields based on HRT status
   - Data matches form structure exactly

7. ✅ **Implemented pregnancy and breastfeeding generator:**
   - Created `app/lib/generators/medical-information/pregnancy-and-breastfeeding-generator.js`
   - 5% default probability (appropriate for screening age group)
   - Smart conditional logic (pregnant → not breastfeeding, etc.)
   - Data matches form structure exactly

8. ✅ **Implemented other medical information generator:**
   - Created `app/lib/generators/medical-information/other-medical-information-generator.js`
   - 15% default probability
   - Realistic freetext medical information examples
   - Data matches form structure exactly

9. ✅ **Implemented breast features generator:**
   - Created `app/lib/generators/medical-information/breast-features-generator.js`
   - 20% default probability of any features, 30% chance of multiple
   - Generates features on anatomical diagram with SVG coordinates
   - Feature types: moles, warts, non-surgical scars, bruising/trauma, other
   - Smart positioning with regional weighting
   - Integrated into umbrella generator

### Next Steps

1. **Complete remaining medical history types:**
   - Cysts (single entry only)
   - Benign lumps (can have multiple)
   - Other procedures (can have multiple)

2. **Adjust probabilities for realistic data:**
   - Currently all types set to 100% for testing
   - Reduce to realistic levels when testing complete

## Related Files

### Core Files

- `app/lib/generate-seed-data.js` - Main generator orchestration
- `app/lib/generators/event-generator.js` - ✅ Updated to use umbrella generator

### Medical Information Generators

- `app/lib/generators/medical-information-generator.js` - ✅ Umbrella generator (orchestrator)
- `app/lib/generators/medical-information/symptoms-generator.js` - ✅ Symptoms generator
- `app/lib/generators/medical-information/hrt-generator.js` - ✅ HRT generator
- `app/lib/generators/medical-information/pregnancy-and-breastfeeding-generator.js` - ✅ Pregnancy/breastfeeding generator
- `app/lib/generators/medical-information/other-medical-information-generator.js` - ✅ Other medical info generator
- `app/lib/generators/medical-information/breast-features-generator.js` - ✅ Breast features generator
- `app/lib/generators/medical-information/medical-history-generator.js` - ✅ Medical history generator (4 of 7 types)

### Data & Configuration

- `app/data/medical-history-types.js` - Type definitions for medical history

### Routes & Views (for reference)

- `app/routes/events.js` - Routes that handle medical information (shows expected data structure)
- `app/views/events/medical-information/hormone-replacement-therapy.html` - HRT form template
- `app/views/events/medical-information/pregnancy-and-breastfeeding.html` - Pregnancy/breastfeeding form template
- `app/views/events/medical-information/other-medical-information.html` - Other medical info form template
- `app/views/events/medical-information/record-breast-features.html` - Breast features diagram interface
- `app/views/events/medical-information/medical-history/*.html` - Medical history form templates
