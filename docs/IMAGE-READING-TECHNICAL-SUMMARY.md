# Image Reading - Technical Summary

This document provides a technical overview of the image reading section of the prototype. It covers data flow, storage patterns, routing, layouts, and areas for refactoring.

---

## Refactoring Plan

### Future Work

- [ ] Clean up data storage of technical recall and recall for assessment
- [ ] Improve data display on review summary list
- [ ] Make location where full medical info can be shown including breast features diagram
- [ ] Existing read UI assumes you're in a batch — might not always be true if retrospectively editing

#### Ideas

- [ ] Should we have UI to let you return to a batch? Index of batches you've worked on?
- [ ] No good way to navigate by person / see people in general
- [ ] No good way to see the size and age of the backlog

#### Summary Pages

Need pages to view completed readings outside the workflow:

- View a single event's readings (both readers' opinions, annotations)
- View all readings for a participant

---

## Overview

The image reading section allows radiologists to review mammogram images from screening appointments and record their assessments (opinions). Key features include:

- Batch-based reading sessions (note: 'batch' is being renamed to 'session')
- Clinic-based reading workflows
- First/second read opinion tracking (double-reading requirement)
- Annotation system for marking abnormalities
- Skip functionality and progress tracking
- Keyboard shortcuts on the opinion page, usable from both the reading page and the PACS viewer window

---

## File Structure

```
app/
├── routes/
│   └── reading.js                    # All reading routes
├── lib/utils/
│   ├── reading.js                    # Reading utility functions
│   └── prior-mammograms.js           # Prior mammogram utilities
├── views/
│   ├── reading/
│   │   ├── index.html               # Reading dashboard/home
│   │   ├── clinics.html             # Clinic list view
│   │   ├── batch.html               # Batch view with event list
│   │   ├── skipped-review.html      # End-of-batch page when skipped cases remain
│   │   ├── history.html             # Reading history
│   │   ├── reading-statistics.html  # Reading statistics dashboard
│   │   ├── create-custom-batch.html # Custom batch creation
│   │   ├── priors.html              # Prior mammogram management (admin/co-ordinator view)
│   │   ├── workflow/                # Reading workflow pages
│   │   │   ├── opinion.html         # Main opinion page (entry point)
│   │   │   ├── normal-details.html  # Optional details for normal opinion
│   │   │   ├── confirm-normal.html  # Confirmation for normal (if enabled)
│   │   │   ├── technical-recall.html   # Technical recall details
│   │   │   ├── recall-for-assessment-details.html  # Per-breast assessment
│   │   │   ├── annotation.html      # Add/edit annotations
│   │   │   ├── confirm-abnormal.html
│   │   │   ├── recommended-assessment.html  # Not currently used in routing
│   │   │   ├── compare.html         # Second-reader comparison page
│   │   │   ├── request-priors.html  # Request prior images during reading
│   │   │   ├── review.html          # Review before saving (non-normal opinions)
│   │   │   └── existing-read.html   # View saved read with change option
│   ├── _includes/reading/
│   │   ├── reading-status-bar.njk   # Batch/clinic context bar
│   │   ├── workflow-navigation.njk  # Prev/next case links
│   │   ├── opinion-banner.njk       # Success banner shown on next case after saving
│   │   ├── opinion-ui.njk           # Opinion selection UI component
│   │   └── image-warnings.njk       # Warnings about image quality
│   └── _templates/
│       └── layout-reading.html      # Reading-specific layout
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
- `readNumber` indicates order (1 = first, 2 = second read, 3 = arbitration read)

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
        positions: { viewKey: [{ x, y }, ...] },  // keyed by mammogram view (e.g. 'RCC')
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
    positions: {},   // JSON string from hidden input, parsed on save
    comment: ''
  },

  // Set after compare page shown; prevents re-showing on save-opinion
  comparisonComplete: true,

  // Set when user wants to add normal details (even if normal is the opinion)
  wantsNormalDetails: true,

  // Set when second reader adopts first reader's opinion via compare page
  adoptedFromFirstReader: true
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
    type: 'all_reads' | 'first_reads' | 'second_reads' | 'awaiting_priors' | 'clinic' | 'custom',
    eventIds: ['event1', 'event2', ...],  // grows one-at-a-time for lazy batches
    targetSize: 25,                        // desired final size (0 = unlimited for clinic batches)
    clinicId: null,  // Only for clinic batches
    createdAt: '2025-01-15T10:00:00.000Z',
    skippedEvents: ['event3'],
    filters: { hasSymptoms, includeAwaitingPriors, complexOnly }
  }
}
```

**Lazy batches**: When `data.settings.reading.lazyBatches === 'true'` (default), non-clinic batches start with only the first event. `topUpBatch()` is called after each read or skip to add the next eligible event, growing the batch one case at a time up to `targetSize`. Clinic batches are always fully populated at creation.

