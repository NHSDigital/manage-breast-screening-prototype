// app/assets/javascript/pacs-viewer-broadcast.js
//
// Tells an open PACS viewer window which study this page shows, from the meta
// tags in _includes/images/pacs-viewer-meta.njk. A classic script loaded in
// the head, straight after those tags, so it runs before the page finishes
// loading rather than waiting for the modules at the end of the body.

;(() => {
  if (typeof BroadcastChannel === 'undefined') return

  const getMeta = (name) =>
    document.querySelector(`meta[name="${name}"]`)?.getAttribute('content') ??
    null

  const appointmentId = getMeta('mammogram-appointment-id')
  const participantName = getMeta('mammogram-participant-name')
  if (!appointmentId || !participantName) return

  const allPaths = getMeta('mammogram-all-paths')
  const context = getMeta('mammogram-context')

  new BroadcastChannel('mammogram-viewer').postMessage({
    type: 'show',
    appointmentId,
    participantName,
    nhsNumber: getMeta('mammogram-nhs-number'),
    sxNumber: getMeta('mammogram-sx-number'),
    dateOfBirth: getMeta('mammogram-date-of-birth'),
    images: {
      rcc: getMeta('mammogram-image-rcc') || null,
      lcc: getMeta('mammogram-image-lcc') || null,
      rmlo: getMeta('mammogram-image-rmlo') || null,
      lmlo: getMeta('mammogram-image-lmlo') || null
    },
    allPaths: allPaths ? JSON.parse(allPaths) : null,
    hasAdditionalImages: getMeta('mammogram-has-additional') === 'true',
    setId: getMeta('mammogram-set-id'),
    setDescription: getMeta('mammogram-set-description'),
    setTag: getMeta('mammogram-set-tag'),
    context: context ? JSON.parse(context) : null,
    timestamp: Date.now()
  })
})()
