# Testing

A small smoke suite that catches "the app is broken" regressions — server
errors, dead pages, broken core journeys. It is deliberately shallow and broad,
not a coverage exercise. Run it before opening a PR, and after any refactor
that moves code between modules.

```sh
npm test
```

That runs all three layers in order, cheapest first. Each can be run on its
own:

| Command                 | What it does                                         | Takes |
| ----------------------- | ---------------------------------------------------- | ----- |
| `npm run lint`          | ESLint over app, lib, scripts and tests              | ~2s   |
| `npm run test:routes`   | Requests every GET page and checks for server errors | ~20s  |
| `npm run test:journeys` | Drives the core journeys in a browser                | ~10s  |

## The three layers

**Lint** (`eslint.config.mjs`) exists mainly for `no-undef`. When code moves
between modules — a routes split, a rename — it is easy to leave a helper
behind in one file while its callers move to another. Node only throws when
that route actually runs, so nothing notices until someone clicks the page.
ESLint sees it statically. Tidiness rules are warnings; only things that are,
or hide, real breakage fail the run.

**Route sweep** (`scripts/route-sweep.js`) boots the app, enumerates every GET
route on the Express router, fills the URL parameters from the seeded data, and
requests each one. It also sweeps the pages served by the wildcard template
routes, which the router alone does not reveal. Any 5xx fails the run; 404s are
printed but tolerated, since some pages only resolve for particular ids.

Routes that change state — check-in, complete, regenerate — are skipped by
name, and the skip list is printed on every run so it stays visible.

**Journeys** (`tests/e2e/`) drive real flows in Chromium via Playwright. This is
the only layer that exercises POST handlers, session state and the client-side
JavaScript. Seven journeys:

- a screening appointment recording medical history and a symptom, from
  check-in to completion
- a screening appointment straight through with nothing to record
- an image reading session: normal opinions, then a recall for assessment with
  an annotation
- a technical recall, through its views-to-retake form and the review step
- deferring a case, then unflagging it from the deferred cases page
- a second reader reaching the comparison page and keeping their opinion
- a lazy session staying lazy across leaving and resuming it

Between them the reading journeys cover all four ways a reader can leave a case
— normal, recall for assessment, technical recall and deferral — which is what
makes them useful as a net under changes to how reading data is stored.

**Some pages render inside the shared modal, some break out of it.** With
`modalForms` on, the reading details forms and the review step load into the
modal, so ids there carry a `modal-` prefix and assertions must be scoped to
the modal — the page underneath has its own copy of the opinion buttons, and an
unscoped locator will match those instead. Recall for assessment and the
second-reader comparison deliberately break out to a full page. Which of the
two a step does is worth checking before writing selectors for it.

## Things worth knowing

**Tests derive their ids from the seed data.** The data regenerates daily, so
nothing is hard-coded — `tests/e2e/helpers/seed-data.js` picks a clinic running
today and an appointment on it. If a run fails with "seed data has no
appointment…", regenerate with `npm run generate`.

**Every spec pins the settings it depends on.** Journeys in this prototype
branch on session settings — whether forms open in modals, which annotation
mode image reading uses, and so on — and `app/data/session-data-defaults.local.js`
is gitignored, so defaults differ between machines. Each spec sets the settings
it needs via a query string on its first navigation, the same trick the dev
index page uses. See `tests/e2e/helpers/settings.js`.

**The test server does not watch for changes.** Both the sweep and the journeys
start the app with `PROXY=true`, which skips the kit's nodemon wrapper and
gives a single process that can be started and killed cleanly. It loads its
modules once at boot, so the suite always starts a fresh server rather than
reusing one — otherwise it would test the code as it was when that server
started.

**Sessions are isolated.** Per-session changes live in `data._changes`, overlaid
on the shared read-only store, so tests running in parallel do not tread on each
other and no test needs to clean up after itself.

**Debugging a failure.** Playwright keeps a trace for failed tests:

```sh
npx playwright test --ui                       # run interactively
npx playwright show-trace test-results/<dir>/trace.zip
```

## What is not covered

- Unit tests, coverage targets, testing utils in isolation
- Visual regression
- The image-marking annotation modes in image reading (`with-images-simple` and
  friends), which need pixel-accurate clicks on the mammogram views. The reading
  spec pins `without-images`, where the location is typed instead.
- Arbitration, and the second reader adopting the first reader's opinion
  (the comparison journey covers keeping their own)
- CI — the suite runs on demand, not on every push