---

## Key Route Patterns

### URL Structure

```
/reading                              # Dashboard
/reading/clinics                      # Clinic list (redirects to /mine)
/reading/clinics/mine                 # Clinics with cases user can read
/reading/clinics/all                  # All clinics
/reading/clinics/:clinicId            # Loads/creates clinic batch, redirects to batch view
/reading/clinics/:clinicId/start      # Creates clinic batch, starts first event
/reading/priors                       # Prior mammogram management (redirects to /all)
/reading/priors/:filter               # Filter: all | not-requested | pending | requested | resolved
/reading/priors/update-status         # POST: Update mammogram request status
/reading/create-batch                 # Creates batch from query params, redirects to first event
/reading/batch/:batchId               # Batch overview (redirects to /your-reads)
/reading/batch/:batchId/skipped-review  # End-of-batch page when skipped cases remain
/reading/batch/:batchId/:view         # Batch with view (your-reads | all-reads)
/reading/batch/:batchId/events/:eventId              # Event entry (redirects to opinion, existing-read, or request-priors)
/reading/batch/:batchId/events/:eventId/:step        # GET: Render workflow step template
/reading/batch/:batchId/events/:eventId/skip         # Skip current event, advance batch
/reading/batch/:batchId/events/:eventId/opinion-answer           # POST: Handle opinion selection → compare or details
/reading/batch/:batchId/events/:eventId/opinion-details-complete # POST: After details → compare (late) or review/save
/reading/batch/:batchId/events/:eventId/technical-recall-answer  # POST: Clean up TR view data
/reading/batch/:batchId/events/:eventId/compare-answer           # POST: Handle comparison decision
/reading/batch/:batchId/events/:eventId/save-opinion             # POST: Persist read, advance batch
/reading/batch/:batchId/events/:eventId/request-priors-answer    # POST: Record prior requests, advance batch
/reading/batch/:batchId/events/:eventId/undo-priors              # GET/POST: Undo user's pending prior requests
/reading/batch/:batchId/events/:eventId/annotation/add           # Clear temp, redirect to annotation form
/reading/batch/:batchId/events/:eventId/annotation/edit/:id      # Load annotation into temp, redirect to form
/reading/batch/:batchId/events/:eventId/annotation/save          # POST: Save annotation with validation
/reading/batch/:batchId/events/:eventId/annotation/delete/:id    # Delete annotation
/reading/history                      # Reading history (redirects to /mine)
/reading/history/:view                # History view (mine | all)
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

The base event URL (`/events/:eventId`) auto-redirects:

- **Not read yet, no priors pending**: Redirects to `/opinion` (clears `imageReadingTemp`)
- **Already read**: Redirects to `/existing-read` (shows saved read with change option)
- **Awaiting priors** (any mammogram has `requestStatus` = `'pending'` or `'requested'`): Redirects to `/existing-read` (shows priors status)

### Normal opinion flow (first reader, or second reader with off/no comparison)

```
/opinion → POST /opinion-answer → [if confirmNormal] /confirm-normal → POST /save-opinion
                                   [otherwise] POST /save-opinion → writeReading() → next event
```

If user selects "Normal – add details": opinion normalised to `normal`, `wantsNormalDetails` set, redirects to `/normal-details` → POST `/opinion-details-complete` → save.

### Technical Recall flow

```
/opinion → POST /opinion-answer → /technical-recall → POST /technical-recall-answer
    → POST /opinion-details-complete → /review → POST /save-opinion
```

### Recall for Assessment flow

```
/opinion → POST /opinion-answer → /recall-for-assessment-details
    [add annotation] → /annotation/add → /annotation → POST /annotation/save → back to details
    → POST /opinion-details-complete → /review → POST /save-opinion
```

### Second-reader comparison

After a first read exists, the second reader may see a `/compare` page. Timing is controlled by `settings.reading.secondReaderComparison`:

- **`'early'`**: `/compare` shown immediately after `opinion-answer`, before detail pages.
- **`'late'`** (default): `/compare` shown after details, via `opinion-details-complete`.
  - Exception: normal opinions (which have no review page) intercept at `opinion-answer`.
- **`'off'`**: comparison page never shown.

The `compareWhen` setting controls when to show the page:

- **`'non_normal'`** (default): whenever either opinion is non-normal
- **`'discordant_only'`**: only when reads disagree meaningfully

On `/compare`, the second reader can:

- **Keep own opinion** → continue to appropriate detail page (or skip to review if details already entered)
- **Adopt first reader's opinion** → copy all first reader data, go straight to `/review`

### Requesting priors during reading

```
/existing-read (shows unrequested priors) → /request-priors
    → POST /request-priors-answer → advances batch, marks mammograms as 'pending'
