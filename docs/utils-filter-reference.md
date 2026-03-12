# Utils and filters reference

---
**Auto-generated** — do not edit manually.

- **Generated:** 2026-03-12 13:33 UTC
- **Source:** `app/lib/utils/` and `app/filters/`
- **Regenerate:** `npm run docs`

*All functions in `app/lib/utils/` are automatically available as Nunjucks filters and global functions in templates, and can be imported in route files. Filters in `app/filters/` are Nunjucks-only.*

---

## Table of contents

| File | Purpose | Line |
|---|---|---|
| `dates.js` | Date formatting and calculation using dayjs | 48 |
| `strings.js` | String manipulation: case conversion, formatting, NHS-specific formats (NHS number, phone), pluralisation, and HTML-wrapping helpers for use in templates. | 83 |
| `status.js` | Event status checks and display helpers | 117 |
| `participants.js` | Participant lookups and derived data: full/short names, age, clinic history, and risk level. | 141 |
| `event-data.js` | Event lookups and mutations in session data | 165 |
| `clinics.js` | Clinic filtering by time period, slot formatting, and opening hours calculation. | 180 |
| `reading.js` | Image reading workflow: read state, progress tracking, batch management, per-user navigation, and filtering | 194 |
| `prior-mammograms.js` | Prior mammogram request state (awaiting, unrequested, resolved) and one-line summary helpers. | 243 |
| `medical-information.js` | Summarise medical history items, symptoms, breast features, and other clinical information into concise display strings. | 261 |
| `annotation-summary.js` | Summarise image reading annotations (abnormality type, level of concern, location) into concise display strings. | 279 |
| `arrays.js` | Array helpers: find by key/id, filter, push (immutable), remove empty | 292 |
| `objects.js` | Object utilities for extracting and flattening values. | 310 |
| `summary-list.js` | NHS summary list helpers: replace empty row values with "Enter X" links or "Not provided" text, and remove the bottom border from the last row. | 320 |
| `random.js` | Seeded random functions for stable prototype data | 331 |
| `referrers.js` | Referrer chain navigation for multi-level back links | 348 |
| `roles-and-permissions.js` | User role checks | 360 |
| `utility.js` | General-purpose type coercion (`falsify`) and limiting utilities. | 378 |
| | | |
| `formatting.js` | Display formatting for yes/no answers and ordinal names. (filter only) | 394 |
| `forms.js` | Injects matching flash error messages into NHS form component configs by field name. (filter only) | 406 |
| `nunjucks.js` | Nunjucks-specific helpers: joining arrays, resolving user names from IDs, template debugging, and template literal support. (filter only) | 416 |
| `tags.js` | Convert status strings to NHS `<strong class="nhsuk-tag">` HTML elements. (filter only) | 430 |
| `markdown.js` | Convert markdown strings to Nunjucks-safe HTML using markdown-it (filter only) | 440 |

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
| `add(dateInput, amount, unit)` | Add or subtract time from a date — e.g. `add('2023-01-01', 5, 'weeks') // returns '2023-02-05T00:00:00.000Z'` | 731 |
| `remove(dateInput, amount, unit)` | Remove time from a date (convenience wrapper for add with negative amount) — e.g. `remove('2023-01-01', 2, 'days') // returns '2022-12-30T00:00:00.000Z'` | 778 |

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
| `formatNhsNumber(input)` | Format NHS number with spaces (3-3-4 format) — e.g. `formatNhsNumber('9997773456') // '999 777 3456'` | 335 |
| `pluralise(word, args)` | Make a word plural based on a count — e.g. `pluralise('cat') // returns 'cats'` | 359 |
| `formatMammogramViewCode(code)` | Format mammogram view code for display | 382 |

### status.js

`app/lib/utils/status.js`

Event status checks and display helpers. Use these instead of comparing status strings directly — status values may change but these functions will be updated accordingly.

