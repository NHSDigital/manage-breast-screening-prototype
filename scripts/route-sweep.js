// scripts/route-sweep.js
//
// Boots the prototype, walks every GET route registered on the Express router,
// fills in the URL parameters from the seeded data, and requests each one.
// Fails if anything returns a server error.
//
// This is the cheap broad layer of the smoke suite: no browser, no journeys,
// just "does every page still render". Node only throws on a broken require or
// a stranded identifier when the route actually runs, which is exactly the
// class of bug this catches.
//
// Run with: npm run test:routes

const { spawn } = require('child_process')
const fs = require('fs')
const path = require('path')
const dayjs = require('dayjs')

const port = Number(process.env.SWEEP_PORT || 3011)
const baseUrl = `http://localhost:${port}`
const rootPath = path.join(__dirname, '..')

// Settings pinned for the sweep, so pages that branch on them render the same
// way whatever a developer's local defaults happen to be
const sweepSettings = {
  'settings[modalForms]': 'true',
  'settings[appointment][confirmIdentityOnCheckIn]': 'true',
  'settings[appointment][manualImageCollection]': 'true',
  'settings[reading][blindReading]': 'true',
  'settings[reading][annotationsMode]': 'without-images'
}

// Routes that change state rather than render a page. They are reachable and
// working, but sweeping them would check people in, complete appointments and
// regenerate the seed data mid-run.
const skippedPaths = [
  { pattern: /\/check-in\//, reason: 'checks a participant in' },
  { pattern: /\/start$/, reason: 'starts an appointment' },
  { pattern: /\/resume$/, reason: 'resumes an appointment' },
  { pattern: /\/undo-check-in$/, reason: 'reverses a check-in' },
  { pattern: /\/complete$/, reason: 'completes an appointment' },
  { pattern: /\/save-opinion$/, reason: 'saves a reading opinion' },
  { pattern: /\/confirm-reads$/, reason: 'confirms reading opinions' },
  {
    pattern: /^\/reading\/create-session/,
    reason: 'creates a reading session'
  },
  { pattern: /^\/settings\/regenerate/, reason: 'regenerates the seed data' },
  { pattern: /^\/prototype-admin\/reset/, reason: 'clears the session' },
  { pattern: /^\/start$/, reason: 'logs out' }
]

/**
 * Start the prototype as a plain Express process and wait for it to answer.
 *
 * PROXY=true makes the kit skip its nodemon/browsersync watch wrapper, which
 * would otherwise leave a process we cannot cleanly kill.
 *
 * @returns {Promise<import('child_process').ChildProcess>} The running server
 */
const startServer = async () => {
  const server = spawn('node', ['.'], {
    cwd: rootPath,
    env: { ...process.env, PORT: String(port), PROXY: 'true' },
    stdio: ['ignore', 'ignore', 'pipe']
  })

  let serverError = ''
  server.stderr.on('data', (chunk) => {
    serverError += chunk.toString()
  })

  const deadline = Date.now() + 180_000
  while (Date.now() < deadline) {
    if (server.exitCode !== null) {
      throw new Error(`Server exited before starting:\n${serverError}`)
    }
    try {
      await fetch(baseUrl, { signal: AbortSignal.timeout(5000) })
      return server
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 500))
    }
  }

  server.kill()
  throw new Error(`Server did not start on ${baseUrl} within 180 seconds`)
}

/**
 * A fetch that carries a session cookie between requests, so the sweep behaves
 * like one user rather than a new session per page
 *
 * @returns {(url: string) => Promise<Response>} Fetch bound to a cookie jar
 */
const createSessionFetch = () => {
  let cookie = null

  return async (url) => {
    const response = await fetch(url, {
      redirect: 'manual',
      headers: cookie ? { cookie } : {}
    })

    const setCookie = response.headers.getSetCookie?.()
    if (setCookie?.length) {
      cookie = setCookie.map((entry) => entry.split(';')[0]).join('; ')
    }

    return response
  }
}

/**
 * Every GET path registered on the app router, with array paths expanded
 *
 * @returns {Array<string>} Route paths
 */
const getRoutePaths = () => {
  const router = require(path.join(rootPath, 'app/routes'))

  return router.stack
    .filter((layer) => layer.route?.methods?.get)
    .flatMap((layer) => [].concat(layer.route.path))
}

