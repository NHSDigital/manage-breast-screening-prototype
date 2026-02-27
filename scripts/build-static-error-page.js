// scripts/build-static-error-page.js
//
// Build a standalone static error page with inline CSS.
//
// Usage:
//   npm run build:static-error-page
//   npm run build:static-error-page -- --source-url=http://localhost:3000/example-pages/static-template
//   npm run build:static-error-page -- --output=app/views/example-pages/static.html
//
// Options:
//   --source-url  Fully rendered source page URL to extract content and CSS links from.
//   --output      Output HTML file path (relative to repo root or absolute path).
//   --help        Show usage information.

const fs = require('node:fs/promises')
const path = require('node:path')
const { PurgeCSS } = require('purgecss')
const postcss = require('postcss')
const cssnano = require('cssnano')
const prettier = require('prettier')

const rootDir = path.resolve(__dirname, '..')
const defaultOutputPath = path.join(
  rootDir,
  'app/views/example-pages/static.html'
)
const defaultSourceUrl =
  process.env.STATIC_ERROR_SOURCE_URL ||
  'http://localhost:3000/example-pages/static-template'

const parseCliArgs = () => {
  const args = process.argv.slice(2)
  const options = {
    sourceUrl: defaultSourceUrl,
    outputPath: defaultOutputPath,
    help: false
  }

  args.forEach((arg) => {
    if (arg === '--help' || arg === '-h') {
      options.help = true
      return
    }

    if (arg.startsWith('--source-url=')) {
      options.sourceUrl = arg.split('=')[1]
      return
    }

    if (arg.startsWith('--output=')) {
      const outputValue = arg.split('=')[1]
      options.outputPath = path.isAbsolute(outputValue)
        ? outputValue
        : path.join(rootDir, outputValue)
    }
  })

  return options
}

const printUsage = () => {
  console.log('Build static error page with inline CSS')
  console.log('')
  console.log('Options:')
  console.log('  --source-url=<url>   Rendered source page URL')
  console.log('  --output=<path>      Output HTML file path')
  console.log('  --help               Show this help')
}

const safelist = {
  standard: [
    'nhsuk-skip-link',
    'nhsuk-header',
    'nhsuk-header__container',
    'nhsuk-header__service',
    'nhsuk-header__service-logo',
    'nhsuk-header__service-name',
    'nhsuk-header__logo',
    'nhsuk-footer',
    'nhsuk-footer__meta',
    'nhsuk-width-container',
    'nhsuk-main-wrapper',
    'nhsuk-grid-row',
    'nhsuk-grid-column-two-thirds',
    'nhsuk-grid-column-full',
    'nhsuk-heading-l',
    'nhsuk-inset-text',
    'nhsuk-list'
  ],
  deep: [
    /^nhsuk-heading-[x]?(s|m|l|xl)$/,
    /^nhsuk-body-[sml]$/,
    /^nhsuk-list/,
    /^nhsuk-link/,
    /^nhsuk-inset-text/,
    /^nhsuk-grid-column-(one-(quarter|third|half)|two-thirds|three-quarters|full)$/,
    /^nhsuk-footer__/
  ]
}

