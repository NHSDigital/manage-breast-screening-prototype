// app/lib/utils/referrers.js

/**
 * Referrer Chain Navigation System
 *
 * This module handles multi-level back navigation by maintaining a chain of URLs
 * that grows as users navigate deeper and shrinks as they navigate back.
 *
 * ## Mental Model
 *
 * Think of the referrer chain as a breadcrumb trail:
 * - As you navigate TO deeper pages, add current URL to the chain
 * - As you navigate BACK, pop the last URL from the chain
 * - The chain is stored as a query parameter: ?referrerChain=/page1,/page2,/page3
 * - In templates, `referrerChain` refers to the template variable (populated from query.referrerChain)
 *
 * ## The Three Navigation Patterns
 *
 * ### 1. Navigating TO a page (extending the chain)
 * Use when: Going deeper into a flow, user should be able to return to current page
 *
 * ```nunjucks
 * {# Extending an existing chain (most common in multi-level flows) #}
 * <a href="{{ '/next-page' | urlWithReferrer(referrerChain | appendReferrer(currentUrl)) }}">
 *
 * {# Starting a new chain (no existing referrer) #}
 * <a href="{{ '/next-page' | urlWithReferrer(currentUrl) }}">
 * ```
 *
 * ### 2. Navigating BACK (consuming the chain)
 * Use when: On a "Continue" or "Save and return" button
 *
 * ```nunjucks
 * {# Extracts destination from chain, includes remaining chain #}
 * {{ button({
 *   text: "Continue",
 *   href: '../fallback' | getReturnUrl(referrerChain)
 * }) }}
 * ```
 *
 * ### 3. Building chains manually (advanced)
 * Use when: Pre-building chains for complex flows (e.g., "add" buttons that bypass review page)
 *
 * ```nunjucks
 * {# Build chain for add journey that returns through review page #}
 * {% set addReferrerChain = currentUrl | appendReferrer('/review') %}
 * <a href="{{ '/add' | urlWithReferrer(addReferrerChain) }}">Add item</a>
 * ```
 *
 * ## Real-World Example: Check Information Flow
 *
 * Starting point: User is on `/clinics/123/events/456/check-information`
 *
 * 1. **check-information** → **confirm-information/medical-history**
 *    ```nunjucks
 *    {# Start new chain with current page #}
 *    <a href="{{ './confirm-information/medical-history' | urlWithReferrer(currentUrl) }}">
 *    {# Result: ?referrerChain=/clinics/123/events/456/check-information #}
 *    ```
 *
 * 2. **confirm-information/medical-history** → **edit form**
 *    ```nunjucks
 *    {# Extend chain by appending current page to existing chain #}
 *    <a href="{{ './edit/123' | urlWithReferrer(referrerChain | appendReferrer(currentUrl)) }}">
 *    {# Result: ?referrerChain=/check-information,/confirm-information/medical-history #}
 *    ```
 *
 * 3. **edit form** → **back to confirm-information/medical-history**
 *    ```nunjucks
 *    {# Navigate back: pops last URL from chain and goes there #}
 *    {{ button({ href: '../fallback' | getReturnUrl(referrerChain) }) }}
 *    {# Goes to: /confirm-information/medical-history?referrerChain=/check-information #}
 *    ```
 *
 * 4. **confirm-information/medical-history** → **back to check-information**
 *    ```nunjucks
 *    {# Navigate back again: pops last remaining URL #}
 *    {{ button({ href: '../fallback' | getReturnUrl(referrerChain) }) }}
 *    {# Goes to: /check-information (no chain param, it's exhausted) #}
 *    ```
 *
 * ## Common Mistakes to Avoid
 *
 * ❌ **Using urlWithReferrer for back links**
 * ```nunjucks
 * {# WRONG: Adds referrer instead of consuming it #}
 * <a href="{{ '../previous' | urlWithReferrer(referrerChain) }}">Back</a>
 * ```
 * ✅ **Use getReturnUrl for back links**
 * ```nunjucks
 * {# CORRECT: Extracts destination from referrer chain #}
 * <a href="{{ '../previous' | getReturnUrl(referrerChain) }}">Back</a>
 * ```
 *
 * ❌ **Forgetting to extend the chain**
 * ```nunjucks
 * {# WRONG: Replaces chain instead of extending it #}
 * <a href="{{ '/next' | urlWithReferrer(currentUrl) }}">Continue</a>
 * ```
 * ✅ **Extend the chain when going deeper**
 * ```nunjucks
 * {# CORRECT: Extends existing chain with current URL #}
 * <a href="{{ '/next' | urlWithReferrer(referrerChain | appendReferrer(currentUrl)) }}">
 * ```
 *
 * ❌ **Not providing fallback for getReturnUrl**
 * ```nunjucks
 * {# WRONG: Returns empty string if no referrer #}
 * <a href="{{ '' | getReturnUrl(referrerChain) }}">Back</a>
 * ```
 * ✅ **Always provide a sensible fallback**
 * ```nunjucks
 * {# CORRECT: Falls back to sensible default #}
 * <a href="{{ '../parent-page' | getReturnUrl(referrerChain) }}">Back</a>
 * ```
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
 * // In templates:
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
 * // In templates:
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
 * // In templates:
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

module.exports = {
  getReturnUrl,
  urlWithReferrer,
  appendReferrer
}
