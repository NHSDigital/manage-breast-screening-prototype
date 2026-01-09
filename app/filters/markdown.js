// app/filters/markdown.js

const { safe: nunjucksSafe } = require('nunjucks/src/filters')
const MarkdownIt = require('markdown-it')

const md = new MarkdownIt({
  html: true, // Enable HTML tags in source
  linkify: true, // Auto-convert URL-like text to links
  typographer: true // Enable smart quotes and other typographic replacements
})

/**
 * Convert markdown to HTML
 * Output is automatically marked as safe, no need for | safe filter
 *
 * @param {string} content - The markdown content to convert
 * @returns {string} HTML output (safe for rendering)
 * @example
 * {{ "## Heading" | markdown }}
 * {{ content | markdown }}
 */
const markdown = (content) => {
  if (!content) {
    return ''
  }
  return nunjucksSafe(md.render(content))
}

module.exports = { markdown }
