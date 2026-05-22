# Validation

LLM-focused reference for adding form validation to pages in this prototype.

## When to validate

Most pages don't need validation. Add it only on:
- Crucial pages where missing data would break downstream logic
- Pages where we specifically want to test validation UX

## How it works

1. **Route** checks submitted data, builds error objects, flashes them, redirects back
2. **Layout** renders the error summary automatically (no page-level code needed)
3. **Template** uses `| populateErrors` filter on form components to show inline errors

## Error object shape

Each error object has three properties:

```javascript
{
  text: "Select why this appointment has been stopped",  // Error message shown to user
  name: "event[appointmentStopped][stoppedReason]",      // Matches component's `name` param
  href: "#stoppedReason"                                  // Links to the field's id in error summary
}
```

- `name` must exactly match the form component's `name` attribute — this is how `populateErrors` matches errors to components
- `href` should point to the element id (with `#` prefix) for the error summary link to scroll to

## Route pattern

```javascript
router.post('/clinics/:clinicId/events/:eventId/my-page-answer', (req, res) => {
  const { clinicId, eventId } = req.params
  const data = req.session.data

  const someField = data.event.someField

  if (!someField) {
    req.flash('error', {
      text: 'Select an option',
      name: 'event[someField]',
      href: '#someField'
    })
    res.redirect(`/clinics/${clinicId}/events/${eventId}/my-page`)
    return
  }

  // Multiple errors
  const errors = []
  if (!data.event.fieldA) {
    errors.push({
      text: 'Enter field A',
      name: 'event[fieldA]',
      href: '#fieldA'
    })
  }
  if (!data.event.fieldB) {
    errors.push({
      text: 'Select field B',
      name: 'event[fieldB]',
      href: '#fieldB'
    })
  }

  if (errors.length) {
    errors.forEach((err) => req.flash('error', err))
    res.redirect(`/clinics/${clinicId}/events/${eventId}/my-page`)
    return
  }

  // Success — continue
  res.redirect(`/clinics/${clinicId}/events/${eventId}/next-page`)
})
```

## Template pattern

### Standard components (input, radios, checkboxes, textarea, select)

Pipe the component config through `| populateErrors`:

```njk
{{ radios({
  name: "event[someField]",
  value: event.someField,
  fieldset: {
    legend: {
      text: "Select an option",
      classes: "nhsuk-fieldset__legend--m"
    }
  },
  items: [
    { value: "Yes", text: "Yes" },
    { value: "No", text: "No" }
  ]
} | populateErrors) }}
```

The filter looks up `flash.error` for an error with a matching `name` and adds `errorMessage` to the component config automatically.

### dateInput and components using namePrefix

`dateInput` uses `namePrefix` not `name`, but `populateErrors` handles both — just pipe it as normal:

```njk
{{ dateInput({
  id: "dateStarted",
  namePrefix: "event[symptomTemp][dateStarted]",
  hint: { text: "For example, 3 2025" },
  items: [
    { name: "month", classes: "nhsuk-input--width-2", value: event.symptomTemp.dateStarted.month },
    { name: "year", classes: "nhsuk-input--width-4", value: event.symptomTemp.dateStarted.year }
  ]
} | populateErrors) }}
```

### Fieldsets wrapping custom layouts (e.g. split columns)

When radios/checkboxes are split across columns and can't use `populateErrors` directly on the component (because the fieldset is separate), use `getFlashError` manually:

```njk
{% set _locationError = 'event[symptomTemp][location]' | getFlashError %}

<div class="nhsuk-form-group{{ ' nhsuk-form-group--error' if _locationError else '' }}">
  {% call fieldset({
    legend: { text: "Where is it located?", classes: "nhsuk-fieldset__legend--m" },
    describedBy: "location-error" if _locationError
  }) %}

    {% if _locationError %}
      {{ errorMessage({
        id: "location-error",
        text: _locationError.text
      }) }}
    {% endif %}

    {# Split radios across columns here #}

  {% endcall %}
</div>
```

## Error summary

The error summary is rendered automatically by the layout. No page-level code is needed — `_includes/flash-messages.njk` renders it when `flash.error` exists:

```njk
{% if flash.error %}
  {{ errorSummary({
    titleText: "There is a problem",
    errorList: flash.error
  }) }}
{% endif %}
```

This works because the `errorList` array uses the same `{ text, href }` shape that NHS `errorSummary` expects.

## How flash gets to templates

- `app/locals.js` sets `res.locals.flash = req.flash()` on every request
- Templates access it as `flash.error`, `flash.success` etc.
- Flash messages are consumed on read — they only appear once after the redirect

## Modal forms

When a form can be submitted inside a modal (AJAX), the route must handle both paths:

```javascript
const isModal = req.headers['x-requested-with'] === 'XMLHttpRequest'

if (errors.length) {
  if (isModal) {
    // Re-render the form fragment with errors (no redirect)
    return res.status(422).render('my-page', {
      flash: { error: errors }
    })
  }
  // Standard redirect for non-JS
  errors.forEach((err) => req.flash('error', err))
  return res.redirect('/my-page')
}
```

## Quick checklist

- [ ] Route posts to a separate `-answer` URL (not same page)
- [ ] Each error has `text`, `name`, and `href`
- [ ] `name` matches the component's `name` attribute exactly
- [ ] `href` matches the field's `id` attribute (with `#` prefix)
- [ ] Components use `| populateErrors` (or `getFlashError` for dateInput/custom layouts)
- [ ] On error, redirect back to the form page (errors show automatically)
- [ ] On success, redirect forward to next page
