# Utils and filters reference

---
**Auto-generated** — do not edit manually.

- **Generated:** 2026-08-06 08:57 UTC
- **Source:** `app/lib/utils/` and `app/filters/`
- **Regenerate:** `npm run docs`

*All functions in `app/lib/utils/` are automatically available as Nunjucks filters and global functions in templates, and can be imported in route files. Filters in `app/filters/` are Nunjucks-only.*

---

## Table of contents

| File | Purpose | Line |
|---|---|---|
| `dates.js` | Date formatting and calculation using dayjs | 50 |
| `strings.js` | String manipulation: case conversion, formatting, NHS-specific formats (NHS number, phone), pluralisation, and HTML-wrapping helpers for use in templates. | 86 |
| `status.js` | Appointment status checks and display helpers | 121 |
| `participants.js` | Participant lookups and derived data: full/short names, age, clinic history, and risk level. | 145 |
| `appointment-data.js` | Appointment lookups and mutations in session data | 165 |
| `episodes.js` | Episode lookups and stage changes | 179 |
| `clinics.js` | Clinic filtering by time period, slot formatting, and opening hours calculation. | 216 |
| `reading-cases.js` | A reading case is one set of mammograms being read, held on the episode as episode.readingCases[] | 232 |
| `reading.js` | Image reading workflow: read state, progress tracking, batch management, per-user navigation, and filtering | 271 |
| `prior-mammograms.js` | Prior mammogram request state (awaiting, unrequested, resolved) and one-line summary helpers. | 320 |
| `medical-information.js` | Summarise medical history items, symptoms, breast features, and other clinical information into concise display strings. | 339 |
| `annotation-summary.js` | Summarise image reading annotations (abnormality type, level of concern, location) into concise display strings. | 360 |
| `arrays.js` | Array helpers: find by key/id, filter, push (immutable), remove empty | 373 |
| `objects.js` | Object utilities for extracting and flattening values. | 391 |
| `summary-list.js` | NHS summary list helpers: replace empty row values with "Enter X" links or "Not provided" text, and remove the bottom border from the last row. | 401 |
| `random.js` | Seeded random functions for stable prototype data | 412 |
| `referrers.js` | Referrer chain navigation for multi-level back links | 429 |
| `roles-and-permissions.js` | User role checks | 442 |
| `utility.js` | General-purpose type coercion (`falsify`) and limiting utilities. | 460 |
| | | |
| `formatting.js` | Display formatting for yes/no answers and ordinal names. (filter only) | 476 |
| `forms.js` | Injects matching flash error messages into NHS form component configs by field name. (filter only) | 488 |
| `nunjucks.js` | Nunjucks-specific helpers: joining arrays, resolving user names from IDs, template debugging, and template literal support. (filter only) | 500 |
| `tags.js` | Convert status strings to NHS `<strong class="nhsuk-tag">` HTML elements. (filter only) | 514 |
| `markdown.js` | Convert markdown strings to Nunjucks-safe HTML using markdown-it (filter only) | 524 |

---

## Utility functions

Available as Nunjucks filters/globals in templates and importable in route files.

### dates.js

`app/lib/utils/dates.js`

Date formatting and calculation using dayjs. Use these for all date work — formatting, comparison, relative display, and arithmetic. Accepts ISO strings, `[day, month, year]` arrays, and `{day, month, year}` objects throughout.

