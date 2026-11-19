// app/filters/markdown.js

const { safe: nunjucksSafe } = require('nunjucks/src/filters')
const MarkdownIt = require('markdown-it')

const md = new MarkdownIt({
  html: true, // Enable HTML tags in source
  linkify: true, // Auto-convert URL-like text to links
  typographer: true // Enable smart quotes and other typographic replacements
})

// Give headings ids derived from their text, so anything on the page can link
// to a section - a table of contents, or a link shared with a colleague
const slugifyHeading = (text) =>
  text
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')

md.renderer.rules.heading_open = (tokens, index, options, env, self) => {
  const token = tokens[index]
  const inline = tokens[index + 1]

  if (inline && inline.type === 'inline' && !token.attrGet('id')) {
    token.attrSet('id', slugifyHeading(inline.content))
  }

  return self.renderToken(tokens, index, options)
}

/**
 * The headings in a markdown document, for building a table of contents
 *
 * Uses the same parser and slugs as the renderer, so the ids always match the
 * ones on the rendered page.
 *
 * @param {string} content - The markdown content to read
 * @param {number} [level] - Heading level to collect, 2 (h2) by default
 * @returns {Array<{text: string, id: string}>} Headings in document order
 * @example
 * {{ content | markdownHeadings }}
 */
const markdownHeadings = (content, level = 2) => {
  if (!content) {
    return []
  }

  const tag = `h${level}`
  const tokens = md.parse(content, {})
  const headings = []

  // The token stream is flat - a heading's text is in the inline token that
  // follows its heading_open
  tokens.forEach((token, index) => {
    if (token.type !== 'heading_open' || token.tag !== tag) return

    const inline = tokens[index + 1]
    if (!inline || inline.type !== 'inline') return

    headings.push({
      text: inline.content,
      id: token.attrGet('id') || slugifyHeading(inline.content)
    })
  })

  return headings
}

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

module.exports = { markdown, markdownHeadings }
