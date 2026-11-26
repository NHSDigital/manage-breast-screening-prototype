// app/assets/javascript/lib/regions.js
//
// Re-render parts of the page in place from a fresh copy of the current page.
// Used by live-updates.js and by pages that refresh their own regions. Kept
// outside the entry point glob in app.js so it isn't built on its own.
//
// The request carries an X-Region-Refresh header. The server treats it as a
// background read rather than a visit, so it doesn't use up flash messages or
// clear answers that a form on the page still needs (see app/locals.js).

import { Idiomorph } from 'idiomorph'

// The version is stored on the region itself, so separately bundled scripts
// refreshing the same region agree on which refresh is the latest
const beginRefresh = (region) => {
  const version = Number(region.dataset.refreshVersion || 0) + 1
  region.dataset.refreshVersion = version
  return version
}

const isCurrentRefresh = (region, version) =>
  Number(region.dataset.refreshVersion) === version

// Each region needs an id that the fresh page also has, unless it is in
// options.optional, which are left alone when the fresh page no longer has
// them. A region a newer refresh has since claimed is left to that refresh.
// Resolves with the regions refreshed and their fresh copies, and rejects only
// if a required region still waiting on this refresh could not be refreshed.
export const refreshRegionsFromPage = async (regions, options = {}) => {
  const optional = new Set(options.optional || [])
  const versions = new Map(
    regions.map((region) => [region, beginRefresh(region)])
  )
  const isCurrent = (region) => isCurrentRefresh(region, versions.get(region))

  try {
    const response = await window.fetch(window.location.href, {
      headers: { 'Accept': 'text/html', 'X-Region-Refresh': '1' }
    })
    if (!response.ok) throw new Error(`Request failed: ${response.status}`)

    const html = await response.text()
    const freshDocument = new DOMParser().parseFromString(html, 'text/html')
    const refreshed = []

    for (const region of regions.filter(isCurrent)) {
      const freshRegion = region.id
        ? freshDocument.getElementById(region.id)
        : null
      if (!freshRegion) {
        if (optional.has(region)) continue
        throw new Error('Region missing from the response')
      }

      // innerHTML keeps the region element and any listeners on it. Ignoring
      // the active value stops a refresh overwriting what is being typed.
      Idiomorph.morph(region, freshRegion.children, {
        morphStyle: 'innerHTML',
        ignoreActiveValue: true
      })
      refreshed.push({ region, freshRegion })
    }

    return refreshed
  } catch (error) {
    const isRequired = (region) => !optional.has(region)
    if (regions.filter(isRequired).some(isCurrent)) throw error
    return []
  }
}
