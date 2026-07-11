# Memory Investigation Summary

**Date:** 9 December 2025  
**Issue:** Heroku app crashed with memory usage exceeding 512MB quota

## Root Cause

**Session serialization overhead combined with V8 memory reservation.**

Each request:

1. Loads ~3.6MB of session data from MemoryStore via `JSON.parse()` → creates ~20MB of objects
2. Processes the request (template rendering, etc.)
3. Saves session back via `JSON.stringify()` → creates ~3.6MB string
4. V8 allocates heap for these temporary objects but **doesn't return memory to OS** after GC

The result: RSS (resident set size) grows with each request until it plateaus, but at a level far higher than the actual data size.

## Key Findings

### Data sizes

```
clinics.json:      513KB
events.json:       4.2MB
participants.json: 1.3MB
─────────────────────────
Total JSON:        ~6MB
Serialized session: ~3.6MB (after Object.assign merging)
```

### Memory behaviour with single session

Testing with 500 requests to `/playground`:

| Requests    | Heap  | RSS   | Notes                 |
| ----------- | ----- | ----- | --------------------- |
| 0 (startup) | 24MB  | 91MB  | Baseline              |
| 2           | 50MB  | 224MB | First session created |
| 50          | 82MB  | 390MB | Still growing         |
| 100         | 97MB  | 422MB | Slowing               |
| 200         | 189MB | 460MB | Near plateau          |
| 300         | 174MB | 446MB | **Plateaued ~460MB**  |

**Session size stays constant at 3.59MB** - no session data leak.

### Memory behaviour with multiple sessions

After creating 5 additional sessions:

| Requests | Heap  | RSS   | Sessions            |
| -------- | ----- | ----- | ------------------- |
| 300      | 174MB | 446MB | 1                   |
| 350      | 197MB | 610MB | 6                   |
| 500      | 234MB | 642MB | 6 (**new plateau**) |

Each additional session adds:

- ~3.6MB stored string in MemoryStore
- ~30-40MB to RSS plateau (due to parse/stringify overhead)

### Why RSS doesn't shrink after GC

This is normal V8/Node.js behaviour. V8 allocates memory from the OS to accommodate peak heap usage but **rarely returns it**. The OS sees this as "in use" (RSS) even though V8's heap may be mostly empty after GC.

## Red Herrings / Things That Don't Help

### ❌ Nunjucks template caching (`noCache: false`)

Tested with caching enabled:

- Request 50: 331MB RSS (vs 390MB without caching)
- Request 100: 401MB RSS (vs 422MB without caching)

~20% improvement but **not the main issue**. Growth pattern is the same.

### ❌ Redis session store

Tested Redis to move session storage out of Node. Result:

```
[Memory startup] heap: 27.6MB, rss: 101.3MB
[Request 5]      heap: 261.8MB, rss: 582.8MB  ← Still growing!
```

Redis moves the **storage** but not the **processing**. Each request still:

- Fetches 3.6MB from Redis → parses to ~20MB objects
- Processes request
- Stringifies back → sends 3.6MB to Redis

The temporary heap allocations still cause RSS growth. Redis was removed as it adds complexity without solving the problem.

## The Actual Problem

The architecture stores **all** seed data (participants, events, clinics) in **every user's session**. This means:

1. **Every request** serializes/deserializes 3.6MB of data
2. **Every session** stores a 3.6MB copy (even if user hasn't changed anything)
3. **V8 heap** expands to handle the temporary objects, RSS grows to ~400-600MB

With the current data volume (~1000 participants, ~1200 events), a single session causes RSS to plateau at ~460MB. Multiple concurrent sessions push it higher.

## Solutions

### Quick mitigations (won't fix root cause)

| Option                  | Impact                    | Effort             |
| ----------------------- | ------------------------- | ------------------ |
| Reduce seed data volume | Proportional reduction    | Low                |
| Shorter session expiry  | Fewer concurrent sessions | Already done (1hr) |
| Larger Heroku dyno      | More headroom             | $$                 |
| Periodic dyno restart   | Clears accumulated memory | Low                |

### Proper fix (significant refactor)

**Don't store seed data in sessions.**

Current flow:

```
Session = { participants: [...1000], events: [...1200], clinics: [...70], ... }
```

Better architecture:

```
Shared read-only: participants, events, clinics (loaded once at startup)
Session: { userId, tempFormData, userChanges: {...} }  // ~1KB not 3.6MB
```

This requires:

1. Keep seed data as shared module-level objects (not copied per-session)
2. Store only **deltas/changes** in session
3. Merge on read: `Object.assign({}, sharedDefaults, session.userChanges)`
4. Update all routes that modify `data.events[i]` to write to delta store

**Estimated effort:** Several days of refactoring + testing

### Alternative: Use Redis as a database (not just session store)

Store participants/events/clinics as **separate Redis keys**, not in session:

```javascript
// On startup
redis.set('participants', JSON.stringify(participants))
redis.set('events', JSON.stringify(events))

// On request - fetch only what's needed
const participant = await redis.hget('participants', participantId)

// On change - update just that record
await redis.hset('participants', participantId, JSON.stringify(updated))
```

This avoids the per-request serialize/deserialize of the full dataset.

**Estimated effort:** Similar to above - requires changing data access patterns throughout codebase.

## Files Modified During Investigation

| File            | Change                                          |
| --------------- | ----------------------------------------------- |
| `app/routes.js` | Added memory logging with session size tracking |

## Current State

- Memory logging is in place for monitoring
- Root cause is understood but proper fix requires significant refactoring
- Recommend: Reduce seed data volume as interim measure, plan proper fix for later
