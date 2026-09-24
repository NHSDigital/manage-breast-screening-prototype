# Review checklist

What to check before a change is merged. The rules are all written elsewhere in these docs; this page gathers the ones that most often go wrong, with how to spot each in a diff and what to do instead. The examples are real problems from past pull requests.

It is written for a reviewer, human or agent, looking at a change with fresh eyes. The aim is a codebase that stays consistent, so the next person (or agent) copying nearby code copies something good.

## Getting the change

Review everything that differs from `main`, committed or not:

```sh
git fetch origin main
BASE=$(git merge-base origin/main HEAD)
git diff $BASE --stat          # files changed
git diff $BASE                 # the full change, including uncommitted work
git status --porcelain         # new files not yet added show as ??
```

To search only the lines the change adds:

```sh
git diff $BASE -U0 | grep '^+' | grep -nE 'pattern'
```

Read the changed files in full, not only the diff. Most of the serious problems below are only visible in context: logic that already exists elsewhere, or code that reads the data that changed.

## Severity

- **Must fix** - breaks a rule in this checklist or the docs, or will cause a bug. Examples: a route that only receives a form, a hand-built return URL, a new field the seed data never generates.
- **Should fix** - works, but makes the code harder to live with. Examples: duplicated logic, a name that differs from the rest of the code.
- **Ask Ed** - a design or product judgement a reviewer should not make alone. Say what the choice is and what each option means.

## 1. Routes and form data

Read [routing-and-forms.md](routing-and-forms.md).

- A route whose only job is to receive a form and redirect. Form data saves itself; post straight to the next page.
- `req.body` in a route. Read from `req.session.data`. The only exception is a JSON endpoint called from client-side JavaScript.
- A `router.get` rendering a template under `/participants/:id/`, `/clinics/:id/appointments/:id/` or the reading workflow. Dynamic routing already serves it; add the template only.
- A POST that renders instead of redirecting, or posts to its own URL.
- Several near-identical routes differing by one word. Use one route with a parameter and a lookup object.

Spot it: `grep -nE 'req\.body|router\.(get|post)\('` on added lines, then ask of each new route: what does this do that a template could not?

> **Past example.** A close-clinic page added eight GET routes (`attended-not-screened`, `undo-attended-not-screened`, `did-not-attend`, their `-all` versions and so on), each repeating the same state and response code. It became two routes, `set-status/:appointmentId/:status` and `set-status-all/:status`, driven by one config object.

## 2. Returning the user: referrers

Read [referrers.md](referrers.md).

- Any hand-built return query string: `?returnTo=`, `?returnPath=`, `?context=`, `?referrerChain=`, or a return URL kept in session data.
- `urlWithReferrer` on a back or continue link (use `getReturnUrl`), or `getReturnUrl` without a fallback.
- `urlWithReferrer(currentUrl)` from a page that may itself be inside a flow (use `referrerChain | appendReferrer(currentUrl)`).

Spot it: `grep -nE 'returnTo|returnPath|context=|referrerChain=|returnUrl'` on added lines.

> **Past example.** A "change mammographer" link was built on four pages as `appointmentUrl + "/change-mammographer?context=take-images&returnPath=take-images"`, and the route read `req.query.returnPath` to decide where to go back. It became `urlWithReferrer(referrerChain | appendReferrer(currentUrl))` on the link and `getReturnUrl(fallback, req.query.referrerChain)` in the route.

## 3. Where data lives

Read [data-conventions.md](data-conventions.md).

- **New top-level keys on `data`** such as `data.someFlag` or a field `name="someAnswer"`. Name fields for where the data belongs: `appointment[...]`, `participant[...]`. Form state that should not touch the record until saved goes in a namespaced temp store, named `<thing>Temp`: on the working copy (`appointment[authorisedMammographerTemp][userId]`) or, for a whole workflow, one object on `data` (`data.imageReadingTemp`). A feature's session state lives in one named object, never a scatter of flat keys.
- **Writing to `req.session.<anything>` other than `req.session.data`.** Everything lives under `data`.
- **Mutating a shared record** from `data.appointments`, `data.participants`, `data.clinics` or `data.episodes`. It is silently ignored in development. Use the update helpers or the working copy.
- **Storing a display string where an id belongs.** Store a user id, and turn it into a name at display time with a helper or filter.
- **Hidden inputs carrying data the session already has**, added so a value survives an unrelated form post. The session already holds it.

