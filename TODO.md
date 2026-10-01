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
- Saving an appointment note or special appointment partway through a workflow commits the whole working copy: unsaved edits and `*Temp` stores. "Discard changes" can't undo those edits, and manual imaging's repeats step depends on `mammogramDataTemp` surviving the save. Decide whether these saves should write only their own field
- Inline HTML built as single-quoted Nunjucks strings; move into set blocks: reading/case.html (108, 327), reading/arbitration/start.html (27), _includes/appointment-status-bar.njk (47, 114), _includes/reading/reading-status-bar.njk (98, 112), _includes/forms/contact-details.njk (23, 33), _includes/episodes/reading-cases-table.njk (19)
