# Image Reading - Technical Summary

This document provides a technical overview of the image reading section of the prototype. It covers data flow, storage patterns, routing, layouts, and areas for refactoring.

---

## Refactoring Plan

### Future Work

- [ ] Make sure fields correctly save to data.imageReadingTemp
- [ ] Clean up data storage of technical recall and recall for assessment
- [ ] Improve data display on review summary list
- [ ] Make location where full medical info can be shown including breast features diagram
- [ ] existing read ui assumes you're in a batch - might not always be true if retrostpecitvely editing
- [ ] Move away from 'batch' language. 'Session' instead?

#### Ideas

- [ ] Think about moving to a lazy batch system - don't pre-fill the batch, but add to it as we go until full.
- [ ] Should we have UI to let you return to a batch? index of batches you've worked on?
- [ ] No good way to navigate by person / see people in general
- [ ] No good way to see the size and age of the backlog

#### Summary Pages

Need pages to view completed readings outside the workflow:

- View a single event's readings (both readers' opinions, annotations)
- View all readings for a participant
- Reporting/statistics pages

---

## Overview

The image reading section allows radiologists to review mammogram images from screening appointments and record their assessments (opinions). Key features include:

- Batch-based reading sessions
- Clinic-based reading workflows
- First/second read opinion tracking (double-reading requirement)
- Annotation system for marking abnormalities
- Skip functionality and progress tracking
- Keyboard shortcuts for rapid opinion entry

### Keyboard Shortcuts

On the opinion page, keyboard shortcuts allow quick opinion selection:

- **N** - Normal (or Normal with details if participant has symptoms)
- **T** - Technical recall
- **R** - Recall for assessment

These shortcuts work from both the reading page and the PACS viewer window. During the initial lockout period (if enabled), shortcuts are blocked and an alert sound plays.

---

## File Structure

```
app/
├── routes/
│   └── reading.js                    # All reading routes (~1000 lines)
├── lib/utils/
│   └── reading.js                    # Reading utility functions (~1360 lines)
├── views/
│   ├── reading/
│   │   ├── index.html               # Reading dashboard/home
│   │   ├── clinics.html             # Clinic list view
│   │   ├── batch.html               # Batch view with event list
│   │   ├── history.html             # Reading history
│   │   ├── create-custom-batch.html # Custom batch creation
│   │   ├── workflow/                # Reading workflow pages
│   │   │   ├── opinion.html         # Main opinion page (entry point)
│   │   │   ├── normal-details.html  # Optional details for normal opinion
│   │   │   ├── confirm-normal.html  # Confirmation for normal (if enabled)
│   │   │   ├── technical-recall.html   # Technical recall details
│   │   │   ├── recall-for-assessment-details.html  # Per-breast assessment
│   │   │   ├── annotation.html      # Add/edit annotations
│   │   │   ├── confirm-abnormal.html
│   │   │   ├── recommended-assessment.html  # Assessment type selection (old / not currently used)
│   │   │   ├── review.html          # Review before saving (new opinions)
│   │   │   └── existing-read.html   # View saved read with change option
│   ├── _includes/reading/
│   │   ├── reading-status-bar.njk   # Batch/clinic context bar
│   │   └── workflow-navigation.njk  # Prev/next case links
│   └── _templates/
│       └── layout-reading.html      # Reading-specific layout (~60 lines)
```

---

## Data Storage Locations

### 1. Permanent Storage: `event.imageReading.reads`

Final reading opinions are stored on the event object:

```javascript
event.imageReading = {
  reads: {
    [userId]: {
      opinion: 'normal' | 'technical_recall' | 'recall_for_assessment',
      readerId: userId,
      readerType: 'radiologist',
      readNumber: 1, // 1 = first read, 2 = second read
      timestamp: '2025-01-15T10:30:00.000Z',
      // For abnormal opinions, includes per-breast data:
      left: {
        breastAssessment: 'normal' | 'clinical' | 'abnormal',
        comment: 'optional text',
        annotations: [...]
      },
      right: { ... }
    }
  }
}
```

- Keyed by userId - each user can have one reading per event
- Written via `writeReading()` utility function
- `readNumber` indicates order (1 = first, 2 = second read)

### 2. Temporary Storage: `data.imageReadingTemp`

Multi-step form data is stored temporarily during the reading workflow:

