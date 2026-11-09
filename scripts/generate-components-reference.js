// scripts/generate-components-reference.js
//
// Generates docs/components.md from the doc comment in each component's
// macro.njk. Run with: npm run docs
//
// With --check it writes nothing and fails if a component's docs are missing or
// incomplete, a param is undocumented, docs/components.md is out of date, or
// docs/sass-modifiers.md names a class that no longer exists.

const fs = require('fs')
const path = require('path')

const ROOT = path.join(__dirname, '..')
const COMPONENTS_DIR = path.join(ROOT, 'app/views/_components')
const STYLE_GUIDE_DIR = path.join(ROOT, 'app/views/style-guide')
const SASS_DIR = path.join(ROOT, 'app/assets/sass')
const OUTPUT_PATH = path.join(ROOT, 'docs/components.md')
const MODIFIERS_PATH = path.join(ROOT, 'docs/sass-modifiers.md')

// Style guide pages not named after their component
const STYLE_GUIDE_PAGES = { icon: 'icons' }

const COMMENT_PATTERN = /\{#[\s\S]*?#\}/g

const listFilesRecursively = (directory) =>
  fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name)
    return entry.isDirectory() ? listFilesRecursively(entryPath) : [entryPath]
  })

// Reads a "Name: value" field. Each field must stay on one line
const readField = (docComment, fieldName) => {
  const match = docComment.match(
    new RegExp(`^[ \\t]*${fieldName}:[ \\t]*(.*)$`, 'm')
  )
  return match ? match[1].trim() : null
}

const readText = (filePath) =>
  fs.readFileSync(filePath, 'utf8').replace(/\r\n/g, '\n')

const readComponent = (name) => {
  const componentDir = path.join(COMPONENTS_DIR, name)
  const macroSource = readText(path.join(componentDir, 'macro.njk'))
  const docComment = (macroSource.match(COMMENT_PATTERN) || []).find(
    (comment) => /^\s*Purpose:/m.test(comment)
  )

  const macros = [
    ...macroSource
      .replace(COMMENT_PATTERN, '')
      .matchAll(/\{%-?\s*macro\s+(\w+)/g)
  ]
    .map((match) => match[1])
    .filter((macro) => !macro.startsWith('_'))

  const stylePage = STYLE_GUIDE_PAGES[name] || name
  const hasStylePage = fs.existsSync(
    path.join(STYLE_GUIDE_DIR, `${stylePage}.html`)
  )

  // Params each template reads, ignoring anything mentioned in its comments
  const templateSources = fs
    .readdirSync(componentDir)
    .filter((file) => file.endsWith('.njk'))
    .map((file) => readText(path.join(componentDir, file)))
    .map((source) => source.replace(COMMENT_PATTERN, ''))
  const paramsUsed = [
    ...new Set(
      templateSources.flatMap((source) =>
        [...source.matchAll(/\bparams\.(\w+)/g)].map((match) => match[1])
      )
    )
  ]

  return {
    name,
    macros,
    docComment: docComment || '',
    purpose: docComment ? readField(docComment, 'Purpose') : null,
    useWhen: docComment ? readField(docComment, 'Use when') : null,
    nhsEquivalent: docComment ? readField(docComment, 'NHS equivalent') : null,
    stylePage: hasStylePage ? stylePage : null,
    paramsUsed
  }
}

const findComponentProblems = (component) => {
  const problems = []
  const label = `app/views/_components/${component.name}/macro.njk`

  if (!component.purpose) problems.push(`${label}: missing “Purpose:”`)
  if (!component.useWhen) problems.push(`${label}: missing “Use when:”`)
  const paramsStart = component.docComment.search(/^\s*Params\b/m)
  if (paramsStart === -1) problems.push(`${label}: missing a “Params” section`)
  const paramsDocs =
    paramsStart === -1 ? '' : component.docComment.slice(paramsStart)

  for (const param of component.paramsUsed) {
    if (!new RegExp(`\\b${param}\\b`).test(paramsDocs))
      problems.push(`${label}: param “${param}” is used but not documented`)
  }
  return problems
}

const findModifierProblems = () => {
  const sassSource = listFilesRecursively(SASS_DIR)
    .filter((file) => file.endsWith('.scss'))
    .map((file) => readText(file))
    .join('\n')
    .replace(/\/\/.*$/gm, '')
  const documented = readText(MODIFIERS_PATH).matchAll(/`\.?(app-[\w-]+)`/g)

  return [...documented]
    .map((match) => match[1])
    .filter(
      (className) => !new RegExp(`\\.${className}(?![\\w-])`).test(sassSource)
    )
    .map(
      (className) => `docs/sass-modifiers.md: “${className}” is not in the Sass`
    )
}

const tableCell = (text) => (text || '').replace(/\|/g, '\\|')

const buildReference = (components) => {
  const rows = components.map((component) => {
    const folder = `../app/views/_components/${component.name}/macro.njk`
    const macros = component.macros.map((macro) => `\`${macro}\``).join(', ')
    const purpose = `${component.purpose} ${component.useWhen ? `**Use when:** ${component.useWhen}` : ''}`
    const stylePage = component.stylePage
      ? `\`/style-guide/${component.stylePage}\``
      : '-'
    return `| [${component.name}](${folder}) | ${macros} | ${tableCell(purpose.trim())} | ${tableCell(component.nhsEquivalent) || '-'} | ${stylePage} |`
  })

  return `# Project components

Auto-generated from the doc comment in each \`macro.njk\`. Do not edit by hand. Regenerate with \`npm run docs\`.

These are the project's own Nunjucks components. **Check this list before using an NHS macro**: some replace or extend one, and the NHS equivalent column says when to use which. For NHS components, see [nhsuk-frontend/index.md](nhsuk-frontend/index.md).

Import a component from \`_components/<name>/macro.njk\`. Its parameters are in the comment at the top of that file. Use only the parameters listed there.

| Component | Macros | Purpose | NHS equivalent | Style guide |
|---|---|---|---|---|
${rows.join('\n')}

For modifier classes you can add to components, see [sass-modifiers.md](sass-modifiers.md).
`
}

const run = () => {
  const isCheck = process.argv.includes('--check')
  const components = fs
    .readdirSync(COMPONENTS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => readComponent(entry.name))
    .sort((first, second) => first.name.localeCompare(second.name, 'en'))

  const problems = [
    ...components.flatMap(findComponentProblems),
    ...findModifierProblems()
  ]
  const reference = buildReference(components)

  if (isCheck) {
    const current = fs.existsSync(OUTPUT_PATH) ? readText(OUTPUT_PATH) : ''
    if (current !== reference)
      problems.push('docs/components.md is out of date: run npm run docs')
  }

  if (problems.length > 0) {
    console.error('Component docs problems:')
    problems.forEach((problem) => console.error(`  ${problem}`))
    process.exit(1)
  }

  if (isCheck) {
    console.log(`Component docs OK (${components.length} components)`)
    return
  }

  fs.writeFileSync(OUTPUT_PATH, reference)
  console.log(`Wrote ${OUTPUT_PATH}`)
}

run()