Spot it: `grep -nE 'data\.[a-zA-Z]+ *=|req\.session\[|req\.session\.[a-zA-Z]+ *=|appHiddenInput|type="hidden"'` on added lines, and every new `name="..."` attribute.

> **Past example.** The chosen mammographer was saved as `data.irmerAuthoriser` and `data.irmerAuthoriserOther`, deleted by hand at the end of the route, and the result stored as a formatted name (`appointment.operator = "S. Patel"`), so other pages had to compare name strings to work out who it was. It became `appointment[authorisedMammographerTemp][userId|otherName]` while editing and a user id on the appointment once saved.
>
> **Past example.** Close-clinic progress was stored as `req.session['closeClinicResolved_' + clinicId]`, outside `data`. It became `data.closeClinicResolvedIds[clinicId]` behind two small helpers.

## 4. Real data, not typed-in data

- Names, users, options or counts typed into a template when the data exists. Users are in `data.users`, permissions in `roles-and-permissions.js`, reference data in `app/data/`. Typed-in data goes stale and disagrees with the rest of the prototype.
- A new data field or status with no seed data. Every field a page reads needs generating, at realistic rates, so the page shows real variety. See [data-generator-reference.md](data-generator-reference.md).
- Generators left behind: a generator or probability that no longer fits the new rules (for example, generated records missing a value the new flow now requires), or one producing a field nothing reads any more.

Spot it: string literals of people's names or list options in templates. For every new field read in a view, search `app/lib/generators/` for where it is created.

> **Past example.** The "choose mammographer" radios listed five made-up names (`S. Patel`, `R. Thompson`, and so on). They became the real users able to screen the appointment, sorted by surname, using `canUserScreenAppointment`.
>
> **Past example.** Seed data gave attended-not-screened appointments a reason only 70% of the time. Once closing a clinic required a reason, that left records the new flow could not handle, so generation became unconditional.

## 5. Reuse before writing

Check [utils-filter-reference.md](utils-filter-reference.md) (table of contents near the top), `app/views/_includes/`, `app/views/_components/` and the style guide at `/style-guide/` before accepting new logic or markup.

- **Modals.** Use `openInModal`, `parentLayout`, `modalBreakout` and the modal layout. See [modal-system.md](modal-system.md). No hand-rolled `_modal` checks or modal markup.
- **Index page filters.** Use the filter groups, `filter-list.js` helpers and `appFilterPanel`. See [filtering.md](filtering.md).
- **In-place updates without a page reload.** Use `fragment-actions.js`: mark the link with `data-fragment-action`, wrap the changing markup in an element with `data-fragment-id` rendered from a shared include, and have the route render that include when `req.xhr`. `close-clinic-appointment-row.njk` is an example.
- **Validation.** Use the flash and `populateErrors` pattern in [validation.md](validation.md).
- **Duplicated logic.** The same condition or block of markup written on more than one page belongs in one helper (`app/lib/utils/`, with a JSDoc comment) or one include, used everywhere. Watch especially for the same decision being made differently on different pages.
- **Helpers that already exist.** Dates, names, statuses, pluralisation, summary list rows and tags all have filters. A new helper duplicating one is a finding.

> **Past example.** Whether an appointment needed an implant-trained mammographer was worked out in about 80 lines inline on one page, while three other pages needed the same answer. It became `getImplantImagingReason` in `roles-and-permissions.js` and one include, `_includes/authorised-mammographer.njk`, used on all four.

## 6. Building HTML

- HTML assembled by string concatenation in routes, utils or client-side JavaScript. Use a Nunjucks macro or include; in templates, build HTML in a `set` or `call` block, never inline.
- Client-side JavaScript that recreates markup the server already renders (tags, action links, rows). It will drift from the server version. Fetch the server-rendered fragment instead (see section 5).
- Hand-written HTML where an NHS.UK Frontend macro exists. Look up the parameters in [nhs-frontend-component-reference.md](nhs-frontend-component-reference.md) rather than guessing.
- Inline `<script>` blocks in views. Client-side code is a module in `app/assets/javascript/`, and the page must still work without it.

