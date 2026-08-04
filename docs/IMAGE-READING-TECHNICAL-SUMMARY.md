# Image Reading - Technical Summary

This document provides a technical overview of the image reading section of the prototype. It covers data flow, storage patterns, routing, layouts, and areas for refactoring.

---

## Refactoring Plan

### Future Work

- [ ] Clean up data storage of technical recall and recall for assessment
- [ ] Improve data display on review summary list
- [ ] Make location where full medical info can be shown including breast features diagram
- [ ] Existing read UI assumes you're in a session — might not always be true if retrospectively editing

#### Ideas

- [ ] Should we have UI to let you return to a session? Index of sessions you've worked on?
- [ ] No good way to navigate by person / see people in general
- [ ] No good way to see the size and age of the backlog

#### Summary Pages

Need pages to view completed readings outside the workflow:

- View a single appointment's readings (both readers' opinions, annotations)
- View all readings for a participant

---

## Overview

The image reading section allows radiologists to review mammogram images from screening appointments and record their assessments (opinions). Key features include:

- Session-based reading (a session is a working list of cases, built lazily or up front)
- Clinic-based reading workflows
- First/second read opinion tracking (double-reading requirement)
- Annotation system for marking abnormalities (several UI modes via `annotationsMode`)
- Skip and defer functionality, with progress tracking
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
│   │   ├── index-simple.html        # Reading dashboard/home (default layout)
│   │   ├── index-complex.html       # Reading dashboard/home (via settings.reading.indexLayout)
│   │   ├── clinics.html             # Clinic list view
│   │   ├── session.html             # Session view with appointment list
│   │   ├── skipped-review.html      # End-of-session page when skipped cases remain
│   │   ├── no-more-cases.html       # Shown when a session has no readable cases left
│   │   ├── deferred.html            # Deferred cases list
│   │   ├── history.html             # Reading history
│   │   ├── reading-statistics.html  # Reading statistics dashboard
│   │   ├── create-custom-session.html # Custom session creation
│   │   ├── priors.html              # Prior mammogram management (admin/co-ordinator view)
│   │   ├── batch.html               # Unused — predates the batch→session rename
│   │   ├── workflow/                # Reading workflow pages
│   │   │   ├── opinion.html         # Main opinion page (entry point)
│   │   │   ├── normal-details.html  # Optional details for normal opinion
│   │   │   ├── confirm-normal.html  # Confirmation for normal (if enabled)
│   │   │   ├── technical-recall.html   # Technical recall details
│   │   │   ├── recall-for-assessment-details.html  # Per-breast assessment
│   │   │   ├── annotation.html      # Add/edit annotations
│   │   │   ├── annotate-v2.html     # Newer annotation UI (image-based modes)
│   │   │   ├── confirm-abnormal.html
│   │   │   ├── defer-case.html      # Defer a case out of the reading queue
│   │   │   ├── medical-information.html  # Full medical information view
│   │   │   ├── recommended-assessment.html  # Not currently used in routing
│   │   │   ├── compare.html         # Second-reader comparison page
│   │   │   ├── request-priors.html  # Request prior images during reading
│   │   │   ├── review.html          # Review before saving (non-normal opinions)
│   │   │   └── existing-read.html   # View saved read with change option
│   ├── _includes/reading/
│   │   ├── reading-status-bar.njk   # Session/clinic context bar
│   │   ├── workflow-navigation.njk  # Prev/next case links
│   │   ├── opinion-banner.njk       # Success banner shown on next case after saving
│   │   ├── opinion-ui.njk           # Opinion selection UI component
│   │   ├── image-warnings.njk       # Warnings about image quality
│   │   ├── priors-summary.njk       # Prior mammograms summary
│   │   ├── annotation-form.njk      # Annotation form fields
│   │   ├── annotation-lightbox.njk  # Annotation image lightbox
│   │   ├── annotation-modal.njk     # Annotation modal
│   │   ├── annotations-with-images-progressive.njk  # Annotation UI variant
│   │   └── annotations-with-images-tabbed.njk       # Annotation UI variant
│   └── _templates/
│       └── layout-reading.html      # Reading-specific layout
```

---

## Data Storage Locations

### 1. Permanent Storage: `episode.readingCases[]`

A **reading case** is one set of mammograms being read. Cases live on the
episode, one per image set, and the reads belong to the case:

```javascript
episode.readingCases = [
  {
    id: 'abc12345',
    appointmentId: 'def67890',   // whose images this case covers
    openedDate: '2026-01-15T09:00:00.000Z',
    reads: [
      {
        opinion: 'normal' | 'technical_recall' | 'recall_for_assessment',
        readerId: userId,
        readerType: 'radiologist',
        readType: 'first' | 'second' | 'arbitration',
        readNumber: 1,
        timestamp: '2026-01-15T10:30:00.000Z',
        // For abnormal opinions, includes per-breast data:
        left: {
          breastAssessment: 'normal' | 'clinical' | 'abnormal',
          comment: 'optional text',
          annotations: [...]
        },
        right: { ... }
      }
    ],
    deferral, deferralHistory
  }
]
```

- One case per image set; a technical recall's re-screen opens a second case,
  and the episode's reading state comes from the latest one
- Reads are ordered, at most one per reader, and each records its own `readType`
  — settled when the read is written rather than inferred from position later
- Written via `writeReading()` (appointments) or the case helpers in
  `reading-cases.js`
- Resolve an appointment's case with `getReadingCase(data, appointment)` from
  `episodes.js`

See [data-conventions.md](data-conventions.md) for the state and outcome model.

### 2. Temporary Storage: `data.imageReadingTemp`

Multi-step form data is stored temporarily during the reading workflow:

```javascript
data.imageReadingTemp = {
  // Appointment being read (used to detect navigation to different appointment)
  appointmentId: 'abc123',

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

- Initialised when entering a new appointment (on GET request only)
- Form fields bind directly via `name="imageReadingTemp[fieldName]"`
- Cleared on final save via `save-opinion` route
- When returning to an already-read appointment, populated from saved read

### 3. Session Storage: `data.readingSessions`

Reading sessions (working lists of cases) are stored in session data:

```javascript
data.readingSessions = {
  [sessionId]: {
    id: 'abc123',
    name: 'All cases needing reads',
    type: 'all_reads' | 'first_reads' | 'second_reads' | 'awaiting_priors' | 'clinic' | 'custom',
    appointments: [...],                   // the appointment objects currently in the session
    appointmentIds: ['appointment1', 'appointment2', ...],  // grows one-at-a-time for lazy sessions
    targetSize: 25,                        // desired final size (clinic sessions: however many eligible appointments exist)
    clinicId: null,  // Only for clinic sessions
    createdAt: '2025-01-15T10:00:00.000Z',
    skippedAppointments: ['appointment3'],
    filters: { hasSymptoms, includeAwaitingPriors, complexOnly }
  }
}
```

**Lazy sessions**: When `data.settings.reading.lazySessions === 'true'` (default), non-clinic sessions start with only the first appointment. `topUpSession()` is called after each read or skip to add the next eligible appointment, growing the session one case at a time up to `targetSize`. Clinic sessions are always fully populated at creation.

---

## Key Route Patterns

### URL Structure

```
/reading                              # Dashboard (index-simple or index-complex via settings)
/reading/clinics                      # Clinic list (redirects to /mine)
/reading/clinics/mine                 # Clinics with cases user can read
/reading/clinics/all                  # All clinics
/reading/clinics/:clinicId            # Loads/creates clinic session, redirects to session view
/reading/clinics/:clinicId/start      # Creates clinic session, starts first appointment
/reading/priors                       # Prior mammogram management (redirects to /all)
/reading/priors/:filter               # Filter: all | not-requested | pending | requested | resolved
/reading/priors/update-status         # POST: Update mammogram request status
/reading/create-session               # Creates session from query params, redirects to first appointment
/reading/deferred                     # Deferred cases list
/reading/deferred/undo                # POST: Undo a deferral
/reading/session/:sessionId           # Session overview (redirects to view)
/reading/session/:sessionId/resume    # Resume at the next readable appointment
/reading/session/:sessionId/skipped-review  # End-of-session page when skipped cases remain
/reading/session/:sessionId/no-more-cases   # Shown when no readable cases remain
/reading/session/:sessionId/:view     # Session with view (your-reads | all-reads)
/reading/session/:sessionId/appointments/:appointmentId              # Appointment entry (redirects to opinion, existing-read, or request-priors)
/reading/session/:sessionId/appointments/:appointmentId/:step        # GET: Render workflow step template
/reading/session/:sessionId/appointments/:appointmentId/skip         # Skip current appointment, advance session
/reading/session/:sessionId/appointments/:appointmentId/opinion-answer           # POST: Handle opinion selection → compare or details
/reading/session/:sessionId/appointments/:appointmentId/opinion-details-complete # POST: After details → compare (late) or review/save
/reading/session/:sessionId/appointments/:appointmentId/technical-recall-answer  # POST: Clean up TR view data
/reading/session/:sessionId/appointments/:appointmentId/recall-for-assessment-answer  # POST: Handle RFA details
/reading/session/:sessionId/appointments/:appointmentId/compare-answer           # POST: Handle comparison decision
/reading/session/:sessionId/appointments/:appointmentId/save-opinion             # POST: Persist read, advance session
/reading/session/:sessionId/appointments/:appointmentId/request-priors-answer    # POST: Record prior requests, advance session
/reading/session/:sessionId/appointments/:appointmentId/undo-priors              # GET/POST: Undo user's pending prior requests
/reading/session/:sessionId/appointments/:appointmentId/defer-case-answer        # POST: Defer case out of the queue
/reading/session/:sessionId/appointments/:appointmentId/undo-defer               # POST: Undo a deferral
/reading/session/:sessionId/appointments/:appointmentId/annotation/add           # Clear temp, redirect to annotation form
/reading/session/:sessionId/appointments/:appointmentId/annotation/edit/:annotationId  # Load annotation into temp, redirect to form
/reading/session/:sessionId/appointments/:appointmentId/annotation/save          # POST: Save annotation with validation
/reading/session/:sessionId/appointments/:appointmentId/annotation/delete/:annotationId  # Delete annotation
/reading/session/:sessionId/appointments/:appointmentId/annotate-v2/save         # POST: Save from the newer annotation UI
/reading/session/:sessionId/appointments/:appointmentId/save-annotations-json    # POST: Save annotations posted as JSON
/reading/session/:sessionId/appointments/:appointmentId/save-breast-assessment   # POST: Save per-breast assessment
/reading/history                      # Reading history (redirects to /mine)
/reading/history/:view                # History view (mine | all)
```

### Middleware

The route file includes middleware at `/reading/session/:sessionId/appointments/:appointmentId` that:

- Validates session and appointment exist
- Loads and attaches to `res.locals`:
  - `session`, `appointment`, `participant`, `clinic`, `unit`, `location`
  - `progress` (session reading progress)
  - `appointmentData` (combined object)
  - `sessionId`, `appointmentId`, `isReadingWorkflow`
- On GET requests only: Initialises `imageReadingTemp` with `appointmentId` if not already set for this appointment
- Populates `imageReadingTemp` from saved read if user has already read this appointment

---

## Reading Flow

### Appointment Entry

The base appointment URL (`/appointments/:appointmentId`) auto-redirects:

- **Not read yet, no priors pending**: Redirects to `/opinion` (clears `imageReadingTemp`)
- **Already read**: Redirects to `/existing-read` (shows saved read with change option)
- **Awaiting priors** (any mammogram has `requestStatus` = `'pending'` or `'requested'`): Redirects to `/existing-read` (shows priors status)

### Normal opinion flow (first reader, or second reader with off/no comparison)

```
/opinion → POST /opinion-answer → [if confirmNormal] /confirm-normal → POST /save-opinion
                                   [otherwise] POST /save-opinion → writeReading() → next appointment
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
    → POST /request-priors-answer → advances session, marks mammograms as 'pending'
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
   - Session/clinic context
   - Progress (X read, Y remaining, Z skipped)
   - Participant details row (name, DOB, NHS number, SX number)

2. **Navigation controls** (in `beforeContent` block):
   - If `showWorkflowNav`: Previous/next case links via `workflow-navigation.njk`
   - Otherwise: Standard back link (can be hidden via `hideBackLink`)

3. **Mammogram viewer toggle** (meta tags for JS):
   - Controls whether PACS viewer appears

### Key Template Variables

Templates receive via `res.locals`:

- `session` - Current session object
- `appointment` - Current appointment (use `appointment | getReadingMetadata` to compute metadata)
- `participant` - Participant data
- `clinic`, `unit`, `location` - Clinic context
- `progress` - Reading progress object (includes `previousUserHasRead`, `nextUserHasRead`)
- `sessionId`, `appointmentId` - Route params
- `isReadingWorkflow` - Boolean flag for workflow mode

### Workflow Page Flags

- `showWorkflowNav` - Shows prev/next navigation (used on opinion.html and existing-read.html)
- `hideBackLink` - Hides the default back link
- `back.href`, `back.text` - Customise back link destination

---

## Utility Functions

### reading.js — Single Appointment

- `getReadingMetadata(readingCase, settings)` - Returns `{ readCount, uniqueReaderCount, firstReadComplete, secondReadComplete, isDiscordant, opinions, state, outcome }` (computed on demand). `getAppointmentReadingMetadata(data, appointment)` is the appointment-shaped wrapper.
- `getReadsAsArray(appointment)` - Returns reads sorted by readNumber (or timestamp fallback)
- `getReadForUser(appointment, userId)` - Get this user's read object
- `getOtherReads(appointment, userId)` - Get reads from other users (for comparison)
- `writeReading(data, appointment, userId, reading, sessionId)` - Saves a read onto the appointment's case, settles readNumber and readType, removes from skipped list
- `areReadsDiscordant(readA, readB)` - Compares opinions, TR views, and RFA breast assessments
- `willGoToArbitration(readA, readB, settings)` - Policy-aware: always true if discordant; may be true for concordant non-normal depending on `arbitrationPolicy`
- `getReadingCaseState(readingCase, settings, now)` - Where the case has got to: `awaiting_first_read` | `awaiting_second_read` | `awaiting_finalisation` | `awaiting_arbitration` | `in_arbitration` | `concluded`
- `getReadingCaseOutcome(readingCase, settings, now)` - What it found: `normal` | `technical_recall` | `recall_for_assessment`, or `null` while reading is still under way. The arbitration read, where there is one, is the deciding read.
- `isReadFinalised(read, settings, now)` - Whether a read is finalised: explicitly (`finalisedAt`) or automatically once `settings.reading.finalisationDelay` minutes have passed since the read (`'0'` immediate, `'never'` manual only)
- `getReadingCaseStatus(readingCase, settings, now)` - The facts for status displays: `{ state, finalised, willArbitrate, provisionalOutcome }` - `willArbitrate` is `willGoToArbitration` asked as soon as two reads exist, so "awaiting finalisation, then arbitration" is one state with a destination
- `getComparisonInfo(appointment, secondReadData, userId, settings)` - Returns comparison data for second reader, or `false` if not applicable
- `shouldShowComparePage(appointment, secondReadData, userId, settings)` - Boolean: whether to show compare page given timing/filter settings

### reading.js — Multiple Appointments

- `getReadingStatusForAppointments(appointments, userId)` - Aggregated status with counts
- `getReadingProgress(appointments, currentAppointmentId, skippedAppointments, userId)` - Navigation progress
- `enhanceAppointmentsWithReadingData(appointments, participants, userId)` - Adds metadata to appointments
- `sortAppointmentsByScreeningDate(appointments)` - Oldest-first sort
- `getReadingClinics(data, options)` - All clinics with reading status attached
- `getReadableAppointmentsForClinic(data, clinicId)` - Appointments in a clinic the user can read

### reading.js — Filter Functions

- `filterAppointmentsByEligibleForReading(appointments)` - Appointments within reading window
- `filterAppointmentsByNeedsFirstRead(appointments)` - No reads yet
- `filterAppointmentsByNeedsSecondRead(appointments)` - Exactly one read, needs second
- `filterAppointmentsByNeedsAnyRead(appointments)` - Needs first or second read
- `filterAppointmentsByFullyRead(appointments, requiredReads)` - Has required number of reads
- `filterAppointmentsByUserCanRead(appointments, userId)` - Appointments this user can read
- `filterAppointmentsByUserCanReadOrHasRead(appointments, userId, options)` - User can read or has read
- `filterAppointmentsByClinic(appointments, clinicId)` - Filter by clinic
- `filterAppointmentsByDayRange(appointments, minDays, maxDays)` - Filter by days since screening

### reading.js — Session Functions

- `createReadingSession(data, options)` - Creates a session; lazy sessions start with one appointment
- `getEligibleCandidatesForSession(data, options)` - Eligible appointments for a would-be session
- `getDefaultSessionName(type, clinicId, data)` - Default display name for a session
- `generateSessionId()` - New session id
- `topUpSession(data, sessionId)` - Adds next eligible appointment if session is below target size
- `getReadingSession(data, sessionId)` - Retrieves session
- `getOrCreateClinicSession(data, clinicId)` - Gets/creates clinic-based session (keyed by clinicId)
- `getFirstReadableAppointmentInSession(data, sessionId, userId)` - First appointment user can read
- `getFirstUserReadableAppointment(appointments, userId)` - First readable appointment in array
- `getNextUserReadableAppointment(appointments, currentAppointmentId, userId, options)` - Next readable appointment
- `getResumeAppointmentForUser(appointments, userId, skippedAppointments)` - Resume point (first readable after furthest progress)
- `getSessionReadingProgress(data, sessionId, currentAppointmentId, userId)` - Progress including `targetSize` and `targetRemaining`
- `skipAppointmentInSession(data, sessionId, appointmentId)` - Marks appointment as skipped

### reading.js — Boolean Checks

Appointment-shaped, so they take `data` to resolve the case:

- `canUserReadAppointment(data, appointment, userId)` - User can read (not already read, not awaiting priors, not deferred, under max reads)
- `userHasReadAppointment(data, appointment, userId)` - User has already read

### reading-cases.js — Boolean Checks

Case-shaped, and pure:

- `caseHasReads(readingCase)` - Has any reads
- `isCaseDeferred(readingCase)` - Case has an active deferral
- `isCaseInArbitration(readingCase)` - Released into arbitration (nothing does this yet)
- `caseNeedsFirstRead(readingCase)`, `caseNeedsSecondRead(readingCase)`, `caseNeedsArbitration(readingCase, settings)`
- `canUserReadCase(readingCase, userId)`, `userHasReadCase(readingCase, userId)`

### prior-mammograms.js

- `awaitingPriors(appointment)` - Any mammogram has `requestStatus` = `'pending'` or `'requested'`
- `hasUnrequestedPriors(appointment)` - Any mammogram has `requestStatus` = `'not_requested'`
- `userRequestedPriors(appointment, userId)` - User has pending requests on this appointment
- `getPriorsSummary(appointment)` - Count breakdown by status; `hasAwaiting`, `allResolved` flags
- `getUnrequestedPriors(appointment)`, `getAwaitingPriors(appointment)` - Filtered subsets
- `summarisePriorMammogram(mammogram, options)` - One-line display string (location + date)
- `summarisePriorMammograms(appointment, options)` - Array of display strings

---

## Key Concepts

### Eligibility for Reading

An appointment is eligible for reading when:

- Has completed screening
- Is within the reading window (30 days)
- Defined in `lib/utils/status.js` → `eligibleForReading()`

### Double Reading

Each appointment needs two independent reads:

- First reader records assessment
- Second reader cannot see first reader's opinion (blind reading)
- If opinions disagree → arbitration required

### Reading Metadata

`getReadingMetadata(readingCase, settings)` calculates (computed on demand, not stored):

- `readCount` - Total reads
- `uniqueReaderCount` - Different readers
- `firstReadComplete`, `secondReadComplete`
- `isDiscordant` - Whether existing reads disagree meaningfully (not just opinion string)
- `opinions` - Array of unique opinion values

For arbitration state, use `getReadingCaseState(readingCase, settings)` or the `caseNeedsArbitration` filter.

Use in templates: `{% set metadata = appointment | getReadingMetadata %}`

### Reads Array

`getReadsAsArray(appointment)` returns reads sorted by `readNumber` (or timestamp fallback).

Use in templates: `{% set allReads = appointment | getReadsAsArray %}`

---

## Configuration

Reading behavior is configured via:

**User settings** (in `data.settings.reading`):

- `confirmNormal` - Require confirmation for normal results
- `confirmTechnicalRecall`, `confirmRecallForAssessment` - Require confirmation for those opinions
- `showRemaining` - Show remaining counts
- `autoOpenPacsViewer` - Auto-open PACS viewer when entering reading workflow (once per session)
- `enableOpinionDelay` - Enforce lockout period before shortcuts/buttons become active
- `annotationsMode` - Annotation UI variant: `'without-images'` | `'with-images-simple'` (default) | `'with-images'` | `'with-images-progressive'`
- `indexLayout` - Reading dashboard layout: `'simple'` (default) | `'complex'`
- `secondReaderComparison` - When to show compare page: `'early'` | `'late'` | `'off'` (default)
- `compareWhen` - Which cases trigger compare: `'non_normal'` (default) | `'discordant_only'`
- `arbitrationPolicy` - When reads go to arbitration: `'discordant_only'` (default) | `'all_non_normal'`
- `lazySessions` - Build sessions lazily one case at a time: `'true'` (default) | `'false'`
- `defaultSessionSize` - Default session size (default: 25)

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

Priors are stored as an array on the appointment. Each prior mammogram has its own request status:

```javascript
appointment.previousMammograms = [
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

A case is "awaiting priors" (`awaitingPriors(appointment)`) when any mammogram has `requestStatus` = `'pending'` or `'requested'`. This blocks the appointment from reading queues.

**Status lifecycle**: `not_requested` → `pending` (reader requests via workflow) → `requested` (admin sends IEP request) → `received` | `not_available` | `not_needed`. Once a reader marks status as `pending`, only they can undo it (via `/undo-priors`); once admin moves to `requested`, undo is no longer possible.

### Generation

Prior mammograms are generated at seed time in `appointment-generator.js` using `generatePreviousMammograms()`. Generation rate is configurable via seed profiles in `seed-profiles.js`.

### Session behaviour

- By default, awaiting-priors appointments are **excluded** from all reading sessions
- The `awaiting_priors` session type **only** includes these appointments
- The `includeAwaitingPriors` filter flag overrides the default exclusion (used by the custom session creator)

### UI

- The reading dashboard shows an "Awaiting priors" count card linking to a dedicated session
- Within a session, awaiting-priors cases show their status on `/existing-read`
- `/reading/priors` is a management view (for co-ordinators) showing all pending requests filterable by status
- Readers can undo their own `pending` requests via `/undo-priors`

---

## Deferred cases

A reader can defer a case out of the reading queue (for example to raise it with a colleague) rather than skip or read it.

- Deferral is stored on the reading case: `readingCase.deferral = { deferredAt, deferredBy, reason }`
- Deferring removes any existing read by that user — a deferral withdraws a prior opinion
- `isCaseDeferred(readingCase)` (in `lib/utils/reading-cases.js`) checks for an active deferral
- `getDeferredCases(data)` / `getResolvedDeferrals(data)` (in `lib/utils/reading.js`) build the lists the deferred cases page shows
- Deferred cases are excluded from reading; `/reading/deferred` lists them, and a deferral can be undone (via `/reading/deferred/undo` or the per-case `/undo-defer` route), returning the case to the queue
- The workflow's `defer-case.html` step collects an optional reason (`deferralReason`)

---

## Mammogram Viewer (PACS Simulation)

The mammogram viewer simulates a PACS viewer on a separate monitor, displaying mammogram images for the current participant.

### Architecture

- **BroadcastChannel API**: Communication between reading pages and viewer window (channel: `mammogram-viewer`)
- **Image selection utility**: `app/lib/utils/mammogram-images.js` - weighted seeded random selection based on appointment ID
- **Viewer page**: `app/views/reading/mammogram-viewer.html` - standalone dark-themed page with 2×2 grid

Reading workflow pages broadcast participant/image data to the viewer via `BroadcastChannel` (`mammogram-channel.js`). The viewer updates on each navigation; a ping/pong mechanism prevents duplicate windows from opening. A `clear` message is sent when leaving the workflow. The viewer can be opened manually (header nav link) or automatically on workflow entry if `autoOpenPacsViewer` is enabled.

Image sets are in `app/assets/images/mammogram-diagrams/` with a `manifest.json` listing sets by tag (normal/abnormal/indeterminate/technical). Selection is weighted and deterministic per appointment ID. Missing views show a placeholder.

### Files

- `app/lib/utils/mammogram-images.js` - Weighted seeded image selection
- `app/assets/javascript/mammogram-channel.js` - BroadcastChannel communication
- `app/views/reading/mammogram-viewer.html` - Standalone viewer page (dark theme, 2×2 grid)
- `app/assets/images/mammogram-diagrams/manifest.json` - Image set metadata