const blocklist = [/^app-/, /\.app-dark-mode/, /^js-/, /:has\(/]

const cssRuleRemovalPatterns = [
  /:root\s*{[^{}]*}/g,
  /[^{}]*:has\([^{}]*\)\s*{[^{}]*}/g,
  /[^{}]*app-dark-mode[^{}]*\s*{[^{}]*}/g,
  /[^{}]*--reverse[^{}]*\s*{[^{}]*}/g,
  /[^{}]*\.nhsuk-list--(?:cross|tick)[^{}]*\s*{[^{}]*}/g
]

const fetchRenderedSourceHtml = async (sourceUrl) => {
  const response = await fetch(sourceUrl)

  if (!response.ok) {
    throw new Error(
      `Could not load source page ${sourceUrl} (status ${response.status})`
    )
  }

  return response.text()
}

const fetchText = async (url) => {
  const response = await fetch(url)

  if (!response.ok) {
    throw new Error(`Could not load ${url} (status ${response.status})`)
  }

  return response.text()
}

const getStylesheetUrls = (renderedHtml, sourceUrl) => {
  const linkTags = [...renderedHtml.matchAll(/<link\b[^>]*>/gi)].map(
    (match) => match[0]
  )

  return linkTags
    .map((tag) => {
      const relMatch = tag.match(/\brel=["']([^"']+)["']/i)
      const hrefMatch = tag.match(/\bhref=["']([^"']+)["']/i)

      if (!relMatch || !hrefMatch) {
        return null
      }

      if (!relMatch[1].toLowerCase().includes('stylesheet')) {
        return null
      }

      return new URL(hrefMatch[1], sourceUrl).toString()
    })
    .filter(Boolean)
    .filter((url) => url.endsWith('.css'))
}

const extractBlock = (html, pattern, name) => {
  const match = html.match(pattern)

  if (!match) {
    throw new Error(`Could not find ${name} in rendered source HTML`)
  }

  return match[0]
}

const buildStaticHtmlFromRenderedPage = (renderedHtml) => {
  const titleMatch = renderedHtml.match(/<title>[\s\S]*?<\/title>/i)

  if (!titleMatch) {
    throw new Error('Could not find page title in rendered source HTML')
  }

  const skipLink = extractBlock(
    renderedHtml,
    /<a class="nhsuk-skip-link"[\s\S]*?<\/a>/i,
    'skip link'
  )
  const header = extractBlock(
    renderedHtml,
    /<header class="nhsuk-header"[\s\S]*?<\/header>/i,
    'header'
  )
  const mainContainer = extractBlock(
    renderedHtml,
    /<div class="nhsuk-width-container">[\s\S]*?<\/main>[\s\S]*?<\/div>/i,
    'main content container'
  )
  const footer = extractBlock(
    renderedHtml,
    /<footer class="nhsuk-footer"[\s\S]*?<\/footer>/i,
    'footer'
  )

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  ${titleMatch[0]}
  <style>
/* INLINE_STYLES */
  </style>
</head>
<body>
  ${skipLink}

  ${header}

  ${mainContainer}

  ${footer}
</body>
</html>
`
}

const stripMediaPrintBlocks = (css) => {
  let output = css
  let mediaPrintIndex = output.indexOf('@media print')

  while (mediaPrintIndex !== -1) {
    const blockStart = output.indexOf('{', mediaPrintIndex)

    if (blockStart === -1) {
      break
    }

    let depth = 1
    let position = blockStart + 1

    while (position < output.length && depth > 0) {
      const character = output[position]

      if (character === '{') {
        depth += 1
      } else if (character === '}') {
        depth -= 1
      }

      position += 1
    }

    output = `${output.slice(0, mediaPrintIndex)}${output.slice(position)}`
    mediaPrintIndex = output.indexOf('@media print')
  }

  return output
}

const optimiseCss = async (css) => {
  const result = await postcss([
    cssnano({ preset: ['default', { env: 'stylesheets' }] })
  ]).process(css, { from: undefined })

  return result.css
}

const removeMatchingRuleBlocks = (css, patterns) => {
  return patterns.reduce((output, pattern) => output.replace(pattern, ''), css)
}

const getPurgedCss = async (htmlContent, stylesheetUrls) => {
  const purgeCss = new PurgeCSS()

  const cssSources = await Promise.all(
    stylesheetUrls.map(async (url) => {
      const raw = await fetchText(url)
      return { raw }
    })
  )

  if (cssSources.length === 0) {
    throw new Error('No stylesheet links were found in rendered source HTML')
  }

  const purgeResults = await purgeCss.purge({
    content: [
      {
        raw: htmlContent,
        extension: 'html'
      }
    ],
    css: cssSources,
    safelist,
    blocklist
  })

  let css = purgeResults
    .map((result) => result.css.trim())
    .filter(Boolean)
    .join('\n\n')
    .replace(/@charset\s+"UTF-8";?/gi, '')

  css = removeMatchingRuleBlocks(css, cssRuleRemovalPatterns)

  css = stripMediaPrintBlocks(css)

  return optimiseCss(css)
}

const injectInlineStyles = (html, css) => {
  return html.replace('/* INLINE_STYLES */', css)
}

const formatHtml = async (html) => {
  return prettier.format(html, {
    parser: 'html',
    printWidth: 100,
    tabWidth: 2,
    useTabs: false,
    htmlWhitespaceSensitivity: 'ignore'
  })
}

const normaliseAnchorTextWhitespace = (html) => {
  return html.replace(
    /(<a\b[^>]*>)([\s\S]*?)(<\/a>)/gi,
    (match, openTag, content, closeTag) => {
      if (content.includes('<')) {
        return match
      }

      const normalisedContent = content.replace(/\s+/g, ' ').trim()
      return `${openTag}${normalisedContent}${closeTag}`
    }
  )
}

const run = async () => {
  const cliOptions = parseCliArgs()

  if (cliOptions.help) {
    printUsage()
    return
  }

  const renderedHtml = await fetchRenderedSourceHtml(cliOptions.sourceUrl)
  const stylesheetUrls = getStylesheetUrls(renderedHtml, cliOptions.sourceUrl)
  const html = buildStaticHtmlFromRenderedPage(renderedHtml)
  const css = await getPurgedCss(html, stylesheetUrls)

  if (!css) {
    throw new Error('No CSS was produced by PurgeCSS')
  }

  const updatedHtml = injectInlineStyles(html, css)
  const formattedHtml = await formatHtml(updatedHtml)
  const normalisedHtml = normaliseAnchorTextWhitespace(formattedHtml)
  await fs.writeFile(cliOptions.outputPath, normalisedHtml, 'utf8')

  console.log(
    `Updated static error page styles in ${path.relative(rootDir, cliOptions.outputPath)}`
  )
}

run().catch((error) => {
  console.error(error)
  process.exit(1)
})
