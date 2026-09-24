# TODO

- style-guide/modal.html references `layout-fragment.html`, which doesn't exist — real layout is `_templates/layout-modal-form.html`
- Reading case page: Case details "Reads" progress row duplicates the reads card rows — consider dropping it (app/views/reading/case.html)
- Modals are `overflow: clip` and scroll via `.app-modal__content`, so below-the-fold controls can't be scrolled into view programmatically — check nothing in the app relies on it (focus management, anchor links)
- Adopt generic filters on clinic lists, participants, episodes, reading history — brief at notes/archive/2026-08-24-reading-filters/brief-filter-adoption.md
- appointment.spec.js:62 (medical history and symptom) fails under parallel load, passes solo - the modal Save click times out
- `returnTo` treats `//evil.example` as a local path, so a posted form can redirect off-site (app/routes/reading.js, the startsWith('/') checks)
- Reading history rows and the case-index pagination render `href="#"` stand-ins that research participants will click and get nothing
- After #425 merges: move `closeClinicResolvedIds`, `closeReasonForm` and `closeRescheduleForm` under `data.closeClinicTemp[clinicId]`, and run Prettier on its files (clinics.js, close-clinic.js, _clinic-layout.scss, _app-styles.scss)
- Sass tidy: split `_workflow.scss` into component files, move the utilities in `_misc.scss` to `_utils.scss`, and delete its unused classes (`app-no-js-only`, `app-image-two-up`, `app-image-flip-horizontal`, `app-annotation-item`)
- `readingOpinionBanner` is a hand-rolled flash message because `req.flash` "couldn't get it to work" (`reading.js` ~1087); find out why and use flash
- `saveTempAppointmentToAppointment` saves `*Temp` keys (`symptomTemp`, `medicalHistoryTemp` etc) if a flow is abandoned and the appointment saved elsewhere; consider stripping them in the helper, after checking no flow relies on a temp surviving a mid-flow save
