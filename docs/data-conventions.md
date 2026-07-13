# Data conventions: reading and updating seed data

How participant, clinic, event and episode data works in this prototype, and
the rules to follow when changing it.

## How it works

The generated seed data (`data.participants`, `data.clinics`, `data.events`,
`data.episodes`)
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
This silence is a deliberate trade-off: making mutations throw would need
`'use strict'` everywhere or Proxy-wrapped records, and neither is worth the
complexity here. The freeze's main job - stopping one session's changes
leaking into every other session - holds either way.

Instead, do one of:

- **Use the update helpers** - `updateEvent`, `updateEventStatus`,
  `updateEventData` ([app/lib/utils/event-data.js](../app/lib/utils/event-data.js)),
  `updateParticipant` ([app/lib/utils/participants.js](../app/lib/utils/participants.js))
  and `updateEpisode` / `updateEpisodeStage` ([app/lib/utils/episodes.js](../app/lib/utils/episodes.js)).
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

## Episodes

An **episode** is one screening round for a participant - the container the
appointment(s) for that round sit in. Every event has an `episodeId`, and
every episode lists its `eventIds`. Accessors live in
[app/lib/utils/episodes.js](../app/lib/utils/episodes.js) (and so are
available as Nunjucks filters): `getEpisode`, `getEpisodesForParticipant`,
`getCurrentEpisode`, `getEpisodeEvents`, `getEpisodeReadingStatus`.

An episode moves through **stages**: `scheduled` → `mammograms` → `reading`
→ `closed`. A technical recall sends it back to `mammograms`. (`assessment`
is a future stage - until it's modelled, episodes that conclude
recall-for-assessment go straight to `closed`.) When it closes it takes an
`outcome`.

You should not normally need to advance an episode by hand. Stage changes are
wired into the two funnels that already exist:

- `updateEventStatus` moves the episode to wherever the appointment's new
  status leaves it (check-in → `mammograms`, complete → `reading`, did not
  attend → `closed`).
- `writeReading` closes the episode - or sends it back for a technical recall
  - once a reading concludes.

Both use the maps in `episodes.js`, which the seed generator also uses, so
generated episodes sit exactly where a real one would after the same events.
If you do need to change one directly, use `updateEpisode` /
`updateEpisodeStage` - the same replacement-record rules apply as for events.

Stage moves are **not validated** yet: any stage can follow any other. A
transition map arrives with the statuses work.

### What an episode is always allowed to assume

The generator checks these on every run and warns loudly if any is broken
(`checkEpisodes` in
[episode-generator.js](../app/lib/generators/episode-generator.js)):

- A **historic** episode is always `closed`, always has an outcome, and never
  has events.
- An episode in **`reading`** is open (no outcome) and contains a completed
  mammogram appointment that is still within the reading window. Nothing can
  be in reading without images to read.
- A **closed** episode has a `closedDate`; an open one has no `outcome`.

A round screened longer ago than the reading window closes rather than sitting
in `reading` forever - it was read at the time, we just don't seed reads going
back that far.

### What deliberately doesn't live on the episode yet

The target model puts `imageReadings[]`, priors and deferral on the episode.
They are all still **on the event**, because moving them touches most of the
reading code. `getEpisodeReadingStatus` derives an episode's reading state
from its events rather than holding a copy. The physical move happens with the
work that needs it (arbitration / case views), or with the event→appointment
rename.

### Historic episodes

Participants who have a real episode also get 0-3 **historic** ones
(`isHistoric: true`): summary-level records of past rounds, with dates, an
outcome and enough image metadata to show as priors, but no events. They are
spaced by the participant's screening interval (routine every 3 years, high
risk yearly). Volume is set by `generation.historicEpisodesPerParticipant` in
[app/config.js](../app/config.js).

## Escape hatch

If the development freeze ever blocks you mid-task, set
`freezeSharedData: false` in [app/config.js](../app/config.js) - the app
works identically, you just lose the mutation protection.
