// scripts/generate-utils-reference.js
//
// Generates docs/utils-filter-reference.md from JSDoc comments.
// Run with: npm run docs

const fs = require('fs')
const path = require('path')

const ROOT = path.join(__dirname, '..')
const OUTPUT_PATH = path.join(ROOT, 'docs', 'utils-filter-reference.md')

// ─── File metadata ───────────────────────────────────────────────────────────

const FILE_META = {
  // Utils
  'app/lib/utils/dates.js': {
    label: 'dates.js',
    description: 'Date formatting and calculation using dayjs. Use these for all date work — formatting, comparison, relative display, and arithmetic. Accepts ISO strings, `[day, month, year]` arrays, and `{day, month, year}` objects throughout.'
  },
  'app/lib/utils/strings.js': {
    label: 'strings.js',
    description: 'String manipulation: case conversion, formatting, NHS-specific formats (NHS number, phone), pluralisation, and HTML-wrapping helpers for use in templates.'
  },
  'app/lib/utils/status.js': {
    label: 'status.js',
    description: 'Event status checks and display helpers. Use these instead of comparing status strings directly — status values may change but these functions will be updated accordingly.'
  },
  'app/lib/utils/participants.js': {
    label: 'participants.js',
    description: 'Participant lookups and derived data: full/short names, age, clinic history, and risk level.'
  },
  'app/lib/utils/event-data.js': {
    label: 'event-data.js',
    description: 'Event lookups and mutations in session data. Includes the temp event pattern (`data.event` → `data.events[]`).'
  },
  'app/lib/utils/clinics.js': {
    label: 'clinics.js',
    description: 'Clinic filtering by time period, slot formatting, and opening hours calculation.'
  },
  'app/lib/utils/reading.js': {
    label: 'reading.js',
    description: 'Image reading workflow: read state, progress tracking, batch management, per-user navigation, and filtering. The main module for anything related to image reading.'
  },
  'app/lib/utils/prior-mammograms.js': {
    label: 'prior-mammograms.js',
    description: 'Prior mammogram request state (awaiting, unrequested, resolved) and one-line summary helpers.'
  },
  'app/lib/utils/medical-information.js': {
    label: 'medical-information.js',
    description: 'Summarise medical history items, symptoms, breast features, and other clinical information into concise display strings.'
  },
  'app/lib/utils/annotation-summary.js': {
    label: 'annotation-summary.js',
    description: 'Summarise image reading annotations (abnormality type, level of concern, location) into concise display strings.'
  },
  'app/lib/utils/arrays.js': {
    label: 'arrays.js',
    description: 'Array helpers: find by key/id, filter, push (immutable), remove empty. Supports lodash dot notation for nested property access.'
  },
  'app/lib/utils/objects.js': {
    label: 'objects.js',
    description: 'Object utilities for extracting and flattening values.'
  },
  'app/lib/utils/summary-list.js': {
    label: 'summary-list.js',
    description: 'NHS summary list helpers: replace empty row values with "Enter X" links or "Not provided" text, and remove the bottom border from the last row.'
  },
  'app/lib/utils/random.js': {
    label: 'random.js',
    description: 'Seeded random functions for stable prototype data. Results are stable per page URL — use the `name` param to get different values for different purposes on the same page.'
  },
  'app/lib/utils/referrers.js': {
    label: 'referrers.js',
    description: 'Referrer chain navigation for multi-level back links. Use these instead of hardcoded back link URLs. See the module-level comment in the file for full usage examples.'
  },
  'app/lib/utils/roles-and-permissions.js': {
    label: 'roles-and-permissions.js',
    description: 'User role checks. Use these instead of comparing role strings directly.'
  },
  'app/lib/utils/utility.js': {
    label: 'utility.js',
    description: 'General-purpose type coercion (`falsify`) and limiting utilities.'
  },
  // Filters
  'app/filters/formatting.js': {
    label: 'formatting.js',
    description: 'Display formatting for yes/no answers and ordinal names.'
  },
  'app/filters/forms.js': {
    label: 'forms.js',
    description: 'Injects matching flash error messages into NHS form component configs by field name.'
  },
  'app/filters/nunjucks.js': {
    label: 'nunjucks.js',
    description: 'Nunjucks-specific helpers: joining arrays, resolving user names from IDs, template debugging, and template literal support.'
  },
  'app/filters/tags.js': {
    label: 'tags.js',
    description: 'Convert status strings to NHS `<strong class="nhsuk-tag">` HTML elements.'
  },
  'app/filters/markdown.js': {
    label: 'markdown.js',
    description: 'Convert markdown strings to Nunjucks-safe HTML using markdown-it. Output does not need `| safe`.'
  }
}

const UTILS_FILES = [
  'app/lib/utils/dates.js',
  'app/lib/utils/strings.js',
  'app/lib/utils/status.js',
  'app/lib/utils/participants.js',
  'app/lib/utils/event-data.js',
  'app/lib/utils/clinics.js',
  'app/lib/utils/reading.js',
  'app/lib/utils/prior-mammograms.js',
  'app/lib/utils/medical-information.js',
  'app/lib/utils/annotation-summary.js',
  'app/lib/utils/arrays.js',
  'app/lib/utils/objects.js',
  'app/lib/utils/summary-list.js',
  'app/lib/utils/random.js',
  'app/lib/utils/referrers.js',
  'app/lib/utils/roles-and-permissions.js',
  'app/lib/utils/utility.js'
]