| Function | Description | Line |
|---|---|---|
| `hasNotStarted(input)` | Check if a status represents a not started event | 62 |
| `isCompleted(input)` | Check if a status represents a completed event | 74 |
| `isInProgress(input)` | Check if a status represents an in-progress event (includes paused) | 86 |
| `isPaused(input)` | Check if a status represents a paused event | 98 |
| `isInProgressNotPaused(input)` | Check if a status represents an in-progress event that is not paused | 110 |
| `isFinal(input)` | Check if a status represents a final state | 122 |
| `isActive(input)` | Check if a status represents an active event | 134 |
| `isAppointmentWorkflow(event, currentUser)` | Check if an event is in the appointment workflow for the current user | 146 |
| `eligibleForReading(event)` | Check if a status indicates reading is eligible | 178 |
| `getStatusTagColour(status)` | Map a status key to its NHS tag colour string — e.g. `getStatusTagColour('event_complete') // 'green'` | 194 |
| `getStatusText(status)` | Map a status key to its display text — e.g. `getStatusText('event_complete') // 'Screened'` | 291 |
| `filterEventsByStatus(events, filter)` | Filter events by status category | 334 |
| `isSpecialAppointment(event)` | Check if an event is a special appointment | 360 |
| `hasAppointmentNote(event)` | Check if an event has an appointment note | 370 |
| `hasSymptoms(event)` | Check if an event has recorded symptoms | 380 |

### participants.js

`app/lib/utils/participants.js`

Participant lookups and derived data: full/short names, age, clinic history, and risk level.

| Function | Description | Line |
|---|---|---|
| `getParticipant(data, participantId)` | Get a participant by ID | 6 |
| `getFullName(participant)` | Get full name (first, middle, last) of a participant as a Nunjucks-safe string | 17 |
| `getFullNameReversed(participant)` | Get full name in reversed 'Last, First Middle' format — e.g. `getFullNameReversed(participant) // 'Smith, Jane Louise'` | 31 |
| `getShortName(participant)` | Get short name (first + last only) of participant as a Nunjucks-safe string | 45 |
| `findBySXNumber(participants, sxNumber)` | Find a participant by their SX number | 57 |
| `getAge(participant, [referenceDate])` | Get participant's age | 68 |
| `sortBySurname(participants)` | Sort participants by surname | 89 |
| `getParticipantClinicHistory(data, participantId, [options], [options.filter], [options.mostRecent])` | Get clinic history for a participant with optional filters | 103 |
| `getParticipantMostRecentClinic(data, participantId)` | Get the most recent historic clinic/event pair for a participant | 166 |
| `getParticipantMostRecentClinicDate(data, participantId)` | Get the start time of the participant's most recent clinic, or false if none | 173 |
| `getParticipantHistoricClinics(data, participantId)` | Get all past clinic/event pairs for a participant | 184 |
| `getParticipantUpcomingClinics(data, participantId)` | Get all upcoming clinic/event pairs for a participant | 188 |
| `getCurrentRiskLevel(participant)` | Determine a participant's current risk level based on age and risk factors | 192 |
| `updateParticipant(data, participantId, updatedParticipant)` | Find and update a participant in session data | 225 |
| `saveTempParticipantToParticipant(data)` | Save temporary participant data back to the main participant | 244 |

### event-data.js

`app/lib/utils/event-data.js`

Event lookups and mutations in session data. Includes the temp event pattern (`data.event` → `data.events[]`).

| Function | Description | Line |
|---|---|---|
| `getEvent(data, eventId)` | Get an event by ID | 4 |
| `getEventData(data, clinicId, eventId)` | Get event data bundle for a given clinic and event ID | 15 |
| `updateEvent(data, eventId, updatedEvent)` | Find and update an event in session data | 41 |
| `updateEventStatus(data, eventId, newStatus)` | Update event status and add to history | 58 |
| `updateEventData(data, eventId, updates)` | Update event with arbitrary data changes | 102 |
| `saveTempEventToEvent(data)` | Save temporary event data back to the main event | 141 |

### clinics.js

`app/lib/utils/clinics.js`

Clinic filtering by time period, slot formatting, and opening hours calculation.

| Function | Description | Line |
|---|---|---|
| `getTodaysClinics(clinics)` | Get today's clinics | 7 |
| `getClinicEvents(events, clinicId)` | Get events for a specific clinic | 18 |
| `formatTimeSlot(dateTime)` | Format clinic time slot | 32 |
| `getClinicHours(clinic)` | Get clinic opening hours | 58 |
| `getFilteredClinics(clinics, [filter])` | Get clinics filtered by time period | 76 |

