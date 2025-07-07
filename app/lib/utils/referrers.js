// app/lib/utils/referrers.js

/**
 * Handle chained referrer URLs for back navigation
 * Allows deep linking while maintaining proper back navigation chains
 */

/**
 * Parse referrer string into array of URLs
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
 * @param {string} url - Default URL to use if no referrer
 * @param {string} referrerChain - Referrer chain
 * @returns {string} URL to use for back link
 * @example
 * // In templates:
 * <a href="{{ '/default-path' | getReturnUrl(referrerChain) }}">Back</a>
 */
const getReturnUrl = function(url, referrerChain) {
  // Get currentUrl from context if available
  const currentUrl = this?.ctx?.currentUrl

  const chain = parseReferrerChain(referrerChain)
    .filter(ref => ref !== currentUrl)

  if (!chain.length) return url

  // For single referrer, return it directly
  if (chain.length === 1) return chain[0]

  // For multiple referrers, return last one with remaining chain as query param
  const remainingChain = chain.slice(0, -1)
  const destination = chain[chain.length - 1]

  return `${destination}?referrerChain=${remainingChain.join(',')}`
}

/**
 * Add referrer to URL as query parameter
 * @param {string} url - Base URL
 * @param {string} referrerChain - Referrer to append
 * @returns {string} URL with referrer query param
 * @example
 * // In templates:
 * <a href="{{ '/next-page' | urlWithReferrer(referrer) }}">Continue</a>
 */
const urlWithReferrer = (url, referrerChain) => {
  if (!referrerChain) return url

  // Check if URL already has query parameters
  const separator = url.includes('?') ? '&' : '?'
  return `${url}${separator}referrerChain=${referrerChain}`
}

/**
 * Append a URL to an existing referrer chain
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
  chain.push(newUrl)
  return chain.join(',')
}

module.exports = {
  getReturnUrl,
  urlWithReferrer,
  appendReferrer,
}
