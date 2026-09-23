# Issues

How raising an issue works in the prototype: the model, where issues are raised and shown, and the Review pages. For what an issue is in the service, see [domain.md](domain.md#issues). For how the collection behaves as data, see [data-conventions.md](data-conventions.md#issues).

The code is in [app/lib/utils/issues.js](../app/lib/utils/issues.js) (the model and helpers), [app/lib/utils/issue-list.js](../app/lib/utils/issue-list.js) (the index and the open count), [app/routes/issues.js](../app/routes/issues.js) (raising outside reading) and [app/routes/review.js](../app/routes/review.js).

## The model

```js
{
  id,
  reference,               // short reference for the service desk, e.g. ISS-4F2K9
  type,                    // from ISSUE_TYPES
  description,             // optional free text from the person raising it
  raisedAt, raisedBy,
  raisedFrom,              // 'reading' | 'reading_case' | 'appointment' | 'episode'
  breastScreeningUnitId,   // taken from the episode, for scoping lists
  links: [                 // what the issue is about, most specific first
    { type: 'readingCase', id },
    { type: 'appointment', id },
    { type: 'episode', id },
    { type: 'participant', id }
  ],
  resolved: { resolvedAt, resolvedBy, outcome, note }   // absent while open
}
```

- **Open until resolved.** `isIssueOpen` is the absence of `resolved`. `outcome` is `resolved` or `raised_in_error`; nothing is deleted.
- **Links fill in upwards.** `createIssue` takes the id of the record the issue is raised on and adds every record containing it. Raised on a reading case, it links to the case, its appointment, episode and participant; raised on an episode, to the episode and participant. Links are an array so one issue can later name two participants (swapped images).
- **Asked of the episode.** `hasOpenIssue(data, record)` and `getOpenIssuesFor(data, record)` match any link, so pages and reading pass the episode: an issue raised anywhere in a round shows, and holds, everywhere in it. The links still record exactly where it was raised.

### Types and `raisedFrom`

`ISSUE_TYPES` lists each type with a label, a group (images, record or other) and the journeys that offer it. `getIssueTypes(raisedFrom)` returns what the raise form shows, in order: image types first in reading, on a reading case and at an appointment; record types first on an episode; "Something else" always last.

`raisedFrom` is the journey the issue was raised in. It chooses the types and wording of the form, and `reading` marks an issue raised inside a reading session. Where an issue sits on the index ("Raised in") comes from its most specific link instead (`getIssuePlace`).

## What an open issue does

Every open issue blocks, with no per-type choice yet. While the episode has an open issue:

- its case is out of reading and arbitration sessions and queues (`canUserReadAppointment`, session top-up, `filterAppointmentsByNeedsArbitration`)
- the case shows as blocked, alongside awaiting priors, in the case list's "Blocked" filter and the backlog counts
- auto-finalisation is paused. The finalisation window resumes after resolution rather than jumping: time held by an open issue does not count, so a read with 55 minutes left when the issue was raised still has 55 minutes once it is resolved
- the case cannot be finalised by hand, and the finalise actions are hidden, because concluding the case would close the episode

The appointment still completes, the reading case still opens and the episode stage does not move. [image-reading.md](image-reading.md#issues-in-reading) covers the reading side in more detail.

## Where issues are raised

- **Reading workflow**: "Raise an issue" on the opinion and arbitration outcome pages opens `reading/workflow/raise-issue.html`. It is the reader's outcome for the case: see [image-reading.md](image-reading.md#issues-in-reading).
- **Everywhere else**: the `raiseIssueLink(raisedFrom, options)` macro in `_includes/issues/raise-link.njk` links to `/issues/raise/:recordType/:recordId`, raised on the most specific record the page has loaded (reading case, then appointment, then episode). The form opens in a modal where modals are on, posts to `/answer` and returns the user to where they came from with a success banner linking to the issue. It is on the reading case page and its priors tab, the episode page, the appointment overview and, as "Report a problem with these images", the image capture pages and images tab.

Both forms share their fields through `_includes/issues/raise-fields.njk`. Type is required; the description is optional.

## Where issues are shown

| Include | Shows | Used on |
|---|---|---|
| `_includes/issues/tag.njk` (`issueTag(record)`) | The yellow `has_issue` tag, only when the record has an open issue. Call with no record when the caller already knows | Case lists, session overviews, case header, existing read, participant index |
| `_includes/issues/open-issues.njk` (`openIssuesCallout(record)`) | A warning callout listing each open issue, linked to its page | Episode, participant, reading case and priors tab, appointment layout, reading workflow layout |
| `_includes/issues/resolved-issues.njk` (`resolvedIssuesCard(record)`) | Closed issues as history | Episode and participant pages |

An issue's own status renders through the `issue` tag vocabulary: `{{ issue | getIssueStatus | toTag({ vocabulary: "issue" }) }}`. The style guide’s issues page (`/style-guide/issues`) shows the tags, callout and card.

## Review pages

"Review" in the header holds lists of things needing someone's attention, with a count of open issues in the current user's BSU (`getOpenIssueCount`). Issues are the only list so far.

- `/review` - landing page with a card per list
- `/review/issues` - the index, scoped to the current user's BSU. Open, Resolved and All are tabs, not a filter, so open can be the default. Type and "Raised in" use the generic [filter panel](filtering.md)
- `/review/issues/:issueId` - the issue, a link to each record it names, and the resolve form (outcome required, note optional), which posts to `/review/issues/:issueId/resolve`

## Form answers keyed to their record

The raise and resolve forms keep their answers in session data with the id of the record they were given for: `data.raiseIssue.recordId` and `data.issueResolution.issueId`. A route only reuses answers for the same record, so opening another issue or case starts a fresh form, and a validation error still keeps what was entered. The routes pass the answers to the template as locals (`answers`, `resolutionAnswers`), because the template's `data` is a copy taken before the route runs, and delete them once the issue is created or resolved, since the kit copies every posted field into the session.