| Function | Description | Line |
|---|---|---|
| `arrayOrObjectToDateObject(input)` | Convert array [day, month, year] or object {day, month, year} to dayjs object | 26 |
| `monthYearToDateObject(input)` | Convert month/year inputs to dayjs object (defaults to 1st of month) | 64 |
| `isValidDate(dateInput)` | Check if a date input is valid | 103 |
| `formatDate(dateString, [format])` | Format a date in UK format | 145 |
| `formatDateShort(dateString)` | Format a date in UK format with special month abbreviations | 186 |
| `formatMonthYear(input, format)` | Format a month/year to a readable string | 205 |
| `formatTime(dateString, [format])` | Format a time in UK format | 262 |
| `formatTimeString(input)` | Format a time in 12-hour format with special cases for round hours, midday and midnight | 274 |
| `formatTimeRange(times)` | Format clinic session times for display | 302 |
| `formatDateTime(dateString, [format])` | Format a date and time | 313 |
| `formatRelativeDate(dateInput, withoutSuffix)` | Format a date as a relative time | 325 |
| `relativeYear(yearInput)` | Format a year as relative to the current year — e.g. `relativeYear(2025) // 'last year' (if current year is 2026)` | 389 |
| `daysSince(dateInput, [compareDate])` | Calculate the number of days since a given date (positive = past, negative = future) — e.g. `daysSince('2026-03-05') // 7 (if today is 2026-03-12)` | 445 |
| `isToday(dateInput)` | Check if a date is today | 499 |
| `isPast(dateString)` | Check if date is in the past | 543 |
| `isFuture(dateString)` | Check if date is in the future | 553 |
| `isBeforeDate(inputDate, compareDate)` | Check if a date is before another date (at day precision) | 563 |
| `isAfterDate(inputDate, compareDate)` | Check if a date is after another date (at day precision) | 575 |
| `today()` | Get today's date at midnight | 587 |
| `now()` | Get current date and time | 596 |
| `formatDateRange(startDate, endDate)` | Format a date range, collapsing shared day/month/year as appropriate | 605 |
| `getWeekDates(dateString)` | Get calendar week dates | 637 |
| `isWithinDayRange(dateString, minDays, [maxDays], [compareDate])` | Check if a date is within specified age range | 661 |
| `calculateDurationMinutes(startTime, endTime)` | Calculate duration between two times in minutes (rounded up) — e.g. `calculateDurationMinutes("09:00", "10:30") // returns 90` | 693 |
| `add(dateInput, amount, unit)` | Add or subtract time from a date — e.g. `add('2023-01-01', 5, 'weeks') // returns '2023-02-05T00:00:00.000Z'` | 733 |
| `remove(dateInput, amount, unit)` | Remove time from a date (convenience wrapper for add with negative amount) — e.g. `remove('2023-01-01', 2, 'days') // returns '2022-12-30T00:00:00.000Z'` | 780 |
| `toSeason(dateInput)` | Get the season name and year for a given date — e.g. `toSeason('2025-12-01') // 'winter 2025'` | 795 |

### strings.js

`app/lib/utils/strings.js`

String manipulation: case conversion, formatting, NHS-specific formats (NHS number, phone), pluralisation, and HTML-wrapping helpers for use in templates.