```javascript
data.imageReadingTemp = {
  // Event being read (used to detect navigation to different event)
  eventId: 'abc123',

  // Opinion being recorded (saved via form binding)
  opinion: 'normal' | 'technical_recall' | 'recall_for_assessment',

  // Previous opinion (for change detection)
  previousOpinion: 'normal',

  // Optional normal details
  normalDetails: 'Free text explanation',
  symptomsAcknowledged: ['acknowledged'],

  // Technical recall data - view-keyed object for easy iteration
  technicalRecall: {
    views: {
      RMLO: { reason: 'Breast positioning', additionalDetails: 'Movement during exposure' },
      LCC: { reason: 'Image blurred', additionalDetails: '' }
    }
  },

  // Per-breast assessments during abnormal flow
  left: {
    breastAssessment: 'normal',
    comment: '',
    annotations: []
  },
  right: {
    breastAssessment: 'abnormal',
    comment: '',
    annotations: [
      {
        id: 'abc123',
        side: 'right',
        abnormalityType: ['Mass well-defined'],
        levelOfConcern: '4',
        markerPositions: { ... },
        comment: ''
      }
    ]
  },

  // Annotation being edited
  annotationTemp: {
    id: 'abc123',  // null if new
    side: 'right',
    abnormalityType: [],
    levelOfConcern: '',
    markerPositions: {},
    comment: ''
  }
}
```

- Initialised when entering a new event (on GET request only)
- Form fields bind directly via `name="imageReadingTemp[fieldName]"`
- Cleared on final save via `save-opinion` route
- When returning to an already-read event, populated from saved read

### 3. Batch Storage: `data.readingSessionBatches`

Reading batches are stored in session:

```javascript
data.readingSessionBatches = {
  [batchId]: {
    id: 'abc123',
    name: 'All cases needing reads',
    type: 'all_reads' | 'first_reads' | 'second_reads' | 'clinic' | 'custom',
    eventIds: ['event1', 'event2', ...],
    clinicId: null,  // Only for clinic batches
    createdAt: '2025-01-15T10:00:00.000Z',
    skippedEvents: ['event3'],
    filters: { ... }
  }
}
```

---

## Key Route Patterns

### URL Structure

```
/reading                              # Dashboard
/reading/clinics                      # Clinic list (redirects to /mine)
/reading/clinics/:clinicId            # Creates batch, redirects to batch view
/reading/clinics/:clinicId/start      # Creates batch, starts first event
/reading/create-batch                 # Creates batch from query params
/reading/batch/:batchId               # Batch overview (redirects to /your-reads)
/reading/batch/:batchId/:view         # Batch with view (your-reads | all-reads)
/reading/batch/:batchId/events/:eventId              # Event entry (redirects to opinion or existing-read)
/reading/batch/:batchId/events/:eventId/:step        # Workflow step pages
/reading/batch/:batchId/events/:eventId/skip         # Skip current event
/reading/batch/:batchId/events/:eventId/opinion-answer     # POST: Handle opinion selection
/reading/batch/:batchId/events/:eventId/save-opinion       # POST: Save final opinion
/reading/batch/:batchId/events/:eventId/annotation/add     # Start new annotation
/reading/batch/:batchId/events/:eventId/annotation/edit/:id  # Edit annotation
/reading/batch/:batchId/events/:eventId/annotation/save    # Save annotation (POST)
/reading/batch/:batchId/events/:eventId/annotation/delete/:id  # Delete annotation
/reading/history                      # Reading history
```

### Middleware

The route file includes middleware at `/reading/batch/:batchId/events/:eventId` that:

- Validates batch and event exist
- Loads and attaches to `res.locals`:
  - `batch`, `event`, `participant`, `clinic`, `unit`, `location`
  - `progress` (batch reading progress)
  - `eventData` (combined object)
- On GET requests only: Initialises `imageReadingTemp` with `eventId` if not already set for this event
- Populates `imageReadingTemp` from saved read if user has already read this event

---

## Reading Flow

### Event Entry

The base event URL (`/events/:eventId`) auto-redirects based on whether the user has already read:

- **Not read yet**: Redirects to `/opinion` (clears `imageReadingTemp`)
- **Already read**: Redirects to `/existing-read` (shows saved read with change option)

### Normal opinion flow

```
/events/:eventId (redirect to /opinion)
    ↓
/opinion - Select "Normal"
    ↓
POST /opinion-answer
    ↓
[If has symptoms or wants to add details] → /normal-details → POST to /review
    ↓
[Otherwise] → /review
    ↓
POST /save-opinion → writeReading() → next event or batch
```

### Technical Recall Flow

```
/opinion - Select "Technical recall"
    ↓
POST /opinion-answer
    ↓
/technical-recall (select views to retake)
    ↓
POST to /review
    ↓
POST /save-opinion → writeReading() → next event or batch
```

### Abnormal (Recall for Assessment) Flow