/existing-read → /undo-priors → rolls back 'pending' requests, redirects to /opinion
```

### Returning to Existing Read

```
/existing-read - View saved read; also shown for awaiting-priors cases
    [Change link] → /opinion (pre-populated from saved read) → normal flow
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

## Utility Functions

### reading.js — Single Event

- `getReadingMetadata(event)` - Returns `{ readCount, uniqueReaderCount, firstReadComplete, secondReadComplete, isDiscordant, opinions }` (computed on demand)
- `getReadsAsArray(event)` - Returns reads sorted by readNumber (or timestamp fallback)
- `getReadsForUser(event, userId)` - Get this user's read object
- `getOtherReads(event, userId)` - Get reads from other users (for comparison)
- `writeReading(event, userId, reading, data, batchId)` - Saves a reading, assigns readNumber, removes from skipped list
- `areReadsDiscordant(readA, readB)` - Compares opinions, TR views, and RFA breast assessments
- `willGoToArbitration(readA, readB, settings)` - Policy-aware: always true if discordant; may be true for concordant non-normal depending on `arbitrationPolicy`
- `getOutcome(event, settings)` - Computes outcome: `not_read` | `pending_second_read` | `arbitration_pending` | `normal` | `technical_recall` | `recall_for_assessment`. Third read (readNumber 3) is the arbitration read and its opinion resolves the case.
- `getComparisonInfo(event, secondReadData, userId, settings)` - Returns comparison data for second reader, or `false` if not applicable
- `shouldShowComparePage(event, secondReadData, userId, settings)` - Boolean: whether to show compare page given timing/filter settings

### reading.js — Multiple Events

- `getReadingStatusForEvents(events, userId)` - Aggregated status with counts
- `getReadingProgress(events, currentEventId, skippedEvents, userId)` - Navigation progress
- `enhanceEventsWithReadingData(events, participants, userId)` - Adds metadata to events
- `sortEventsByScreeningDate(events)` - Oldest-first sort
- `getReadingClinics(data, options)` - All clinics with reading status attached
- `getReadableEventsForClinic(data, clinicId)` - Events in a clinic the user can read

### reading.js — Filter Functions

- `filterEventsByEligibleForReading(events)` - Events within reading window
- `filterEventsByNeedsFirstRead(events)` - No reads yet
- `filterEventsByNeedsSecondRead(events)` - Exactly one read, needs second
- `filterEventsByNeedsAnyRead(events)` - Needs first or second read
- `filterEventsByFullyRead(events, requiredReads)` - Has required number of reads
- `filterEventsByUserCanRead(events, userId)` - Events this user can read
- `filterEventsByUserCanReadOrHasRead(events, userId, options)` - User can read or has read
- `filterEventsByClinic(events, clinicId)` - Filter by clinic
- `filterEventsByDayRange(events, minDays, maxDays)` - Filter by days since screening

### reading.js — Batch Functions

- `createReadingBatch(data, options)` - Creates a batch; lazy batches start with one event
- `topUpBatch(data, batchId)` - Adds next eligible event if batch is below target size
- `getReadingBatch(data, batchId)` - Retrieves batch
- `getOrCreateClinicBatch(data, clinicId)` - Gets/creates clinic-based batch (batched by clinicId)
- `getFirstReadableEventInBatch(data, batchId, userId)` - First event user can read
- `getFirstUserReadableEvent(events, userId)` - First readable event in array
- `getNextUserReadableEvent(events, currentEventId, userId, options)` - Next readable event
- `getResumeEventForUser(events, userId, skippedEvents)` - Resume point (first readable after furthest progress)
- `getBatchReadingProgress(data, batchId, currentEventId, userId)` - Progress including `targetSize` and `targetRemaining`
- `skipEventInBatch(data, batchId, eventId)` - Marks event as skipped

### reading.js — Boolean Checks

- `hasReads(event)` - Has any reads
- `canUserReadEvent(event, userId)` - User can read (not already read, not awaiting priors, under max reads)
- `userHasReadEvent(event, userId)` - User has already read
- `needsFirstRead(event)`, `needsSecondRead(event)`, `needsArbitration(event)` (policy-aware context function)

### prior-mammograms.js

- `awaitingPriors(event)` - Any mammogram has `requestStatus` = `'pending'` or `'requested'`
- `hasUnrequestedPriors(event)` - Any mammogram has `requestStatus` = `'not_requested'`
- `userRequestedPriors(event, userId)` - User has pending requests on this event
- `getPriorsSummary(event)` - Count breakdown by status; `hasAwaiting`, `allResolved` flags
- `getUnrequestedPriors(event)`, `getAwaitingPriors(event)` - Filtered subsets
- `summarisePriorMammogram(mammogram, options)` - One-line display string (location + date)
- `summarisePriorMammograms(event, options)` - Array of display strings

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
- `isDiscordant` - Whether existing reads disagree meaningfully (not just opinion string)
- `opinions` - Array of unique opinion values