> **Past example.** A 129-line inline script rebuilt status tags and action links as strings (`renderTag`, `renderActionCell`). It was replaced by a server-rendered row include and a small module that swaps the fragment in, later reused on two other pages.

## 7. Styling

Read `.github/instructions/nhs-frontend-guide.instructions.md` and [nhs-frontend-sass-reference.md](nhs-frontend-sass-reference.md).

- `style="..."` in templates. Use an NHS Frontend class or utility, or a new BEM class in Sass.
- Piles of utility or override classes on one element to force a look. If a component needs a variant, make a modifier.
- Sass not in BEM form: classes need the `app-` namespace, full class names written out (no `&__`, `&--`, `&-`), one block per file, and NHS Frontend tokens and mixins instead of hard-coded colours, spacing or font sizes.
- Rules for one component added to another component's file.
- Rules moved in or out of a wrapper such as `.app-compact-mode`, or a shared class restyled. Check every other page using that class.

Spot it: `grep -nE 'style="|#[0-9a-fA-F]{3,6}\b|&(__|--|-)'` on added lines.

> **Past example.** Table column widths were set with `style="width: 25%"` and the table's rules were added to the shared `_compact.scss`. They moved into a new `_clinic-appointments-table.scss`.

## 8. One name per concept

- The same thing called different names across variables, data keys, field names, route URLs, template file names and copy. This usually happens when something is renamed partway through. Pick the name the interface uses and apply it everywhere.
- A rename left half done. Search the whole repo for the old name, including templates, routes, generators, tests and docs.
- Names that do not match the domain vocabulary in [domain.md](domain.md).
- Route parameters that differ for the same thing (`:id` in one route, `:clinicId` in the next).

> **Past example.** One feature used `operator`, `irmerAuthoriser`, `mammographer` and `authorisedMammographer` for the same person, and `/change-mammographer` for its route. Everything became `authorisedMammographer*`, including data keys and the URL.

## 9. Knock-on effects of data changes

The most expensive mistakes are changes that look right on the page being worked on but break or mislead somewhere else.

For every data key, field, status value, or data shape the change adds, renames, removes or starts using differently:

1. Search the whole repo for it: `app/views`, `app/routes`, `app/lib/utils`, `app/lib/generators`, `app/filters`, `tests`, `docs`.
2. Check every reader still gets what it expects. Watch for status maps, summaries, filters and counts on other pages.
3. Check the seed data generates it (section 4).
4. For appointment status changes, use `updateAppointmentStatus`, which also moves the episode on. See the episodes section of [data-conventions.md](data-conventions.md).
5. If a page now behaves differently for some records, check that each kind of record still has a sensible page, for example participants with and without the new field.

## 10. Conventions

From [copilot-instructions.md](../.github/copilot-instructions.md):

- First line of every new JavaScript, Nunjucks or Sass file is a comment with its path. Not Markdown files, which start with front matter or a heading.
- JavaScript: no semicolons, 2-space indent, `const` and arrow functions, conditions on their own lines, descriptive names.
- Nunjucks: `elseif` not `elif`, double quotes, object keys on separate lines, no trailing commas.
- Comments explain purpose, not history.
- Content: UK English, sentence case, smart quotes, lean copy that does not repeat the heading.

Spot it: `grep -nE '\{%-? *elif'` on added Nunjucks lines, `grep -nE ';$'` on added JavaScript lines (Sass uses semicolons), and check the first line of each new code file.

## 11. Tests and docs

- `npm test` passes: lint, the route sweep and the journeys. See [testing.md](testing.md).
- A changed core journey should have its Playwright test updated, not deleted.
- A new GET route that changes data (marks a status, undoes one) is added to the skip list in `scripts/route-sweep.js`. Otherwise the sweep calls it and changes seeded data mid-run.
- A new or changed helper in `app/lib/utils/` has a JSDoc comment, and `npm run docs` has been run.
- A new pattern others will reuse is described in the relevant doc.
