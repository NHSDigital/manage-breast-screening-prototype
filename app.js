const NHSPrototypeKit = require('nhsuk-prototype-kit')

// Local dependencies
const config = require('./app/config')
const locals = require('./app/locals')
const routes = require('./app/routes')
const sessionDataDefaults = require('./app/data/session-data-defaults')
const filters = require('./app/filters')

// Set configuration variables
const port = parseInt(process.env.PORT || config.port, 10) || 2000

// Initialise applications
const viewsPath = [
  'app/views/',
  'app/views/_templates/',
  'app/views/_includes/'
]

const entryPoints = [
  'app/assets/sass/main.scss',
  'app/assets/sass/main-compact.scss',
  'app/assets/javascript/*.js',

  // Not a real build target: the kit adds every entry point to nodemon's
  // ignore list, and without this glob each seed data regeneration (which
  // writes app/data/generated/*.json) would restart the server. The
  // public/data/generated/*.js files esbuild emits as a result are an
  // unused side effect.
  'app/data/generated/**/*.json'
]

// Headless instances - the route sweep, or a server started just to check a
// page - share this checkout's public/ directory with any dev server already
// running. The kit's esbuild build empties public/ before writing to it and
// then watches it, so building from a second instance strips the running
// server's assets. Those instances only need HTML, so they skip
// the build. Meant for `PROXY=true` runs: without the build, the entry points
// no longer reach nodemon's ignore list, so `npm start` with this set would
// restart on every seed data regeneration.
const skipAssetBuild = process.env.SKIP_ASSET_BUILD === 'true'

async function init() {
  const prototype = await NHSPrototypeKit.init({
    serviceName: config.serviceName,
    buildOptions: skipAssetBuild ? undefined : { entryPoints },
    viewsPath,
    routes,
    locals,
    filters,
    sessionDataDefaults
  })

  // Temporary: expose filters as globals until kit supports globals directly
  for (const [name, global] of Object.entries(filters(prototype.nunjucks))) {
    prototype.nunjucks.addGlobal(name, global)
  }

  prototype.start(port)
}

init()