### reading.js

`app/lib/utils/reading.js`

Image reading workflow: read state, progress tracking, batch management, per-user navigation, and filtering. The main module for anything related to image reading.

| Function | Description | Line |
|---|---|---|
| `getReadingMetadata(event)` | Get reading metadata for an event | 33 |
| `getReadsAsArray(event)` | Get all reads for an event as an ordered array | 64 |
| `writeReading(event, userId, reading, [data], [batchId])` | Update the writeReading function to also handle removing from skipped events | 85 |
| `enhanceEventsWithReadingData(events, participants, userId)` | Enhance events with pre-calculated reading metadata | 132 |
| `getReadingStatusForEvents(events, [userId])` | Get detailed reading status for a group of events | 303 |
| `getReadingProgress(events, currentEventId, skippedEvents, [userId])` | Get progress through reading a set of events | 349 |
| `sortEventsByScreeningDate(events)` | Sort events by screening date (oldest first) | 666 |
| `getFirstAvailableClinic(data)` | Get the first clinic that still has events needing reads | 686 |
| `getReadingClinics(data, [options])` | Get all clinics available for reading, enriched with unit, location, and reading status | 697 |
| `getReadableEventsForClinic(data, clinicId)` | Get readable events for a clinic with pre-calculated metadata | 729 |
| `filterEventsByEligibleForReading(events)` | Filter events that are eligible for reading | 760 |
| `filterEventsByNeedsAnyRead(events, maxReadsPerEvent)` | Filter events that need any read (first or second) | 769 |
| `filterEventsByNeedsFirstRead(events)` | Filter events that need a first read | 783 |
| `filterEventsByNeedsSecondRead(events)` | Filter events that need a second read | 793 |
| `filterEventsByFullyRead(events, requiredReads)` | Filter events that are fully read (have all required reads) | 803 |
| `filterEventsByUserCanRead(events, userId)` | Filter events that a specific user can read | 817 |
| `filterEventsByUserCanReadOrHasRead(events, userId, [options])` | Filter events that user can read or has already read | 828 |
| `filterEventsByClinic(events, clinicId)` | Filter events for a specific clinic | 859 |
| `filterEventsByDayRange(events, minDays, [maxDays])` | Filter events that are within a specific day range | 870 |
| `getFirstEvent(events)` | Get the first event from an array | 890 |
| `getNextEvent(events, currentEventId, wrap)` | Get the next event after a specific event | 899 |
| `getPreviousEvent(events, currentEventId, wrap)` | Get the previous event before a specific event | 920 |
| `getReadForUser(event, [userId])` | Get the read object for a specific user on an event | 945 |
| `getFirstUserReadableEvent(events, userId)` | Get first event from an array that a user can read | 962 |
| `getNextUserReadableEvent(events, currentEventId, [userId])` | Get the next event the user can read after the current event, wrapping to start if needed | 977 |
| `userHasReadEvent(event, userId)` | Check if a user has already read an event | 999 |
| `getOtherReads(event, userId)` | Get reads from other users (not the current user) | 1018 |
| `getComparisonInfo(event, secondReaderOpinion, userId)` | Determine if a comparison page should be shown to the second reader | 1039 |
| `canUserReadEvent(event, userId, [options])` | Check if current user can read an event | 1084 |
| `hasReads(event)` | Check if an event has any reads | 1124 |
| `needsFirstRead(event)` | Check if an event needs a first read | 1137 |
| `needsSecondRead(event)` | Check if an event needs a second read | 1147 |
| `needsArbitration(event)` | Check if an event needs arbitration | 1155 |
| `createReadingBatch(data, options, options.type, [options.name], [options.clinicId], [options.batchId], [options.limit], [options.filters])` | Create a batch of events for reading based on specified criteria | 1167 |
| `getDefaultBatchName(type, clinicId, data)` | Generate a default name for a batch based on its type | 1318 |
| `generateBatchId()` | Generate a unique ID for a batch | 1353 |
| `getReadingBatch(data, batchId)` | Get a reading batch by ID | 1362 |
| `getFirstReadableEventInBatch(data, batchId, [userId])` | Get the first event in a batch that a user can read | 1399 |
| `skipEventInBatch(data, batchId, eventId)` | Mark an event as skipped in a batch | 1424 |
| `getBatchReadingProgress(data, batchId, currentEventId, [userId])` | Get reading progress for a batch | 1447 |