const FILTER_FILES = [
  'app/filters/formatting.js',
  'app/filters/forms.js',
  'app/filters/nunjucks.js',
  'app/filters/tags.js',
  'app/filters/markdown.js'
]

// ─── Parsers ─────────────────────────────────────────────────────────────────

// Returns array of exported name strings, or null if module.exports not found
function getExports(source) {
  const match = source.match(/module\.exports\s*=\s*\{([\s\S]*?)\}/)
  if (match) {
    return (match[1].match(/\b([a-zA-Z_$][\w$]*)\b/g) || [])
      .filter(name => !['true', 'false', 'null', 'undefined'].includes(name))
  }
  // module.exports = singleName
  const direct = source.match(/module\.exports\s*=\s*([a-zA-Z_$][\w$]*)/)
  if (direct) return [direct[1]]
  return null
}

// Returns array of { name, shortDesc, params, returns, exampleLines }
function extractDocumentedFunctions(source) {
  const results = []

  // Match JSDoc block + function declaration that follows (with optional blank lines).
  // (?!\*) prevents matching /***...*** section separators.
  // (?:[^*]|\*(?!\/))* prevents spanning across */ boundaries (fixes param doubling for adjacent JSDoc blocks).
  // Also captures the full declaration line so we can extract params from signature as a fallback.
  const pattern = /\/\*\*(?!\*)((?:[^*]|\*(?!\/))*)\*\/\s*\n(?:[ \t]*\n)*[ \t]*((?:const|let|var|async function|function)\s+(\w+)[^\n]*)/g

  let match
  while ((match = pattern.exec(source)) !== null) {
    const rawBlock = match[1]
    const declarationLine = match[2]
    const name = match[3]

    // Skip non-function constants (e.g. STATUS_GROUPS = { ... })
    if (/=\s*\{/.test(declarationLine) && !/=>|function/.test(declarationLine)) continue

    // Clean each line: remove leading " * " or " *"
    const clean = rawBlock
      .split('\n')
      .map(line => line.replace(/^\s*\*\s?/, ''))
      .join('\n')
      .trim()

    // Split description from tags
    const tagStart = clean.search(/\n\s*@/)
    const descPart = tagStart !== -1 ? clean.slice(0, tagStart) : clean
    const tagPart = tagStart !== -1 ? clean.slice(tagStart) : ''

    // Short description: first non-empty line of description block
    const shortDesc = descPart.split('\n').map(l => l.trim()).find(Boolean) || ''

    // Parse @param tags
    const params = []
    const paramRegex = /@param\s+\{([^}]+)\}\s+(\[?[\w.[\]]+\]?)\s*(?:-\s*)?(.*)/g
    let paramMatch
    while ((paramMatch = paramRegex.exec(tagPart)) !== null) {
      const isOptional = paramMatch[2].startsWith('[')
      params.push({
        type: paramMatch[1],
        name: paramMatch[2].replace(/[\[\]]/g, ''),
        optional: isOptional
      })
    }

    // Fallback: if no @param tags, extract param names from the function signature
    if (params.length === 0) {
      const sigMatch = declarationLine.match(/=\s*(?:async\s+)?\(([^)]*)\)|(?:async\s+)?function\s+\w+\s*\(([^)]*)/)
      if (sigMatch) {
        const paramStr = (sigMatch[1] || sigMatch[2] || '').trim()
        if (paramStr) {
          paramStr.split(',').forEach(p => {
            const pName = p.trim().replace(/\s*=.*$/, '').replace(/^\.\.\./, '').trim()
            if (pName) params.push({ type: null, name: pName, optional: p.includes('=') })
          })
        }
      }
    }

    // Parse @returns
    const returnsMatch = tagPart.match(/@returns?\s+\{([^}]+)\}/)
    const returns = returnsMatch ? returnsMatch[1] : null

    // Parse first @example line (just the first, for the table)
    const exampleMatch = tagPart.match(/@example\s*\n([\s\S]*?)(?=\n\s*@|$)/)
    const exampleLines = exampleMatch
      ? exampleMatch[1].split('\n').map(l => l.trim()).filter(Boolean)
      : []

    // Line number of the JSDoc start (1-based)
    const lineNumber = source.slice(0, match.index).split('\n').length

    results.push({ name, shortDesc, params, returns, exampleLines, lineNumber })
  }

  return results
}

// ─── Markdown generation ─────────────────────────────────────────────────────

function buildSignature(name, params) {
  const paramStr = params.map(p => p.optional ? `[${p.name}]` : p.name).join(', ')
  return `${name}(${paramStr})`
}

// GitHub markdown anchor from a heading string
function toAnchor(label) {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
}