/**
 * Collect ids from the seeded data and the running app to fill route params.
 *
 * The reading session id has to come from the app rather than the data files -
 * sessions only exist in session state - so this creates one and reads the id
 * out of the redirect.
 *
 * @param {(url: string) => Promise<Response>} sessionFetch - Cookie-aware fetch
 * @returns {Promise<Record<string, string>>} Parameter name to value
 */
const collectParams = async (sessionFetch) => {
  const generatedPath = path.join(rootPath, 'app/data/generated')
  const clinics = require(path.join(generatedPath, 'clinics.json')).clinics
  const appointments = require(
    path.join(generatedPath, 'appointments.json')
  ).appointments
  const episodes = require(path.join(generatedPath, 'episodes.json')).episodes

  const today = dayjs().format('YYYY-MM-DD')
  const clinic = clinics.find((item) => item.date === today) ?? clinics[0]
  const appointment = appointments.find((item) => item.clinicId === clinic.id)

  if (!appointment) {
    throw new Error(`No appointments found on clinic ${clinic.id}`)
  }

  // Reading cases live inside episodes, so the case views need an id from one
  // that actually has a case rather than one derived from the appointment above
  const episodeWithReadingCase = episodes.find(
    (item) => item.readingCases?.length
  )

  if (!episodeWithReadingCase) {
    throw new Error('No episodes with reading cases found')
  }

  const params = {
    clinicId: clinic.id,
    id: clinic.id,
    appointmentId: appointment.id,
    participantId: appointment.participantId,
    episodeId: appointment.episodeId,
    caseId: episodeWithReadingCase.readingCases[0].id,
    // Filters and views are named tabs; "all" exists on every set of them
    filter: 'all',
    view: 'all',
    // The reading case view's tabs - "reads" exercises more than the default
    tab: 'reads',
    // A medical history type, by slug
    type: 'breast-cancer'
  }

  // Create a reading session so the /reading/session/... routes can be swept
  const created = await sessionFetch(
    `${baseUrl}/reading/create-session?type=all_reads&limit=5&lazy=false`
  )
  const location = created.headers.get('location') ?? ''
  const match = location.match(
    /\/reading\/session\/([^/]+)(?:\/appointments\/([^/?]+))?/
  )

  if (match) {
    params.sessionId = match[1]
    if (match[2]) {
      params.readingAppointmentId = match[2]
    }
  }

  return params
}

/**
 * Every template path referenced by an {% include %} anywhere in app/views.
 *
 * Included templates are fragments: they render inside a host page and blow up
 * if asked to render on their own. Any that also happen to be real pages have
 * their own route, so they still get swept via the router.
 *
 * @returns {Set<string>} Template paths as written in the include, eg
 *   "appointments/exit-appointment/before-images.html"
 */
const getIncludedTemplates = () => {
  const included = new Set()
  const includePattern = /{%-?\s*include\s+["']([^"']+)["']/g

  const walk = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const entryPath = path.join(directory, entry.name)

      if (entry.isDirectory()) {
        walk(entryPath)
        continue
      }

      if (!/\.(html|njk)$/.test(entry.name)) continue

      const contents = fs.readFileSync(entryPath, 'utf8')
      for (const match of contents.matchAll(includePattern)) {
        included.add(match[1])
      }
    }
  }

  walk(path.join(rootPath, 'app/views'))

  return included
}

/**
 * Every page template under a views directory, as URL sub-paths.
 *
 * Appointment and participant pages are mostly served by a wildcard route that
 * renders whichever template matches the URL, so enumerating the router alone
 * misses them. Files and folders prefixed with _ are partials by convention;
 * anything included by another template is a fragment rather than a page.
 *
 * @param {string} viewsDirectory - Directory under app/views
 * @param {Set<string>} includedTemplates - Templates used via {% include %}
 * @returns {Array<string>} Sub-paths, eg "medical-information/symptoms/add"
 */
