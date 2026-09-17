# Routing and forms

How pages get served and how form data gets saved in this prototype. Read this before adding a page, a form or a route. Most of the time you need a template and nothing else.

## The request pipeline

The prototype kit runs these in order on every request:

1. **Auto-store data** - everything in the POST body and the query string is merged into `req.session.data`, using the field `name` as the key. Fields starting with `_` are skipped.
2. **App locals** ([app/locals.js](../app/locals.js)) - sets `currentUrl`, `referrerChain`, `query`, `flash`, `currentUser`, `currentBSU` for every view.
3. **Our routes** ([app/routes.js](../app/routes.js) and the files in [app/routes/](../app/routes/)) - middleware that loads the participant, appointment, clinic or episode named in the URL, plus the handful of routes that do real processing.
4. **Redirect POST to GET** - any POST that no route handled is redirected to a GET of the same URL.
5. **Auto-routes** - a GET for `/foo/bar` renders `app/views/foo/bar.html`, or `app/views/foo/bar/index.html`.

The consequences of that order are the rules below.

## Form data saves itself

A form can post to any URL. Its fields are already in the session before any route runs, so the receiving page just renders with the new data. There is nothing to write to "receive" a form.

```njk
{# app/views/participants/questionnaire/health-status.html #}
{% set formAction = "./current-symptoms" %}

{% block pageContent %}
  {{ radios({
    name: "participant[healthStatus]",
    value: participant.healthStatus,
    ...
  }) }}
  {{ button({ text: "Continue" }) }}
{% endblock %}
```

Posting this saves `data.participant.healthStatus` and lands on `current-symptoms`, which is served by the next template. No route.

Rules that follow:

- **Do not write a route whose only job is to receive a form.** If the next page is a template, post straight to it.
- **Read submitted values from `req.session.data`, never `req.body`.** By the time a route runs, the body has already been merged into the session. Reading `req.body` bypasses the session and breaks the auto-store behaviour everything else relies on. The only exceptions are JSON endpoints called from client-side JavaScript.
- **Name fields for where the data should live.** `name="participant[healthStatus]"` stores to `data.participant.healthStatus`. Prefer a structured object like `appointment[...]` or `participant[...]` over new top-level keys on `data`.
- **Prefill from the same place.** Give the component `value` (or `values` for checkboxes) from the object the field writes to.
- Unchecked checkboxes send nothing, so the kit's hidden `_unchecked` value is what clears a previously ticked box. The NHS macros handle this for you.

## Working copies and saving

The generated records (`data.participants`, `data.appointments`, `data.clinics`, `data.episodes`) are shared and read only. Forms write to a working copy, `data.participant` or `data.appointment`, which the URL middleware sets up. A save route then copies the working copy back through the update helpers. See [data-conventions.md](data-conventions.md) for the rules and the helper names.

So the shape of a multi-page form is: pages post to each other, all writing into the working copy, and one final "save" route at the end.

## When you do need a route

Write a route only for something a template cannot do:

- **Branching** - the next page depends on what was submitted. Read the answer from `req.session.data`, then `res.redirect()`.
- **Saving** - copying a working copy back to the shared record, usually via the update helpers.
- **Validation** - checking required data and redirecting back with `req.flash('error', ...)`. Only on pages where missing data would break what follows. See [validation.md](validation.md).
- **Processing** - calculations, generating records, changing status, anything that is not a straight copy of the form.
- **JSON endpoints** for client-side JavaScript.

Conventions for routes:

- Put them in the file for their area under [app/routes/](../app/routes/), not in `app/routes.js`.
- Post to a separate URL from the page (`foo-answer`, `save`, `complete`), never to the page itself.
- Use `res.redirect()` afterwards, never `res.render()` from a POST.
- Match the URL to the journey, for example `/clinics/:clinicId/appointments/:appointmentId/...`.

Before writing one, check whether a template already covers the URL (next section) and whether an existing route or helper already does the processing.

## URLs with ids: dynamic routing

Sections whose URLs carry an id do not need a template per id. The area's middleware loads the record, then a wildcard route renders whatever template matches the rest of the path:

| URL prefix | Middleware loads | Templates under |
|---|---|---|
| `/participants/:participantId/...` | `participant`, `participantId`, `participantUrl`, `contextUrl`, `originalParticipant` | `app/views/participants/` |
| `/clinics/:clinicId/appointments/:appointmentId/...` | `appointment`, `appointmentData`, `appointmentUrl`, `appointmentId`, `clinic`, `clinicId`, `participant`, `participantId`, `episode`, `unit`, `contextUrl`, `pageContext` | `app/views/appointments/` |
| `/reading/session/:sessionId/appointments/:appointmentId/...` | `readingCase`, `session`, `sessionId`, `appointment`, `appointmentId`, `participant`, `clinic`, `unit`, `progress`, `isReadingWorkflow` | `app/views/reading/` |

So `/participants/abc123/show` renders `app/views/participants/show.html` with `participant` already set, and `/participants/abc123/questionnaire/summary` renders `app/views/participants/questionnaire/summary.html`. To add a page to one of these sections, add the template. The wildcard route is `createDynamicTemplateRoute` in [app/lib/utils/dynamic-routing.js](../app/lib/utils/dynamic-routing.js); the middleware is at the top of each routes file.

Use the provided URL locals when building links: `participantUrl`, `appointmentUrl`, `contextUrl`. Relative links (`./edit`, `../`) also work well within a section.

## Layouts and page conventions

Layouts live in [app/views/_templates/](../app/views/_templates/) and are extended by bare name:

- `layout-app.html` - the default. Flash messages, optional page navigation block, grid column (two thirds by default, set `gridColumn`), and a form wrapper.
- `layout-appointment.html` - the appointment workflow, with its step navigation.
- `layout-reading.html` - the reading workflow.
- `layout-medical-history-form.html`, `layout-modal-form.html` - specialised forms. See [modal-system.md](modal-system.md) for modal forms.
- `layout-base.html` - the bare shell the others build on; rarely extended directly.

Page conventions:

- Start the file with a comment naming it: `{# app/views/participants/show.html #}`.
- `{% set pageHeading = "..." %}` and put content in `{% block pageContent %}`. Back links go in `{% block beforeContent %}`.
- Setting `formAction` makes the layout wrap the page in a form posting there. Setting `isForm` does the same with the current URL. Do not add a second `<form>` inside.
- Reuse `_includes/` and `_components/` before writing new markup. The style guide at `/style-guide/` shows every custom component.

## Common mistakes

| Mistake | Instead |
|---|---|
| A `router.post` that only reads fields and redirects | Post the form straight to the next template |
| `const foo = req.body.foo` | `const foo = req.session.data.foo` (or the working copy it was named into) |
| A `router.get` that renders a template under `/participants/:id/` | Just add the template; dynamic routing serves it |
| Building `/clinics/${clinicId}/appointments/${appointmentId}` in a view | Use `appointmentUrl` |
| Manually adding `?referrerChain=` or `?returnTo=` to links | Use the referrer filters, see [referrers.md](referrers.md) |
| Writing straight to `data.participants[...]` | Write to the working copy, then save through the update helpers |