function generateFileSection(filePath) {
  const meta = FILE_META[filePath]
  const source = fs.readFileSync(path.join(ROOT, filePath), 'utf8')

  const exportedNames = getExports(source)
  const allFunctions = extractDocumentedFunctions(source)

  // Only include exported functions
  const functions = exportedNames
    ? allFunctions.filter(f => exportedNames.includes(f.name))
    : allFunctions

  if (functions.length === 0) {
    console.warn(`  Warning: no documented exported functions found in ${filePath}`)
    return ''
  }

  let md = `### ${meta.label}\n\n`
  md += `\`${filePath}\`\n\n`
  md += `${meta.description}\n\n`
  md += `| Function | Description | Line |\n`
  md += `|---|---|---|\n`

  for (const fn of functions) {
    const sig = buildSignature(fn.name, fn.params)
    let desc = fn.shortDesc
    if (fn.exampleLines.length > 0) {
      // Append first example inline
      desc += ` — e.g. \`${fn.exampleLines[0]}\``
    }
    // Escape pipe chars so they don't break the table
    desc = desc.replace(/\|/g, '\\|')
    const sigCell = `\`${sig}\``
    md += `| ${sigCell} | ${desc} | ${fn.lineNumber} |\n`
  }

  return md + '\n'
}

// ─── Main ─────────────────────────────────────────────────────────────────────

function generate() {
  const now = new Date().toISOString().slice(0, 16).replace('T', ' ') + ' UTC'

  // ─── Header block (before ToC) ────────────────────────────────────────────
  let header = `# Utils and filters reference\n\n`
  header += `---\n`
  header += `**Auto-generated** — do not edit manually.\n\n`
  header += `- **Generated:** ${now}\n`
  header += `- **Source:** \`app/lib/utils/\` and \`app/filters/\`\n`
  header += `- **Regenerate:** \`npm run docs\`\n\n`
  header += `*All functions in \`app/lib/utils/\` are automatically available as Nunjucks filters and global functions in templates, and can be imported in route files. Filters in \`app/filters/\` are Nunjucks-only.*\n\n`
  header += `---\n\n`

  const utilsIntro = `## Utility functions\n\nAvailable as Nunjucks filters/globals in templates and importable in route files.\n\n`
  const filtersIntro = `## Filters\n\nNunjucks filters only — not automatically available in route files.\n\n`

  // ─── Generate all sections ────────────────────────────────────────────────
  const utilsSections = UTILS_FILES.map(file => {
    process.stdout.write(`  ${FILE_META[file].label}... `)
    const section = { meta: FILE_META[file], content: generateFileSection(file) }
    console.log('done')
    return section
  })

  const filtersSections = FILTER_FILES.map(file => {
    process.stdout.write(`  ${FILE_META[file].label}... `)
    const section = { meta: FILE_META[file], content: generateFileSection(file) }
    console.log('done')
    return section
  })

  // ─── Calculate section line numbers ───────────────────────────────────────
  const countNewlines = str => (str.match(/\n/g) || []).length

  // Pre-compute ToC line count so we can assign section line numbers before building it.
  // ToC structure: heading+blank (2) + header row (1) + divider (1) + utils rows + separator (1) + filter rows + blank+---+blank (3)
  const tocLineCount = 2 + 1 + 1 + UTILS_FILES.length + 1 + FILTER_FILES.length + 3

  let cursor = 1 + countNewlines(header) + tocLineCount + countNewlines(utilsIntro)
  for (const section of utilsSections) {
    section.lineNumber = cursor
    cursor += countNewlines(section.content)
  }
  cursor += countNewlines(filtersIntro)
  for (const section of filtersSections) {
    section.lineNumber = cursor
    cursor += countNewlines(section.content)
  }

  // ─── Build ToC with line numbers ──────────────────────────────────────────
  let toc = `## Table of contents\n\n`
  toc += `| File | Purpose | Line |\n`
  toc += `|---|---|---|\n`
  for (const section of utilsSections) {
    const summary = section.meta.description.split('. ')[0]
    toc += `| \`${section.meta.label}\` | ${summary} | ${section.lineNumber} |\n`
  }
  toc += `| | | |\n`
  for (const section of filtersSections) {
    const summary = section.meta.description.split('. ')[0]
    toc += `| \`${section.meta.label}\` | ${summary} (filter only) | ${section.lineNumber} |\n`
  }
  toc += `\n---\n\n`

  // Sanity check: actual ToC line count must match our pre-computed value
  const actualTocLineCount = countNewlines(toc)
  if (actualTocLineCount !== tocLineCount) {
    console.warn(`Warning: ToC line count mismatch (expected ${tocLineCount}, got ${actualTocLineCount}). Line numbers may be off by ${actualTocLineCount - tocLineCount}.`)
  }

  // ─── Assemble ─────────────────────────────────────────────────────────────
  let output = header + toc + utilsIntro
  for (const section of utilsSections) output += section.content
  output += filtersIntro
  for (const section of filtersSections) output += section.content

  fs.writeFileSync(OUTPUT_PATH, output)
  console.log(`\nWrote ${OUTPUT_PATH}`)
}

generate()
