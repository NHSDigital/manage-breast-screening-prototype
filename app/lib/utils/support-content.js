// app/lib/utils/support-content.js
//
// Builds the support section from markdown files on disk, so content can be
// added by dropping a file into a folder - no route or template changes.
//
//   app/content/support/1-getting-started/2-signing-in.md
//     -> /support/getting-started/signing-in
//
// Numeric prefixes set the order of both folders and files and are stripped
// from the slug, so articles can be reordered without breaking URLs.
//
// The index is rebuilt on every read outside production: the kit's nodemon
// only watches js/json, so a new markdown file would otherwise need a restart.

const fs = require('fs')
const path = require('path')
const matter = require('gray-matter')
const { markdownHeadings } = require('../../filters/markdown')
const { sentenceCase, formatWords } = require('./strings')

const contentRoot = path.join(__dirname, '../../content/support')

// Leading digits used only for ordering, eg "2-signing-in" -> "signing-in"
const orderPrefix = /^(\d+)[-_.]+/

/**
 * Split a file or folder name into its sort order and slug
 *
 * @param {string} name - File or folder name, without extension
 * @returns {{order: number, slug: string}} Order (Infinity if unprefixed) and slug
 */
const parseName = (name) => {
  const match = name.match(orderPrefix)
  return {
    order: match ? Number(match[1]) : Infinity,
    slug: name.replace(orderPrefix, '')
  }
}

/**
 * Human-readable title derived from a slug, used when none is given
 *
 * @param {string} slug - Kebab-case slug
 * @returns {string} Title, eg "getting-started" -> "Getting started"
 */
const titleFromSlug = (slug) => sentenceCase(formatWords(slug, '-'))

const byOrderThenTitle = (a, b) =>
  a.order - b.order || a.title.localeCompare(b.title)

/**
 * Read one markdown article
 *
 * @param {string} sectionSlug - Slug of the section the article belongs to
 * @param {string} sectionPath - Absolute path to the section folder
 * @param {string} fileName - Markdown file name
 * @returns {object} Article with slug, metadata, href and markdown body
 */
const readArticle = (sectionSlug, sectionPath, fileName) => {
  const { order, slug } = parseName(path.basename(fileName, '.md'))
  const file = matter(fs.readFileSync(path.join(sectionPath, fileName), 'utf8'))
  const data = file.data || {}

  // The table of contents lists the page's h2s. A single entry is no use as a
  // contents list, so it is left empty - as it is when the page turns the
  // contents off with `contents: false`.
  const headings =
    data.contents === false
      ? []
      : markdownHeadings(file.content, 2).map((heading) => ({
          ...heading,
          href: `#${heading.id}`
        }))

  return {
    slug,
    order,
    sectionSlug,
    section: titleFromSlug(sectionSlug),
    title: data.title || titleFromSlug(slug),
    subtitle: data.subtitle || null,
    // Dates come back as Date objects when unquoted in the frontmatter
    published: data.published ? String(data.published) : null,
    updated: data.updated ? String(data.updated) : null,
    href: `/support/${sectionSlug}/${slug}`,
    contents: headings.length > 1 ? headings : [],
    body: file.content
  }
}

/**
 * Read every section and its articles from disk
 *
 * @returns {Array} Sections in order, each with an ordered articles array
 */
const readSections = () => {
  if (!fs.existsSync(contentRoot)) return []

  return fs
    .readdirSync(contentRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const { order, slug } = parseName(entry.name)
      const sectionPath = path.join(contentRoot, entry.name)

      const articles = fs
        .readdirSync(sectionPath)
        .filter((fileName) => fileName.endsWith('.md'))
        .map((fileName) => readArticle(slug, sectionPath, fileName))
        .sort(byOrderThenTitle)

      return { slug, order, title: titleFromSlug(slug), articles }
    })
    .filter((section) => section.articles.length > 0)
    .sort(byOrderThenTitle)
}

// Reading a couple of dozen small files is cheap, but there is no reason to do
// it on every request once the content can no longer change under us
let cachedSections = null

/**
 * The support content tree - sections, each with their ordered articles
 *
 * @returns {Array} Sections in display order
 */
const getSupportSections = () => {
  if (process.env.NODE_ENV === 'production') {
    cachedSections = cachedSections || readSections()
    return cachedSections
  }
  return readSections()
}

/**
 * Find a single section by its slug
 *
 * @param {string} sectionSlug - Section slug from the URL
 * @returns {object|null} Section, or null if there is no such section
 */
const getSupportSection = (sectionSlug) =>
  getSupportSections().find((section) => section.slug === sectionSlug) || null

/**
 * Find a single article by its section and article slugs
 *
 * @param {string} sectionSlug - Section slug from the URL
 * @param {string} articleSlug - Article slug from the URL
 * @returns {object|null} Article, or null if there is no such page
 */
const getSupportArticle = (sectionSlug, articleSlug) => {
  const section = getSupportSection(sectionSlug)
  if (!section) return null

  return (
    section.articles.find((article) => article.slug === articleSlug) || null
  )
}

module.exports = {
  getSupportSections,
  getSupportArticle
}