### prior-mammograms.js

`app/lib/utils/prior-mammograms.js`

Prior mammogram request state (awaiting, unrequested, resolved) and one-line summary helpers.

| Function | Description | Line |
|---|---|---|
| `hasReportedMammograms(event)` | Returns true if the event has any previously reported mammograms | 9 |
| `awaitingPriors(event)` | Returns true if any prior mammogram has requestStatus 'requested' (holds case from reading) | 18 |
| `hasUnrequestedPriors(event)` | Returns true if any prior mammogram has requestStatus 'not_requested' | 24 |
| `getPriorsSummary(event)` | Get a summary of prior mammogram statuses for display | 32 |
| `getUnrequestedPriors(event)` | Get priors with requestStatus 'not_requested' (for the request priors UI) | 80 |
| `getAwaitingPriors(event)` | Get priors with requestStatus 'requested' (awaiting arrival) | 88 |
| `userRequestedPriors(event, userId)` | Returns true if the given user has an outstanding prior request on this event | 94 |
| `summarisePriorMammogram(mammogram, [options], [options.unitName], [options.includeAdditionalInfo])` | Summarise a single prior mammogram into a one-line string for display | 102 |
| `summarisePriorMammograms(event, [options])` | Summarise all prior mammograms for an event into an array of one-line strings | 168 |

### medical-information.js

`app/lib/utils/medical-information.js`

Summarise medical history items, symptoms, breast features, and other clinical information into concise display strings.

| Function | Description | Line |
|---|---|---|
| `summariseMedicalHistoryItem(item)` | Summarise a single medical history item into a concise string | 5 |
| `summariseMedicalHistory(medicalHistory)` | Summarise all medical history items into an array of summary strings | 178 |
| `getMedicalHistoryItems(medicalHistory)` | Get all medical history items as a flat array | 207 |
| `countMedicalHistoryItems(medicalHistory)` | Count total number of medical history items | 229 |
| `summariseSymptom(symptom)` | Summarise a single symptom into a concise string | 251 |
| `summariseSymptoms(symptoms)` | Summarise all symptoms into an array of summary strings | 305 |
| `summariseBreastFeature(feature)` | Summarise a single breast feature into a concise string | 319 |
| `summariseBreastFeatures(features)` | Summarise all breast features into an array of summary strings | 341 |
| `summariseOtherRelevantInformation(medicalInformation)` | Summarise other relevant medical information (HRT, pregnancy/breastfeeding, other info) | 357 |

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
| `removeLastRowBorder(input)` | Add no-border class to the last summary list row | 99 |

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
| `startedByCurrentUser(event)` | Check if an event was started by the current user | 103 |

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

### nunjucks.js

`app/filters/nunjucks.js`

Nunjucks-specific helpers: joining arrays, resolving user names from IDs, template debugging, and template literal support.

| Function | Description | Line |
|---|---|---|
| `log(a, [description])` | Render a value to the browser console via an inline script tag (for template debugging) | 5 |
| `join(input, [delimiter], [attribute], [options], [options.filterEmpty], [options.toString])` | Safely join array elements with proper undefined/null handling — e.g. `join(['a', 'b', 'c'], ', ') // 'a, b, c'` | 22 |
| `getUsername(userId, [options], [options.identifyCurrentUser], [options.format])` | Get user name by user ID with format options | 94 |
| `getContext()` | Return the full Nunjucks template context — useful for debugging | 136 |
| `parseJsonString(value)` | Safely parse a JSON string and return the resulting object, or return structured data as-is | 145 |

### tags.js

`app/filters/tags.js`

Convert status strings to NHS `<strong class="nhsuk-tag">` HTML elements.

| Function | Description | Line |
|---|---|---|
| `toTag(status, [options])` | Convert a status string into an NHS tag | 7 |

### markdown.js

`app/filters/markdown.js`

Convert markdown strings to Nunjucks-safe HTML using markdown-it. Output does not need `| safe`.

| Function | Description | Line |
|---|---|---|
| `markdown(content)` | Convert markdown to HTML — e.g. `{{ "## Heading" \| markdown }}` | 12 |

