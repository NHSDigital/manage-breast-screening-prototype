# Docs

Reference for people and coding assistants working on the prototype. The always-on instructions in [.github/copilot-instructions.md](../.github/copilot-instructions.md) summarise the rules and point here for detail.

## The service

- [domain.md](domain.md) - what breast screening is, the entities (units, participants, clinics, episodes, appointments) and the reading workflow. Read before any view or content work.

## Building pages

- [routing-and-forms.md](routing-and-forms.md) - how pages are served, how form data saves itself, when a route is needed, dynamic routing and the locals it provides, layouts. Read before adding a page, form or route.
- [referrers.md](referrers.md) - returning the user to where they came from with the referrer chain filters. Read for any link or form that goes somewhere and comes back.
- [validation.md](validation.md) - the rare cases that need validation, and how errors are flashed and rendered.
- [modal-system.md](modal-system.md) - forms that open in a modal overlay, progressively enhanced.
- [filtering.md](filtering.md) - checkbox filter panels on index pages, declared as data.

## Data

- [data-conventions.md](data-conventions.md) - the shared read-only seed data, working copies, update helpers, episodes and reading cases. Read before reading or changing participant, clinic, appointment or episode data.
- [utils-filter-reference.md](utils-filter-reference.md) - generated list of every helper and Nunjucks filter. Check before writing data or display logic. Regenerate with `npm run docs`.
- [data-generator-reference.md](data-generator-reference.md) - how seed data is generated and how to add or change a generator.
- [medical-information-generator.md](medical-information-generator.md) - how medical history, symptoms, breast density factors and other medical information are generated and stored.

## Image reading

- [image-reading.md](image-reading.md) - the reading section: sessions, cases, reads, arbitration, routes, layouts and data.
- [pacs-viewer.md](pacs-viewer.md) - the simulated PACS viewer window and the mammogram image sets.

## NHS Frontend

- [nhs-frontend-component-reference.md](nhs-frontend-component-reference.md) - every NHS.UK Frontend macro with parameters and examples. Generated; use the table of contents.
- [nhs-frontend-sass-reference.md](nhs-frontend-sass-reference.md) - every Sass mixin, function and variable. Generated; use the table of contents.

The conventions for using them are in `.github/instructions/nhs-frontend-guide.instructions.md` and `.github/instructions/nhs-prototype-kit-guide.instructions.md`.

## Testing

- [testing.md](testing.md) - the smoke suite (lint, route sweep, Playwright journeys), what it covers and how to add to it.
