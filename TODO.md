# TODO

- style-guide/modal.html references `layout-fragment.html`, which doesn't exist — real layout is `_templates/layout-modal-form.html`
- Reading case page: Case details "Reads" progress row duplicates the reads card rows — consider dropping it (app/views/reading/case.html)
- Modals are `overflow: clip` and scroll via `.app-modal__content`, so below-the-fold controls can't be scrolled into view programmatically — check nothing in the app relies on it (focus management, anchor links)
