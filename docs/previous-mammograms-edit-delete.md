# Previous Mammograms - Add Edit/Delete Functionality

## Overview
Implement add/edit/delete functionality for previous mammograms following the established patterns used in symptoms and medical history.

## Task List

### 1. Data Structure Changes
**File:** `app/routes/events.js` (lines 396-527)

- [x] Add unique ID generation using `generateId()` when creating new mammograms
- [x] Add `dateAdded` timestamp for new items
- [x] Add `addedBy` field for new items
- [x] Detect new vs edit using `!previousMammogramTemp.id`

### 2. Update Save Route Logic
**File:** `app/routes/events.js` (lines 396-527)

- [x] Replace `.push()` with findIndex/update or push pattern
- [x] Handle both creating new and updating existing mammograms
- [x] Ensure all special flows (recent mammogram warning, proceed anyway, end immediately) still work with new structure

### 3. Add Edit Route
**File:** `app/routes/events.js` (add after line 527)

- [x] Add GET route: `/clinics/:clinicId/events/:eventId/previous-mammograms/edit/:mammogramId`
- [x] Find mammogram by ID in `event.previousMammograms` array
- [x] Copy to `previousMammogramTemp`
- [x] Redirect to edit form with referrerChain
- [x] Handle case where mammogram not found

### 4. Add Delete Route
**File:** `app/routes/events.js` (add after edit route)

- [x] Add GET route: `/clinics/:clinicId/events/:eventId/previous-mammograms/delete/:mammogramId`
- [x] Filter out mammogram from array
- [x] Flash success message: "Previous mammogram deleted"
- [x] Redirect back using referrerChain and scrollTo

### 5. Update Edit Form
**File:** `app/views/events/previous-mammograms/edit.html`

- [x] Add delete link at bottom of form
- [x] Only show when `event.previousMammogramTemp.id` exists
- [x] Use warning link style (`app-link--warning`)
- [x] Include referrerChain and scrollTo in delete href

### 6. Update Display Template
**File:** `app/views/_includes/summary-lists/rows/last-known-mammogram.njk`

- [x] Separate display into two sections (system record vs user-added)
- [x] Add "Change" action link for each user-added mammogram
- [x] Point change links to `/previous-mammograms/edit/:id`
- [x] Delete links only in edit form (following established pattern)
- [x] Fix duplicate "Add another" text issue (line 89-90)

## Testing Checklist

After implementation:
- [ ] Can add a new previous mammogram
- [ ] Can edit an existing user-added mammogram
- [ ] Can delete a user-added mammogram
- [ ] Recent mammogram warning still works
- [ ] "Proceed anyway" flow still works
- [ ] "End immediately" flow still works
- [ ] ReferrerChain and scrollTo work correctly
- [ ] Flash messages appear correctly
- [ ] System record mammogram displays separately from user-added ones

## Notes

- Simpler than symptoms/medical history as there's no `:type` parameter needed
- Delete link appears in edit form only (following established pattern)
- Each mammogram needs unique ID for edit/delete to work
- Need to preserve all existing special logic for recent mammogram detection
