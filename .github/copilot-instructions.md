# Working on this prototype

A prototype of Manage breast screening, an NHS service for running screening clinics and reading mammograms. Built on the NHS prototype kit: Node, Express, Nunjucks and NHS.UK Frontend. It is heavily data driven: realistic seed data is generated daily and populates almost every page.

Read [docs/domain.md](../docs/domain.md) before working on views or content. The docs index at the end of this file says what else to read and when.

## Beyond the kit

This is an advanced prototype, so some things differ from a plain prototype kit project and from the general kit guidance in `.github/instructions/`:

- Aiming for outward realism; internals can be faked. It may be hacky in places, and that is fine, but the codebase must stay maintainable because it is large and long-lived.
- There is a lint step and a small smoke suite (`npm test`: eslint, a route sweep, Playwright journeys). Keep them passing. Run them before opening a PR and after refactors that move code between modules. See [docs/testing.md](../docs/testing.md).
- Layouts live in `app/views/_templates/`, not the kit's single `layout.html`. Routes are split by area under `app/routes/`.
- Seed data is shared and read only. Writes go through working copies and update helpers. See [docs/data-conventions.md](../docs/data-conventions.md).
- No backwards compatibility needed for old seed data. Data regenerates daily, from `/settings`, and when the tests run, so never rely on a specific generated record or id persisting.
- Assume the app is already running. No need to start it.

## Where things are

- `app/views/` - pages, organised by area (clinics, participants, appointments, reading, episodes)
- `app/views/_templates/` - layouts. `app/views/_components/` and `app/views/_includes/` - reusable Nunjucks
- `app/views/style-guide/` - live style guide at `/style-guide/` showing every custom component
- `app/routes.js` and `app/routes/` - middleware and the routes that do real processing
- `app/lib/utils/` - helpers, all auto-registered as Nunjucks filters and globals. `app/filters/` - Nunjucks-only filters
- `app/lib/generators/` - seed data generation. `app/data/` - reference data and generated seed data
- `app/assets/` - Sass and client-side JavaScript
- `docs/` - the documentation this file points to
- `scripts/` and `tests/` - the smoke suite and the docs generator

## Forms, routes and navigation

These are the mistakes that happen most. [docs/routing-and-forms.md](../docs/routing-and-forms.md) has the detail.

- **Form data saves itself.** Every POST or GET field is merged into `req.session.data` by its `name` before any route runs. A form can post straight to the next page. Never write a route whose only job is to receive a form.
- **Read submitted values from `req.session.data`, never `req.body`.**
- **Pages under `/participants/:id/`, `/clinics/:id/appointments/:id/` and the reading workflow are served by dynamic routing.** Add a template, not a route. The middleware has already loaded `participant`, `appointment`, `clinic`, `episode` and URL locals such as `appointmentUrl`.
- **Write a route only for branching, saving, validation or real processing**, in the area's file under `app/routes/`, posting to a separate URL and finishing with `res.redirect()`.
- **Use the referrer filters for "return to where I came from"**: `urlWithReferrer` to go deeper, `getReturnUrl` to come back, `appendReferrer` to extend the chain. Never build `?returnTo=` or `?referrerChain=` by hand. See [docs/referrers.md](../docs/referrers.md).
- **Check for an existing helper before writing logic.** [docs/utils-filter-reference.md](../docs/utils-filter-reference.md) lists every filter and helper, with a table of contents from line 14. Prefer generic composable filters over one-offs; new ones go in `app/lib/utils/` and need a JSDoc comment (the reference is generated from them with `npm run docs`).
- **Validation is rare.** Only where missing data would break what follows. See [docs/validation.md](../docs/validation.md).

## Coding standards

- Modern JavaScript: `const`, arrow functions, template strings. No semicolons except in Sass. 2-space indentation. Allman style, with conditions on their own lines
- Descriptive names in plain English: `index` not `i`, `button` not `btn`
- Double quotes for strings in Nunjucks and HTML attributes; single quotes in JavaScript
- First line of every file is a comment with its path, for example `// app/routes/clinics.js` or `{# app/views/clinics/index.html #}`
- Comments explain purpose and non-obvious constraints. They do not record history or past bugs
- Nunjucks: `elseif` not `elif`, no trailing commas, object keys on separate lines, HTML in `set` or `call` blocks rather than inline
- Prefer NHS.UK Frontend macros over hand-written HTML, and look up parameter names in the component reference rather than guessing
- Sass: BEM with an `app-` namespace, full class names written out (no `&__` nesting), one file per block, NHS Frontend tokens not hard-coded values, no inline styles
- Server-side rendering first. Client-side JavaScript is progressive enhancement and everything must work without it
- Reuse before writing: an include, component, layout, helper or filter probably exists

## Content

- UK English spelling. Sentence case for headings, titles and buttons, never title case or all caps
- Smart quotes in user-facing text (‘ ’ and “ ”)
- Follow the NHS design system for patterns and content
- Lean copy: do not restate the heading in the sentence below it

## Working style

- Implement only what is asked. Suggest improvements rather than making them
- If a request is ambiguous or too broad, ask or propose a narrower reading before starting
- Say what changed and what remains after each unit of work
- Do not claim something works until it has been checked in the running app. When fixing a bug, verify the fix

## NHS design system references

Copilot applies the guides in `.github/instructions/` automatically when editing matching files. If your tool does not, read them:

- `.github/instructions/nhs-frontend-guide.instructions.md` - NHS Frontend components, Sass and content conventions
- `.github/instructions/nhs-prototype-kit-guide.instructions.md` - general prototype kit patterns (this repo goes beyond it, see above)
- [docs/nhs-frontend-component-reference.md](../docs/nhs-frontend-component-reference.md) - every macro with parameters. Table of contents near the top, or search for `## Component name`
- [docs/nhs-frontend-sass-reference.md](../docs/nhs-frontend-sass-reference.md) - every mixin, function and variable. Table of contents near the top

## Docs index

Read the doc before working in its area. [docs/README.md](../docs/README.md) has the same list with more detail.

| Doc | Read when |
|---|---|
| [domain.md](../docs/domain.md) | Any view or content work; anything touching screening concepts |
| [routing-and-forms.md](../docs/routing-and-forms.md) | Adding a page, form or route |
| [referrers.md](../docs/referrers.md) | Any link or form that returns the user somewhere |
| [data-conventions.md](../docs/data-conventions.md) | Reading or changing participants, clinics, appointments, episodes |
| [utils-filter-reference.md](../docs/utils-filter-reference.md) | Before writing any data or display logic |
| [validation.md](../docs/validation.md) | Adding form validation or error messages |
| [modal-system.md](../docs/modal-system.md) | Forms that open in a modal |
| [filtering.md](../docs/filtering.md) | Index pages with filter panels |
| [image-reading.md](../docs/image-reading.md) | Anything in the reading workflow or reading data |
| [pacs-viewer.md](../docs/pacs-viewer.md) | The mammogram viewer window and image sets |
| [data-generator-reference.md](../docs/data-generator-reference.md) | Changing how seed data is generated |
| [medical-information-generator.md](../docs/medical-information-generator.md) | Medical history, symptoms and other medical information data |
| [issues.md](../docs/issues.md) | Raising, showing or resolving issues, or the Review pages |
| [testing.md](../docs/testing.md) | Running or adding to the smoke suite |
