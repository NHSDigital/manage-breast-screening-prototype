# Data conventions: reading and updating seed data

How participant, clinic and event data works in this prototype, and the rules
to follow when changing it.

## How it works

The generated seed data (`data.participants`, `data.clinics`, `data.events`)
is **shared and read-only**. It is loaded once at boot into a shared store
([app/lib/data-store.js](../app/lib/data-store.js)) and attached to every
request by middleware in [app/routes.js](../app/routes.js) - it is not copied
into each session.

A user's session only stores **changed records** in `data._changes` (whole
replacement records, keyed by id). The attach middleware overlays those onto
the shared arrays on each request, so `data.events` etc always look exactly
like a plain per-session copy - reading them needs no special knowledge.

## Reading data

No change from what you'd expect. In views and routes, read `data.events`,
`data.participants`, `data.clinics` as normal. Lookups, filters, maps and the
Nunjucks `sort` filter are all fine.

## Updating data

Never assign to properties of a record you got from one of these collections -
in development they are frozen, and the assignment will be **silently
ignored** (this codebase runs in sloppy mode, so frozen objects don't throw).
If a change you made mysteriously doesn't stick, this is almost certainly why.

Instead, do one of:

- **Use the update helpers** - `updateEvent`, `updateEventStatus`,
  `updateEventData` ([app/lib/utils/event-data.js](../app/lib/utils/event-data.js))
  and `updateParticipant` ([app/lib/utils/participants.js](../app/lib/utils/participants.js)).
  Build a whole replacement record (spread the old one, change what you need)
  and pass it in. The helpers write it to the session's `_changes` for you.

- **Use the temp working copy** - the screening flow checks out
  `data.event` / `data.participant` (deep clones) for multi-page forms, and
  `saveTempEventToEvent` / `saveTempParticipantToParticipant` commit them
  back. Mutating the temp copies is fine - they're session-local clones.

```js
// Wrong - mutates a shared record, silently dropped in dev
const event = data.events.find((e) => e.id === eventId)
event.status = 'event_complete'

// Right - build a replacement and save through a helper
updateEventData(data, eventId, { status: 'event_complete' })
```

Arrays and nested objects inside records are shared too: don't `push` to
them - copy first (`[...event.things, newThing]`).

## Regeneration and profile swaps

Regenerating data (daily, or via `/settings`) reloads the shared store and
changes its `generationId`. Session changes are stamped with the generation
they were made against, and stale changes are discarded automatically - so a
profile swap resets everyone's data. This is intentional demo behaviour.

## Escape hatch

If the development freeze ever blocks you mid-task, set
`freezeSharedData: false` in [app/config.js](../app/config.js) - the app
works identically, you just lose the mutation protection.