| Function | Description | Line |
|---|---|---|
| `sentenceCase(input)` | Convert string to sentence case, removing leading/trailing whitespace — e.g. `sentenceCase('hello world') // 'Hello world'` | 6 |
| `startLowerCase(input)` | Convert string to start with lowercase | 23 |
| `camelCase(input)` | Convert string to camelCase | 35 |
| `kebabCase(input)` | Separate words with hyphens | 51 |
| `snakeCase(input)` | Convert string to snake_case — e.g. `snakeCase('Hello World') // returns 'hello_world'` | 65 |
| `slugify(input)` | Create URL-friendly slug from string | 91 |
| `split(input, separator)` | Split a string using a separator | 105 |
| `addIndefiniteArticle(input)` | Add appropriate indefinite article (a/an) before a word — e.g. `addIndefiniteArticle('apple') // 'an apple'` | 117 |
| `possessive(input)` | Make a string possessive — e.g. `possessive('Smith') // "Smith's"` | 131 |
| `padDigits(input, length)` | Pad a number with leading zeros | 154 |
| `formatCurrency(input)` | Format number as currency with thousands separators | 166 |
| `formatCurrencyForCsv(input)` | Format number as currency without separators (for CSV) | 179 |
| `startsWith(input, target)` | Check if string starts with target | 191 |
| `stringIncludes(input, target)` | Check if string contains substring | 203 |
| `isString(input)` | Check if value is a string | 215 |
| `formatWords(input, [separator])` | Format underscore/separator-separated words as readable text, preserving acronyms — e.g. `formatWords('in_progress') // 'in progress'` | 225 |
| `stringLiteral(str)` | Support for template literals in Nunjucks | 260 |
| `noWrap(input)` | Wrap string in a no-wrap span | 272 |
| `asHint(input)` | Wrap string in a no-wrap span | 283 |
| `asVisuallyHiddenText(input)` | Wrap string in a hidden text span | 294 |
| `asAriaHiddenText(input)` | Wrap string in a span, hiding it from assistive technologies | 306 |
| `formatPhoneNumber(phoneNumber)` | Format phone number for display with spaces | 318 |
| `formatNhsNumber(input)` | Format NHS number with spaces (3-3-4 format) — e.g. `formatNhsNumber('9997773456') // '999 777 3456'` | 337 |
| `formatAccessionNumber(input)` | Format an accession number for display with spaces (ABC YYYYMMDD ##### format) — e.g. `formatAccessionNumber('KOX2026052712345') // 'KOX 20260527 12345'` | 361 |
| `pluralise(word, args)` | Make a word plural based on a count — e.g. `pluralise('cat') // returns 'cats'` | 384 |
| `formatMammogramViewCode(code)` | Format mammogram view code for display | 407 |

### status.js

`app/lib/utils/status.js`

Appointment status checks and display helpers. Use these instead of comparing status strings directly — status values may change but these functions will be updated accordingly.

| Function | Description | Line |
|---|---|---|
| `hasNotStarted(input)` | Check if a status represents a not started appointment | 62 |
| `isCompleted(input)` | Check if a status represents a completed appointment | 74 |
| `isInProgress(input)` | Check if a status represents an in-progress appointment (includes paused) | 86 |
| `isPaused(input)` | Check if a status represents a paused appointment | 98 |
| `isInProgressNotPaused(input)` | Check if a status represents an in-progress appointment that is not paused | 110 |
| `isFinal(input)` | Check if a status represents a final state | 122 |
| `isActive(input)` | Check if a status represents an active appointment | 134 |
| `isAppointmentWorkflow(appointment, currentUser)` | Check if an appointment is in the appointment workflow for the current user | 146 |
| `eligibleForReading(appointment)` | Check if a status indicates reading is eligible | 178 |
| `getStatusTagColour(status, [vocabulary])` | Map a status key to its NHS tag colour string — e.g. `getStatusTagColour('complete', 'appointment') // 'green'` | 324 |
| `getStatusText(status, [vocabulary])` | Map a status key to its display text — e.g. `getStatusText('complete', 'appointment') // 'Screened'` | 338 |
| `filterAppointmentsByStatus(appointments, filter)` | Filter appointments by status category | 352 |
| `isSpecialAppointment(appointment)` | Check if an appointment is a special appointment | 380 |
| `hasAppointmentNote(appointment)` | Check if an appointment has an appointment note | 390 |
| `hasSymptoms(appointment)` | Check if an appointment has recorded symptoms | 400 |

### participants.js

`app/lib/utils/participants.js`

Participant lookups and derived data: full/short names, age, clinic history, and risk level.

| Function | Description | Line |
|---|---|---|
| `getParticipant(data, participantId)` | Get a participant by ID | 7 |
| `getFullName(participant)` | Get full name (first, middle, last) of a participant as a Nunjucks-safe string | 28 |
| `getFirstNames(participant)` | Get first names (first + middle) of a participant as a Nunjucks-safe string | 42 |
| `getFullNameReversed(participant)` | Get full name in reversed 'Last, First Middle' format — e.g. `getFullNameReversed(participant) // 'SMITH, Jane Louise'` | 54 |
| `getShortName(participant)` | Get short name (first + last only) of participant as a Nunjucks-safe string | 68 |
| `findBySXNumber(participants, sxNumber)` | Find a participant by their SX number | 80 |
| `getAge(participant, [referenceDate])` | Get participant's age | 91 |
| `sortBySurname(participants)` | Sort participants by surname | 112 |
| `getCurrentRiskLevel(participant)` | Determine a participant's current risk level based on age and risk factors | 126 |
| `updateParticipant(data, participantId, updatedParticipant)` | Find and update a participant in session data | 159 |
| `saveTempParticipantToParticipant(data)` | Save temporary participant data back to the main participant | 183 |

### appointment-data.js

`app/lib/utils/appointment-data.js`

Appointment lookups and mutations in session data. Includes the temp appointment pattern (`data.appointment` → `data.appointments[]`).

| Function | Description | Line |
|---|---|---|
| `getAppointment(data, appointmentId)` | Get an appointment by ID | 23 |
| `getAppointmentData(data, clinicId, appointmentId)` | Get appointment data bundle for a given clinic and appointment ID | 43 |
| `updateAppointment(data, appointmentId, updatedAppointment)` | Find and update an appointment in session data | 67 |
| `updateAppointmentData(data, appointmentId, updates)` | Update appointment with arbitrary data changes | 86 |
| `saveTempAppointmentToAppointment(data)` | Save temporary appointment data back to the main appointment | 126 |

### episodes.js

`app/lib/utils/episodes.js`

Episode lookups and stage changes. An episode is one screening round - the container its appointments sit in.

| Function | Description | Line |
|---|---|---|
| `appointmentProducedImages(appointment)` | Whether an appointment's status means mammograms were taken. | 98 |
| `buildMammogramEntry(appointment, [clinic])` | Build the episode's summary record of one set of mammograms. | 112 |
| `getEpisode(data, episodeId)` | Get an episode by ID | 153 |
| `getEpisodesForParticipant(data, participantId)` | Get all of a participant's episodes, oldest first | 174 |
| `getCurrentEpisode(data, participantId)` | Get a participant's current episode - their most recent one that hasn't | 204 |
| `getEpisodeAppointments(data, episode)` | Get an episode's appointments, oldest first | 220 |
| `getReadingCase(data, appointment)` | Get the reading case covering an appointment's images. | 235 |
| `getReadingCaseById(data, caseId)` | Find a reading case by its own id, with the episode that holds it. | 255 |
| `getEpisodeReadingCases(episode)` | Get an episode's reading cases, oldest first | 288 |
| `getEpisodeReadingCase(episode)` | Get the case that says where an episode's reading has got to - its latest. | 298 |
| `getEpisodeReadingOutcome(episode, [settings])` | Get an episode's reading outcome, from its latest case. | 308 |
| `updateReadingCase(data, episodeId, updatedCase)` | Save a changed reading case back to its episode. | 323 |
| `syncReadingCasesForAppointment(data, appointment)` | Keep an episode's reading cases in step with one of its appointments. | 349 |
| `isEpisodeClosed(episode)` | Whether an episode has closed | 388 |
| `isEpisodeOpen(episode)` | Whether an episode is still open - anything that hasn't closed, whatever | 398 |
| `getEpisodeMammogramDate(episode)` | When this round's mammograms were taken, from the episode's own record. | 409 |
| `getLastMammogram(data, participantId)` | The participant's last mammogram on record, before today. | 424 |
| `getNextAppointment(data, participantId)` | The participant's next booked appointment, if they have one. | 471 |
| `getEpisodeLabel(episode)` | Human name for an episode. Episodes are named by date, not number - | 497 |
| `getEpisodeStageText(stage)` | Display text for an episode's stage | 513 |
| `getEpisodeStageTagColour(stage)` | Tag colour for an episode's stage | 523 |
| `getEpisodeOutcomeText(outcome)` | Display text for an episode's outcome | 533 |
| `getEpisodeOutcomeTagColour(outcome)` | Tag colour for an episode's outcome | 543 |
| `updateEpisode(data, episodeId, updates)` | Update an episode, persisting the change for this session. | 553 |
| `updateEpisodeStage(data, episodeId, stage, [options])` | Advance an episode to a new stage, appending to its stageHistory. | 586 |
| `syncEpisodeMammogramsForAppointment(data, appointment)` | Keep an episode's mammograms record in step with one of its appointments. | 635 |
| `advanceEpisodeForAppointmentStatus(data, appointment)` | Move an appointment's episode to wherever the appointment's status leaves it. | 675 |
| `advanceEpisodeForReadingOutcome(data, appointment, readingOutcome)` | Move an appointment's episode to wherever its reading outcome leaves it. | 708 |

### clinics.js

`app/lib/utils/clinics.js`

Clinic filtering by time period, slot formatting, and opening hours calculation.

| Function | Description | Line |
|---|---|---|
| `getClinic(data, clinicId)` | Get a clinic by ID | 8 |
| `getClinicLocationName(data, clinic)` | Where a clinic was held, as one line. | 28 |
| `getTodaysClinics(clinics)` | Get today's clinics | 57 |
| `getClinicAppointments(appointments, clinicId)` | Get appointments for a specific clinic | 68 |
| `formatTimeSlot(dateTime)` | Format clinic time slot | 82 |
| `getClinicHours(clinic)` | Get clinic opening hours | 108 |
| `getFilteredClinics(clinics, [filter])` | Get clinics filtered by time period | 126 |

### reading-cases.js

`app/lib/utils/reading-cases.js`

A reading case is one set of mammograms being read, held on the episode as episode.readingCases[]. Pure case logic: reads, read types, case state and outcome, discordance and arbitration, deferral. Everything here takes a case — resolve one from an appointment with getReadingCase in episodes.js.

| Function | Description | Line |
|---|---|---|
| `buildReadingCase(appointment, [openedDate])` | Build a new reading case for one set of images. | 63 |
| `getReadingCases(episode)` | All of an episode's reading cases, oldest first | 86 |
| `getLatestReadingCase(episode)` | An episode's most recent reading case - the one that decides where the | 96 |
| `getReadingCaseForAppointment(episode, appointmentId)` | Find the reading case covering a given appointment's images | 111 |
| `getReadsAsArray(readingCase)` | A case's reads in order, oldest first. | 126 |
| `getReadForUser(readingCase, userId)` | Get one user's read on a case | 139 |
| `getOtherReads(readingCase, userId)` | Get the reads on a case made by anyone other than the given user | 154 |
| `getArbitrationRead(readingCase)` | Get the arbitration read on a case, if one has been made | 165 |
| `userHasReadCase(readingCase, userId)` | Whether a user has read a case | 178 |
| `caseHasReads(readingCase)` | Whether a case has any reads | 189 |
| `isCaseDeferred(readingCase)` | Whether a case has been deferred from reading. | 199 |
| `isCaseInArbitration(readingCase)` | Whether a case has been released into arbitration. | 212 |
| `areReadsDiscordant(readA, readB)` | Whether the reads on a case disagree in a clinically meaningful way. | 226 |
| `willGoToArbitration(readA, readB, [settings])` | Whether two reads mean the case needs arbitrating, taking the site's | 283 |
| `isReadFinalised(read, [settings], [now])` | Whether a read is finalised. | 315 |
| `areAllReadsFinalised(readingCase, [settings], [now])` | Whether every read on a case is finalised | 345 |
| `getReadingCaseState(readingCase, [settings], [now])` | Where a case has got to. | 359 |
| `getReadingCaseOutcome(readingCase, [settings], [now])` | What a case found, or null while reading is still under way. | 394 |
| `getReadingCaseStatus(readingCase, [settings], [now])` | The facts about where a case stands, for composing status displays. | 418 |
| `getReadingMetadata(readingCase, [settings])` | Summary counts and flags for a case, for lists and progress displays | 458 |
| `caseNeedsFirstRead(readingCase)` | Whether a case still needs a first read | 489 |
| `caseNeedsSecondRead(readingCase)` | Whether a case has a first read and still needs a second | 499 |
| `caseNeedsArbitration(readingCase, [settings])` | Whether a case sits in the arbitration backlog - finalised reads whose | 509 |
| `canUserReadCase(readingCase, userId, [options], [options.maxReadsPerCase])` | Whether a user can read a case. | 521 |
| `getComparisonInfo(readingCase, secondReadData, userId, [settings])` | Work out what the second reader should be shown about the first read. | 549 |
| `shouldShowComparePage(readingCase, secondReadData, userId, [settings])` | Whether the compare page should be shown to the second reader. | 598 |
| `buildRead(readingCase, userId, readerType, reading, [options], [options.timestamp])` | Build the read record for a user's opinion on a case. | 637 |
| `withRead(readingCase, read)` | Add or replace a user's read on a case, returning a new case record. | 673 |
| `withReadFinalised(readingCase, userId, [options], [options.finalisedAt], [options.finalisedBy])` | Mark a user's read on a case as finalised, returning a new case record. | 697 |
| `withoutRead(readingCase, userId)` | Remove a user's read from a case, returning a new case record. | 724 |

### reading.js

`app/lib/utils/reading.js`

Image reading workflow: read state, progress tracking, batch management, per-user navigation, and filtering. The appointment- and session-shaped layer over reading cases.

| Function | Description | Line |
|---|---|---|
| `getAppointmentReadingMetadata(data, appointment)` | Get the reading metadata for an appointment's case | 49 |
| `writeReading(data, appointment, userId, reading, [sessionId])` | Save a user's read of an appointment's images, and take the appointment off | 60 |
| `getUnfinalisedUserReadsForSession(data, sessionId, userId)` | The user's not-yet-finalised reads in a session, each with the appointment | 108 |
| `finaliseUserReadsForSession(data, sessionId, userId)` | Finalise the user's outstanding reads from a session, and settle what each | 144 |
| `getEpisodeReadingStatus(data, episode, [userId])` | Get the reading status of an episode. | 204 |
| `getDeferredCases(data)` | Every case currently deferred from reading, most recently deferred first. | 228 |
| `getResolvedDeferrals(data)` | Every deferral that has since been resolved, most recently resolved first. | 254 |
| `enhanceAppointmentsWithReadingData(data, appointments, participants, userId)` | Enhance appointments with their reading case and pre-calculated metadata. | 303 |
| `getReadingStatusForAppointments(data, appointments, [userId])` | Get detailed reading status for a group of appointments | 497 |
| `getReadingProgress(data, appointments, currentAppointmentId, skippedAppointments, [userId])` | Get progress through reading a set of appointments | 544 |
| `sortAppointmentsByScreeningDate(appointments)` | Sort appointments by screening date (oldest first) | 655 |
| `getFirstAvailableClinic(data)` | Get the first clinic that still has appointments needing reads | 675 |
| `getReadingClinics(data, [options])` | Get all clinics available for reading, enriched with unit, location, and reading status | 686 |
| `getReadableAppointmentsForClinic(data, clinicId)` | Get readable appointments for a clinic with pre-calculated metadata | 722 |
| `filterAppointmentsByEligibleForReading(appointments)` | Filter appointments that are eligible for reading | 754 |
| `filterAppointmentsByNeedsAnyRead(data, appointments, maxReadsPerCase)` | Filter appointments that need any read (first or second) | 763 |
| `filterAppointmentsByNeedsFirstRead(data, appointments)` | Filter appointments that need a first read | 778 |
| `filterAppointmentsByNeedsSecondRead(data, appointments)` | Filter appointments that need a second read | 791 |
| `filterAppointmentsByFullyRead(data, appointments, requiredReads)` | Filter appointments that are fully read (have all required reads) | 804 |
| `filterAppointmentsByUserCanRead(data, appointments, userId)` | Filter appointments that a specific user can read | 819 |
| `filterAppointmentsByUserCanReadOrHasRead(data, appointments, userId, [options])` | Filter appointments that user can read or has already read | 833 |
| `filterAppointmentsByClinic(appointments, clinicId)` | Filter appointments for a specific clinic | 866 |
| `filterAppointmentsByDayRange(appointments, minDays, [maxDays])` | Filter appointments that are within a specific day range | 877 |
| `getFirstAppointmentInList(appointments)` | Get the first appointment from an array | 897 |
| `getNextAppointmentInList(appointments, currentAppointmentId, wrap)` | Get the next appointment after a specific appointment | 906 |
| `getPreviousAppointmentInList(appointments, currentAppointmentId, wrap)` | Get the previous appointment before a specific appointment | 927 |
| `getFirstUserReadableAppointment(data, appointments, userId)` | Get first appointment from an array that a user can read | 952 |
| `getNextUserReadableAppointment(data, appointments, currentAppointmentId, [userId])` | Get the next appointment the user can read after the current appointment, wrapping to start if needed | 972 |
| `getResumeAppointmentForUser(data, appointments, [userId], [skippedAppointments])` | Get the appointment the user should resume reading from. | 997 |
| `userHasReadAppointment(data, appointment, [userId])` | Check if a user has already read an appointment's images | 1058 |
| `canUserReadAppointment(data, appointment, [userId], [options])` | Check if a user can read an appointment's images. | 1079 |
| `getEligibleCandidatesForSession(data, sessionOptions)` | Get eligible appointment candidates for a session based on its type and filters | 1145 |
| `createReadingSession(data, options, options.type, [options.name], [options.clinicId], [options.sessionId], [options.limit], [options.filters])` | Create a session of appointments for reading based on specified criteria | 1209 |
| `getDefaultSessionName(type, clinicId, data)` | Generate a default name for a session based on its type | 1298 |
| `generateSessionId()` | Generate a unique ID for a session | 1333 |
| `getReadingSession(data, sessionId)` | Get a reading session by ID | 1342 |
| `getFirstReadableAppointmentInSession(data, sessionId, [userId])` | Get the first appointment in a session that a user can read | 1379 |
| `skipAppointmentInSession(data, sessionId, appointmentId)` | Mark an appointment as skipped in a session | 1407 |
| `topUpSession(data, sessionId)` | Add the next eligible appointment to a session if it is under its target size | 1430 |
| `getSessionReadingProgress(data, sessionId, currentAppointmentId, [userId])` | Get reading progress for a session | 1480 |

### prior-mammograms.js

`app/lib/utils/prior-mammograms.js`

Prior mammogram request state (awaiting, unrequested, resolved) and one-line summary helpers.

| Function | Description | Line |
|---|---|---|
| `PRIOR_REQUEST_STATUSES()` | The known requestStatus values for a prior mammogram | 9 |
| `hasRecordedMammograms(appointment)` | Returns true if the appointment has any previously recorded mammograms | 19 |
| `awaitingPriors(appointment)` | Returns true if any prior mammogram has requestStatus 'pending' or 'requested' (holds case from reading) | 28 |
| `hasUnrequestedPriors(appointment)` | Returns true if any prior mammogram has requestStatus 'not_requested' | 36 |
| `getPriorsSummary(appointment)` | Get a summary of prior mammogram statuses for display | 44 |
| `getUnrequestedPriors(appointment)` | Get priors with requestStatus 'not_requested' (for the request priors UI) | 93 |
| `getAwaitingPriors(appointment)` | Get priors with requestStatus 'pending' or 'requested' (awaiting arrival) | 101 |
| `userRequestedPriors(appointment, userId)` | Returns true if the given user has a pending prior request on this appointment. | 109 |
| `summarisePriorMammogram(mammogram, [options], [options.unitName], [options.includeAdditionalInfo], [options.includeDate], [options.prefix])` | Summarise a single prior mammogram into a one-line string for display | 120 |
| `summarisePriorMammograms(appointment, [options])` | Summarise all prior mammograms for an appointment into an array of one-line strings | 211 |

### medical-information.js

`app/lib/utils/medical-information.js`

Summarise medical history items, symptoms, breast features, and other clinical information into concise display strings.

| Function | Description | Line |
|---|---|---|
| `isValidMedicalHistoryType(type)` | Check whether a string names a medical history type, by type or slug | 6 |
| `getMedicalHistoryType(type)` | Get a medical history type object, by type or slug | 18 |
| `getMedicalHistoryKeyFromSlug(slug)` | Get the camelCase data key for a medical history type from its slug | 31 |
| `summariseMedicalHistoryItem(item)` | Summarise a single medical history item into a concise string | 42 |
| `summariseMedicalHistory(medicalHistory)` | Summarise all medical history items into an array of summary strings | 215 |
| `getMedicalHistoryItems(medicalHistory)` | Get all medical history items as a flat array | 244 |
| `countMedicalHistoryItems(medicalHistory)` | Count total number of medical history items | 266 |
| `summariseSymptom(symptom)` | Summarise a single symptom into a concise string | 288 |
| `summariseSymptoms(symptoms)` | Summarise all symptoms into an array of summary strings | 367 |
| `summariseBreastFeature(feature)` | Summarise a single breast feature into a concise string | 381 |
| `summariseBreastFeatures(features)` | Summarise all breast features into an array of summary strings | 403 |

| `getBreastDensityFactors(medicalInformation)` | Read the breast density factors off an appointment's medical information | 419 |
| `summariseBreastDensityFactors(medicalInformation)` | Summarise breast density factors into an array of summary strings | 455 |
| `summariseOtherMedicalInformation(medicalInformation)` | Summarise the free-text other medical information, truncating if long | 490 |
| `summariseOtherRelevantInformation(medicalInformation)` | Summarise other relevant medical information (HRT, pregnancy/breastfeeding, other info) | 419 |


### annotation-summary.js

`app/lib/utils/annotation-summary.js`

Summarise image reading annotations (abnormality type, level of concern, location) into concise display strings.

| Function | Description | Line |
|---|---|---|
| `levelOfConcernLabel(level)` | Map level of concern number to its label | 3 |
| `formatLevelOfConcern(level)` | Format level of concern as "Level X (label)" | 20 |
| `summariseAnnotation(annotation)` | Build a concise one-line summary for a single annotation | 34 |
| `summariseAnnotations(annotations)` | Summarise a list of annotations into one-line strings | 74 |

### arrays.js

`app/lib/utils/arrays.js`

Array helpers: find by key/id, filter, push (immutable), remove empty. Supports lodash dot notation for nested property access.

| Function | Description | Line |
|---|---|---|
| `findById(array, id)` | Find an object by ID in an array | 5 |
| `push(array, item)` | Append an item to an array, returning a new array (deep clones the item) | 17 |
| `includes(array, value)` | Check if an array includes a value | 30 |
| `find(array, key, value)` | Find first array item where the specified key matches the value — e.g. `const users = [{id: 1, name: 'Alice'}, {id: 2, name: 'Bob'}]` | 42 |
| `removeEmpty(items)` | Remove empty items from arrays or strings | 58 |
| `where(array, key, compare)` | Filter array to items where the specified property matches one of the comparison values — e.g. `where([{type: 'dog'}, {type: 'cat'}], 'type', 'dog') // Returns [{type: 'dog'}]` | 93 |
| `removeWhere(array, key, compare)` | Filter array to remove items where the specified property matches one of the comparison values — e.g. `removeWhere([{type: 'dog'}, {type: 'cat'}], 'type', 'dog') // Returns [{type: 'cat'}]` | 116 |
| `map(array, filterName)` | Apply a filter to each element in an array | 139 |
| `isArray(value)` | Check if a value is an array — e.g. `isArray([1, 2, 3]) // Returns true` | 163 |

### objects.js

`app/lib/utils/objects.js`

Object utilities for extracting and flattening values.

| Function | Description | Line |
|---|---|---|
| `getObjectValues(obj, [options], [options.recursive], [options.includeArrays], [options.removeEmpty])` | Extract all values from an object into a flat array — e.g. `getObjectValues({ name: 'Jane', age: 30 }) // Returns ['Jane', 30]` | 5 |

### summary-list.js

`app/lib/utils/summary-list.js`

NHS summary list helpers: replace empty row values with "Enter X" links or "Not provided" text, and remove the bottom border from the last row.

| Function | Description | Line |
|---|---|---|
| `handleSummaryListMissingInformation(input, showNotProvidedText)` | Convert value object to "Enter X" link if empty, or show "Not provided" | 18 |
| `removeLastRowBorder(input)` | Add no-border class to the last summary list row | 108 |

### random.js

`app/lib/utils/random.js`

Seeded random functions for stable prototype data. Results are stable per page URL — use the `name` param to get different values for different purposes on the same page.

| Function | Description | Line |
|---|---|---|
| `randomBool(probability, [name], [seed])` | Generate a random boolean with consistent results | 64 |
| `randomItem(array, [name], [seed])` | Select a random item from an array with consistent results | 82 |
| `randomItems(array, count, [name], [seed])` | Select multiple random items from an array with consistent results | 100 |
| `randomOneOf(valueIfTrue, valueIfFalse, probability, [name], [seed])` | Choose between two values based on probability | 134 |
| `randomInt(min, max, [name], [seed])` | Generate a random integer in a range | 162 |
| `randomWeighted(weights, [name], [seed])` | Use weighted selection with consistent results | 181 |
| `seededFaker([name], [seed])` | Create a seeded faker instance with consistent results | 224 |
| `resetCallSequence()` | Reset the per-render call sequence counter — call once per page load (via middleware) | 256 |

### referrers.js

`app/lib/utils/referrers.js`

Referrer chain navigation for multi-level back links. Use these instead of hardcoded back link URLs. See the module-level comment in the file for full usage examples.

| Function | Description | Line |
|---|---|---|
| `getReturnUrl(url, referrerChain, [scrollToId])` | Get destination from referrer chain, falling back to provided URL if no referrer — e.g. `<a href="{{ '/default-path' \| getReturnUrl(referrerChain) }}">Back</a>` | 131 |
| `urlWithReferrer(url, referrerChain, [scrollToId])` | Add referrer to URL as query parameter with optional scroll anchor — e.g. `<a href="{{ '/next-page' \| urlWithReferrer(referrer) }}">Continue</a>` | 214 |
| `appendReferrer(existingReferrerChain, newUrl)` | Append a URL to an existing referrer chain — e.g. `{% set updatedReferrer = referrerChain \| appendReferrer(currentUrl) %}` | 240 |
| `modalBreakout(url)` | Append `?_modal_breakout=1` (or `&_modal_breakout=1`) to a URL so that the | 264 |

### roles-and-permissions.js

`app/lib/utils/roles-and-permissions.js`

User role checks. Use these instead of comparing role strings directly.

| Function | Description | Line |
|---|---|---|
| `hasRole(user, role)` | Check if a user has a specific role | 3 |
| `hasAnyRole(user, roles)` | Check if a user has any of the specified roles | 17 |
| `hasAllRoles(user, roles)` | Check if a user has all of the specified roles | 31 |
| `isClinician(user)` | Check if a user is a clinician | 45 |
| `isAdministrative(user)` | Check if a user has an administrative role | 55 |
| `isHybridUser(user)` | Check if a user has both clinical and administrative roles | 65 |
| `getRolesText(user, separator)` | Get all roles for a user as formatted string | 75 |
| `isCurrentUser(user)` | Check if a user is the current user | 89 |
| `startedByCurrentUser(appointment)` | Check if an appointment was started by the current user | 103 |

### utility.js

`app/lib/utils/utility.js`

General-purpose type coercion (`falsify`) and limiting utilities.

| Function | Description | Line |
|---|---|---|
| `falsify(value)` | Coerces a value to boolean, handling common web cases. Useful for converting json / html attributes from strings to their appropriate boolean values. | 3 |
| `normaliseString(value, [property])` | Normalise string | 36 |
| `limitTo(input, limit)` | Limit array or string to first x items/characters with support for negative indices | 90 |

## Filters

Nunjucks filters only — not automatically available in route files.

### formatting.js

`app/filters/formatting.js`

Display formatting for yes/no answers and ordinal names.

| Function | Description | Line |
|---|---|---|
| `formatAnswer(value, [options], [options.yesValue], [options.noText], [options.notAnsweredText], [options.yesPrefix])` | Format a yes/no/not answered response with optional additional details — e.g. `formatAnswer("yes", { yesValue: "Details here" }) // Returns "Yes - Details here"` | 3 |
| `getOrdinalName(integer)` | Convert a 1-based integer to its ordinal name — e.g. `getOrdinalName(1) // 'first'` | 41 |
| `getOrdinalNameIndex0(integer)` | Convert a 0-based index to its ordinal name (0 → 'first', 1 → 'second', etc) — e.g. `getOrdinalNameIndex0(0) // 'first'` | 77 |

### forms.js

`app/filters/forms.js`

Injects matching flash error messages into NHS form component configs by field name.

| Function | Description | Line |
|---|---|---|
| `populateErrors(component)` | Add error messages to form components based on flash messages | 3 |
| `openInModal(component, modalId, [loadUrl])` | Transform a button, summary list action item, or full summary list component — e.g. `{{ button({ text: "Add", href: addUrl } \| openInModal(modalId)) }}` | 36 |
| `getFlashError(name)` | Get a flash error object for a specific field name from the template context. | 127 |

### nunjucks.js

`app/filters/nunjucks.js`

Nunjucks-specific helpers: joining arrays, resolving user names from IDs, template debugging, and template literal support.

| Function | Description | Line |
|---|---|---|
| `log(a, [description])` | Render a value to the browser console via an inline script tag (for template debugging) | 5 |
| `join(input, [delimiter], [attribute], [options], [options.filterEmpty], [options.toString])` | Safely join array elements with proper undefined/null handling — e.g. `join(['a', 'b', 'c'], ', ') // 'a, b, c'` | 22 |
| `getUsername(userId, [options], [options.identifyCurrentUser], [options.useYou], [options.format])` | Get user name by user ID with format options | 94 |
| `getContext()` | Return the full Nunjucks template context — useful for debugging | 142 |
| `parseJsonString(value)` | Safely parse a JSON string and return the resulting object, or return structured data as-is | 151 |

### tags.js

`app/filters/tags.js`

Convert status strings to NHS `<strong class="nhsuk-tag">` HTML elements.

| Function | Description | Line |
|---|---|---|
| `toTag(status, [options], [options.vocabulary])` | Convert a status string into an NHS tag | 7 |

### markdown.js

`app/filters/markdown.js`

Convert markdown strings to Nunjucks-safe HTML using markdown-it. Output does not need `| safe`.

| Function | Description | Line |
|---|---|---|
| `markdown(content)` | Convert markdown to HTML — e.g. `{{ "## Heading" \| markdown }}` | 12 |

