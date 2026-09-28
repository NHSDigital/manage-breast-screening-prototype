// app/lib/utils/referrers.js

/**
 * Referrer chain navigation
 *
 * Multi-level "return to where you came from" via a `referrerChain` query
 * parameter: a comma-separated list of paths that grows as the user goes
 * deeper and is popped as they come back. See docs/referrers.md for the
 * patterns and worked example.
 *
 * In templates, `currentUrl` and `referrerChain` are locals (app/locals.js).
 */

/**
 * Parse referrer string into array of URLs
 *
 * @private
 * @param {string|Array} referrerChain - Referrer string or array
 * @returns {Array} Array of referrer URLs
 */
const parseReferrerChain = (referrerChain) => {
  if (!referrerChain) return []
  if (Array.isArray(referrerChain)) return referrerChain
  return referrerChain.split(',').filter(Boolean)
}

/**
 * Get destination from referrer chain, falling back to provided URL if no referrer
 * Automatically converts URL fragments to scrollTo query parameters for server redirects
 *
 * @param {string} url - Default URL to use if no referrer
 * @param {string} referrerChain - Referrer chain
 * @param {string|false} [scrollToId] - Optional element ID to scroll to on return
 * @returns {string} URL to use for back link
 * @example
 * <a href="{{ '/default-path' | getReturnUrl(referrerChain) }}">Back</a>
 *
 * // In routes with scrollTo:
 * const scrollTo = req.query.scrollTo
 * const returnUrl = getReturnUrl('/default-path', referrerChain, scrollTo)
 *
 * // URL fragments take precedence over scrollToId parameter:
 * // If referrer contains '#section1' and scrollToId is 'section2',
 * // the result will use 'section1'
 */
const getReturnUrl = function (url, referrerChain, scrollToId = false) {
  // Get currentUrl from context if available
  const currentUrl = this?.ctx?.currentUrl

  const chain = parseReferrerChain(referrerChain).filter((ref) => {
    // Extract base URL without fragment for comparison
    const refBase = ref.split('#')[0]
    return refBase !== currentUrl
  })

  if (!chain.length) {
    // No chain - use default URL, but add scrollToId if provided
    if (scrollToId) {
      const separator = url.includes('?') ? '&' : '?'
      return `${url}${separator}scrollTo=${scrollToId}`
    }
    return url
  }

  // Get the destination URL (single referrer or last in chain)
  let destination
  let remainingChain = []

  if (chain.length === 1) {
    destination = chain[0]
  } else {
    remainingChain = chain.slice(0, -1)
    destination = chain[chain.length - 1]
  }

  // Determine which scrollTo to use (fragment takes precedence over parameter)
  let finalScrollTo = null

  if (destination.includes('#')) {
    const [baseUrl, fragment] = destination.split('#')
    destination = baseUrl // Remove fragment from destination
    finalScrollTo = fragment
  } else if (scrollToId) {
    finalScrollTo = scrollToId
  }

  // Build the final URL
  let finalUrl = destination
  const queryParams = []

  // Add remaining chain if needed
  if (remainingChain.length > 0) {
    queryParams.push(`referrerChain=${remainingChain.join(',')}`)
  }

  // Add scrollTo if we have one
  if (finalScrollTo) {
    queryParams.push(`scrollTo=${finalScrollTo}`)
  }

  // Append query params if we have any
  if (queryParams.length > 0) {
    const separator = destination.includes('?') ? '&' : '?'
    finalUrl += `${separator}${queryParams.join('&')}`
  }

  return finalUrl
}

/**
 * Add referrer to URL as query parameter with optional scroll anchor
 *
 * @param {string} url - Base URL
 * @param {string} referrerChain - Referrer to append
 * @param {string} [scrollToId] - Optional element ID to scroll to on return
 * @returns {string} URL with referrer query param and optional scrollTo
 * @example
 * <a href="{{ '/next-page' | urlWithReferrer(referrer) }}">Continue</a>
 * <a href="{{ '/next-page' | urlWithReferrer(referrer, 'current-symptoms') }}">Continue</a>
 */
const urlWithReferrer = (url, referrerChain, scrollToId = false) => {
  if (!referrerChain) return url

  // Check if URL already has query parameters
  const separator = url.includes('?') ? '&' : '?'
  let resultUrl = `${url}${separator}referrerChain=${referrerChain}`

  // Add scrollTo parameter if provided
  if (scrollToId) {
    resultUrl += `&scrollTo=${scrollToId}`
  }

  return resultUrl
}

/**
 * Append a URL to an existing referrer chain
 *
 * @param {string|Array} existingReferrerChain - Existing referrer chain
 * @param {string} newUrl - URL to append
 * @returns {string} Combined referrer chain
 * @example
 * {% set updatedReferrer = referrerChain | appendReferrer(currentUrl) %}
 */
const appendReferrer = (existingReferrerChain, newUrl) => {
  if (!newUrl) return existingReferrerChain
  if (!existingReferrerChain) return newUrl

  const chain = parseReferrerChain(existingReferrerChain)

  // Don't append if it's already the last item in the chain (prevents duplicates)
  if (chain.length > 0 && chain[chain.length - 1] === newUrl) {
    return existingReferrerChain
  }

  chain.push(newUrl)
  return chain.join(',')
}

/**
 * Append `?_modal_breakout=1` (or `&_modal_breakout=1`) to a URL so that the
 * modal middleware intercepts the redirect and sends a `data-modal-navigate`
 * response instead, causing the modal to close and the browser to navigate
 * fully to the destination with any flash messages intact.
 *
 * Use this on every terminal redirect from a route that may be reached from
 * inside a modal — saves, deletes, and completed flows.
 *
 * @param {string} url - The destination URL
 * @returns {string} The URL with `_modal_breakout=1` appended
 */
const modalBreakout = (url) => {
  const separator = url.includes('?') ? '&' : '?'
  return `${url}${separator}_modal_breakout=1`
}

module.exports = {
  getReturnUrl,
  urlWithReferrer,
  appendReferrer,
  modalBreakout
}