For arbitration state, use `getOutcome(event, settings)` or the `needsArbitration` filter.

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
- `enableOpinionDelay` - Enforce lockout period before shortcuts/buttons become active
- `secondReaderComparison` - When to show compare page: `'early'` | `'late'` (default) | `'off'`
- `compareWhen` - Which cases trigger compare: `'non_normal'` (default) | `'discordant_only'`
- `arbitrationPolicy` - When reads go to arbitration: `'discordant_only'` (default) | `'all_non_normal'`
- `lazyBatches` - Build batches lazily one case at a time: `'true'` (default) | `'false'`
- `defaultBatchTargetSize` - Default batch size (default: 25)

**Hard config** (in `config.reading`):

- `priorityThreshold` - Days until "due soon"
- `urgentThreshold` - Days until "urgent"
- `mammogramImageSource` - Image source: `'diagrams'` or `'real'`
- `mammogramViewOrder` - View display order: `'cc-first'` or `'mlo-first'`
- `mammogramTagWeights` - Distribution weights for image set tags (normal/abnormal/indeterminate/technical)

---

## Awaiting Priors

"Priors" are previous mammogram images for a participant from prior screening episodes or other sources (symptomatic mammograms, other BSUs, non-UK facilities). Readers typically want to view priors alongside current images before giving an opinion.

When a reader encounters a case with unrequested priors, they can request them via `/request-priors` in the workflow. The case is then held from reading until the priors arrive or are marked not available.

### Data Model

Priors are stored as an array on the event. Each prior mammogram has its own request status:

```javascript
event.previousMammograms = [
  {
    id: 'abc123',
    location: 'bsu' | 'otherUk' | 'otherNonUk' | 'currentBsu' | 'preferNotToSay',
    bsu: 'St James Hospital',       // if location === 'bsu'
    dateTaken: '2020-03-15',
    requestStatus: 'not_requested' | 'pending' | 'requested' | 'received' | 'not_available' | 'not_needed',
    requestedBy: userId,
    requestedDate: '2025-02-10T...',
    requestReason: 'optional free text'
  }
]
```

A case is "awaiting priors" (`awaitingPriors(event)`) when any mammogram has `requestStatus` = `'pending'` or `'requested'`. This blocks the event from reading queues.

**Status lifecycle**: `not_requested` → `pending` (reader requests via workflow) → `requested` (admin sends IEP request) → `received` | `not_available` | `not_needed`. Once a reader marks status as `pending`, only they can undo it (via `/undo-priors`); once admin moves to `requested`, undo is no longer possible.

### Generation

Prior mammograms are generated at seed time in `event-generator.js` using `generatePreviousMammograms()`. Generation rate is configurable via seed profiles in `seed-profiles.js`.

### Batch behaviour

- By default, awaiting-priors events are **excluded** from all reading batches
- The `awaiting_priors` batch type **only** includes these events
- The `includeAwaitingPriors` filter flag overrides the default exclusion (used by the custom batch creator)

### UI

- The reading dashboard shows an "Awaiting priors" count card linking to a dedicated batch
- Within a batch, awaiting-priors cases show their status on `/existing-read`
- `/reading/priors` is a management view (for co-ordinators) showing all pending requests filterable by status
- Readers can undo their own `pending` requests via `/undo-priors`

---

## Mammogram Viewer (PACS Simulation)

The mammogram viewer simulates a PACS viewer on a separate monitor, displaying mammogram images for the current participant.

### Architecture

- **BroadcastChannel API**: Communication between reading pages and viewer window (channel: `mammogram-viewer`)
- **Image selection utility**: `app/lib/utils/mammogram-images.js` - weighted seeded random selection based on event ID
- **Viewer page**: `app/views/reading/mammogram-viewer.html` - standalone dark-themed page with 2×2 grid

Reading workflow pages broadcast participant/image data to the viewer via `BroadcastChannel` (`mammogram-channel.js`). The viewer updates on each navigation; a ping/pong mechanism prevents duplicate windows from opening. A `clear` message is sent when leaving the workflow. The viewer can be opened manually (header nav link) or automatically on workflow entry if `autoOpenPacsViewer` is enabled.

Image sets are in `app/assets/images/mammogram-diagrams/` with a `manifest.json` listing sets by tag (normal/abnormal/indeterminate/technical). Selection is weighted and deterministic per event ID. Missing views show a placeholder.

### Files

- `app/lib/utils/mammogram-images.js` - Weighted seeded image selection
- `app/assets/javascript/mammogram-channel.js` - BroadcastChannel communication
- `app/views/reading/mammogram-viewer.html` - Standalone viewer page (dark theme, 2×2 grid)
- `app/assets/images/mammogram-diagrams/manifest.json` - Image set metadata