```
/opinion - Select "Recall for assessment"
    ↓
POST /opinion-answer
    ↓
/recall-for-assessment-details (per-breast radios, annotation list)
    ↓
[User adds annotations] → /annotation/add → /annotation → POST /annotation/save
    ↓
[Back to details page]
    ↓
/recommended-assessment (select assessment types)
    ↓
POST to /review
    ↓
POST /save-opinion → writeReading() → next event or batch
```

### Returning to Existing Read

```
/events/:eventId (redirect to /existing-read)
    ↓
/existing-read - View saved read with medical summary
    ↓
[Use "Change" link] → /opinion (pre-populated from saved read)
    ↓
[Follow normal flow for selected opinion type]
```

---

## Layout System

### layout-reading.html

Extends `layout-app.html` and provides (~60 lines):

1. **Status bar** (via `reading-status-bar.njk`, shown when `isReadingWorkflow`):
   - Batch/clinic context
   - Progress (X read, Y remaining, Z skipped)
   - Participant details row (name, DOB, NHS number, SX number)

2. **Navigation controls** (in `beforeContent` block):
   - If `showWorkflowNav`: Previous/next case links via `workflow-navigation.njk`
   - Otherwise: Standard back link (can be hidden via `hideBackLink`)

3. **Mammogram viewer toggle** (meta tags for JS):
   - Controls whether PACS viewer appears

### Key Template Variables

Templates receive via `res.locals`:

- `batch` - Current batch object
- `event` - Current event (use `event | getReadingMetadata` to compute metadata)
- `participant` - Participant data
- `clinic`, `unit`, `location` - Clinic context
- `progress` - Reading progress object (includes `previousUserHasRead`, `nextUserHasRead`)
- `batchId`, `eventId` - Route params
- `isReadingWorkflow` - Boolean flag for workflow mode

### Workflow Page Flags

- `showWorkflowNav` - Shows prev/next navigation (used on opinion.html and existing-read.html)
- `hideBackLink` - Hides the default back link
- `back.href`, `back.text` - Customise back link destination

---

## Utility Functions (reading.js)

### Single Event Functions

- `getReadingMetadata(event)` - Returns read counts, disagreement status (computed on demand)
- `getReadsAsArray(event)` - Returns reads sorted by readNumber
- `writeReading(event, userId, reading, data, batchId)` - Saves a reading (auto-assigns readNumber)

### Multiple Event Functions

- `getReadingStatusForEvents(events, userId)` - Aggregated status with counts
- `getReadingProgress(events, currentEventId, skippedEvents, userId)` - Navigation progress
- `enhanceEventsWithReadingData(events, participants, userId)` - Adds metadata to events

### Filter Functions

- `filterEventsByEligibleForReading(events)` - Events ready for reading
- `filterEventsByNeedsFirstRead(events)` - No reads yet
- `filterEventsByNeedsSecondRead(events)` - Has first read, needs second
- `filterEventsByUserCanRead(events, userId)` - Events user can read
- `filterEventsByClinic(events, clinicId)` - Filter by clinic

### Batch Functions

- `createReadingBatch(data, options)` - Creates a batch
- `getReadingBatch(data, batchId)` - Retrieves batch
- `getOrCreateClinicBatch(data, clinicId)` - Gets/creates clinic-based batch
- `getBatchReadingProgress(data, batchId, currentEventId, userId)` - Batch progress
- `skipEventInBatch(data, batchId, eventId)` - Marks event as skipped

### Boolean Checks

- `hasReads(event)` - Has any reads
- `canUserReadEvent(event, userId)` - Can this user read
- `userHasReadEvent(event, userId)` - Has user already read
- `needsFirstRead(event)`, `needsSecondRead(event)`, `needsArbitration(event)`

---

## Key Concepts

### Eligibility for Reading

An event is eligible for reading when:

- Has completed screening
- Is within the reading window (30 days)
- Defined in `lib/utils/status.js` → `eligibleForReading()`

### Double Reading

Each event needs two independent reads:

- First reader records assessment
- Second reader cannot see first reader's opinion (blind reading)
- If opinions disagree → arbitration required

### Reading Metadata

`getReadingMetadata(event)` calculates (computed on demand, not stored):

- `readCount` - Total reads
- `uniqueReaderCount` - Different readers
- `firstReadComplete`, `secondReadComplete`
- `hasDisagreement`, `needsArbitration`
- `opinions` - Array of unique opinion values

Use in templates: `{% set metadata = event | getReadingMetadata %}`

### Reads Array

`getReadsAsArray(event)` returns reads sorted by `readNumber` (or timestamp fallback).

Use in templates: `{% set allReads = event | getReadsAsArray %}`

---

## Configuration

Reading behavior is configured via:

**User settings** (in `data.settings.reading`):

- `confirmNormal` - Require confirmation for normal results
- `showRemaining` - Show remaining counts
- `autoOpenPacsViewer` - Auto-open PACS viewer when entering reading workflow (once per session)