const getTemplateSubPaths = (viewsDirectory, includedTemplates) => {
  const root = path.join(rootPath, 'app/views', viewsDirectory)
  const subPaths = []

  const walk = (directory, prefix) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (entry.name.startsWith('_')) continue

      if (entry.isDirectory()) {
        walk(path.join(directory, entry.name), `${prefix}${entry.name}/`)
        continue
      }

      if (!entry.name.endsWith('.html')) continue
      if (includedTemplates.has(`${viewsDirectory}/${prefix}${entry.name}`))
        continue

      const name = entry.name.replace(/\.html$/, '')
      // An index template is served by its folder's own URL
      subPaths.push(
        name === 'index' ? prefix.replace(/\/$/, '') : `${prefix}${name}`
      )
    }
  }

  walk(root, '')

  return subPaths.filter(Boolean)
}

/**
 * URLs for the pages served by the wildcard template routes
 *
 * @param {Record<string, string>} params - Parameter values
 * @returns {Array<string>} URLs to sweep
 */
const getTemplateUrls = (params) => {
  const includedTemplates = getIncludedTemplates()

  return [
    ...getTemplateSubPaths('appointments', includedTemplates).map(
      (subPath) =>
        `/clinics/${params.clinicId}/appointments/${params.appointmentId}/${subPath}`
    ),
    ...getTemplateSubPaths('participants', includedTemplates).map(
      (subPath) => `/participants/${params.participantId}/${subPath}`
    )
  ]
}

/**
 * Substitute parameters into a route path
 *
 * @param {string} routePath - Express route path
 * @param {Record<string, string>} params - Parameter values
 * @returns {{url: string} | {skip: string}} A URL, or why it was skipped
 */
const buildUrl = (routePath, params) => {
  if (routePath.includes('*')) {
    return { skip: 'wildcard route - no single URL to request' }
  }

  const missing = []
  const url = routePath.replace(/:([A-Za-z0-9_]+)/g, (match, name) => {
    // Reading routes nest an appointment inside a session, and that appointment
    // has to be one of the session's cases
    if (name === 'appointmentId' && routePath.startsWith('/reading/session/')) {
      if (!params.readingAppointmentId) {
        missing.push(name)
        return match
      }
      return params.readingAppointmentId
    }

    if (!params[name]) {
      missing.push(name)
      return match
    }

    return params[name]
  })

  if (missing.length) {
    return { skip: `no seeded value for :${missing.join(', :')}` }
  }

  return { url }
}

const run = async () => {
  console.log(`Starting prototype on ${baseUrl} ...`)
  const server = await startServer()

  const failures = []
  const skipped = []
  let checked = 0

  try {
    const sessionFetch = createSessionFetch()

    // Warm the app up: this is the request that regenerates stale seed data
    await sessionFetch(`${baseUrl}/`)
    await sessionFetch(`${baseUrl}/?${new URLSearchParams(sweepSettings)}`)

    const params = await collectParams(sessionFetch)
    const routePaths = getRoutePaths()
    const urls = new Set()

    for (const routePath of routePaths) {
      const stateChanging = skippedPaths.find((entry) =>
        entry.pattern.test(routePath)
      )
      if (stateChanging) {
        skipped.push({ routePath, reason: stateChanging.reason })
        continue
      }

      const built = buildUrl(routePath, params)
      if (built.skip) {
        skipped.push({ routePath, reason: built.skip })
        continue
      }

      urls.add(built.url)
    }

    for (const url of getTemplateUrls(params)) {
      urls.add(url)
    }

    console.log(
      `Sweeping ${urls.size} URLs from ${routePaths.length} routes and the template folders\n`
    )

    for (const url of urls) {
      const response = await sessionFetch(baseUrl + url)
      checked++

      if (response.status >= 500) {
        failures.push({ url, status: response.status })
        console.log(`  ${response.status}  ${url}`)
      } else if (response.status === 404) {
        // Not a failure - some pages only resolve for particular ids or states -
        // but worth seeing
        console.log(`  404  ${url}`)
      }
    }
  } finally {
    server.kill()
  }

  console.log(`\nSkipped ${skipped.length} routes:`)
  for (const entry of skipped) {
    console.log(`  ${entry.routePath} - ${entry.reason}`)
  }

  console.log(`\nChecked ${checked} routes, ${failures.length} server errors`)

  if (failures.length) {
    process.exitCode = 1
  }
}

run().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