**Hard config** (in `config.reading`):

- `priorityThreshold` - Days until "due soon"
- `urgentThreshold` - Days until "urgent"
- `mammogramImageSource` - Image source: "diagrams" or "real"
- `mammogramTagWeights` - Distribution weights for image set tags (normal/abnormal/indeterminate)

---

## Awaiting Priors

"Priors" are previous mammogram images for a participant. Typically from prior screening episodes, but they could have come from elsewhere (symptomatic mammogram).

When the inital screening happens, participants are asked if they've had any additional mammograms the BSU doesn't know about - and if so, those are recorded. These may be symptomatic or from another BSU or non-uk. Some BSUs will proactively try to get these mammograms, whereas some will wait for image readers to request them. Readers typically want to view priors alongside current images before giving an opinion.

Once these priors have been requested they are 'awaiting priors'. Image reading won't happen until they have been received, or a time limit has passed.

### Data

The flag is stored as a string boolean on the event object:

```javascript
event.hasRequestedImages = 'true' | 'false'
```

There is no stored request date — the date shown in the UI ("Requested 10 Feb 2025") is hardcoded.

### Generation

Set randomly at seed time in `event-generator.js` with a 30% probability of `true`:

```javascript
event.hasRequestedImages = weighted.select({ true: 0.3, false: 0.7 })
```

### Batch behaviour

- By default, awaiting-priors events are **excluded** from all reading batches (first reads, second reads, all reads)
- The `awaiting_priors` batch type **only** includes these events
- The `includeAwaitingPriors` filter flag overrides the default exclusion (used by the custom batch creator)

### UI

- The reading dashboard shows an "Awaiting priors" count card linking to a dedicated batch of those cases
- Within a case, the opinion page shows an "Images requested" tag alongside the hardcoded request date

---

## Mammogram Viewer (PACS Simulation)

The mammogram viewer simulates a PACS viewer on a separate monitor, displaying mammogram images for the current participant.

### Architecture

- **BroadcastChannel API**: Communication between reading pages and viewer window (channel: `mammogram-viewer`)
- **Image selection utility**: `app/lib/utils/mammogram-images.js` - weighted seeded random selection based on event ID
- **Viewer page**: `app/views/reading/mammogram-viewer.html` - standalone dark-themed page with 2×2 grid

### How It Works

1. Reading workflow pages include meta tags with participant/image data
2. `mammogram-channel.js` auto-broadcasts participant data on page load
3. Viewer window listens on BroadcastChannel and updates display
4. Same eventId messages are ignored (prevents flash on navigation within same case)
5. When leaving reading workflow, `clear` message shows placeholder in viewer
6. **Ping/pong mechanism**: Before auto-opening, parent page pings to check if viewer is already open
7. **Request/response**: When viewer opens, it requests current participant data from parent pages

### Opening the Viewer

- **Manual**: "Open PACS viewer" link in header navigation (within reading workflow)
- **Auto-open**: If `autoOpenPacsViewer` setting is enabled, viewer opens automatically when entering reading workflow (only if not already open, detected via ping/pong)

### Image Sets

- Images stored in `app/assets/images/mammogram-diagrams/set-XX/` (or `mammogram-sets/` for real images)
- Each set contains: `rcc.png`, `lcc.png`, `rmlo.png`, `lmlo.png`
- `manifest.json` lists available sets with tags (normal/abnormal/indeterminate) and descriptions
- **Weighted selection**: Image sets selected based on configurable tag weights (default: 70% normal, 20% abnormal, 10% indeterminate)
- Selection is deterministic per event ID (seeded random ensures same participant always gets same images)

### Missing Views

- If a mammogram view is missing from `event.mammogramData.views`, the viewer shows "No image" placeholder instead of that view
- This allows realistic simulation of incomplete mammograms

### Files

- `app/lib/utils/mammogram-images.js` - Image selection utility (weighted random, path generation)
- `app/assets/javascript/mammogram-channel.js` - BroadcastChannel communication (broadcast, listen, ping/pong, auto-open)
- `app/views/reading/mammogram-viewer.html` - Viewer page (dark theme, 2×2 grid, placeholder states)
- `app/views/_templates/layout-reading.html` - Meta tags for viewer data
- `app/views/_templates/layout-base.html` - "Open PACS viewer" link in header nav
- `app/assets/images/mammogram-diagrams/manifest.json` - Image set metadata (25 sets with tags/descriptions)
- `scripts/process-mammogram-sets.sh` - Process raw mammogram set screenshots (rename, grayscale, compress)
- `scripts/process-mammogram-images.sh` - Process individual mammogram images (grayscale, compress)
