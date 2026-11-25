const path = require('node:path')
const { pathToFileURL } = require('node:url')

const nunjucks = require('nunjucks')
const NHSPrototypeKit = require('nhsuk-prototype-kit')
const { searchPaths: kitSearchPaths } = require('nhsuk-prototype-kit/config')

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
  'app/assets/javascript/*.js',

  // Not a real build target: the kit adds every entry point to nodemon's
  // ignore list, and without this glob each seed data regeneration (which
  // writes app/data/generated/*.json) would restart the server. The
  // public/data/generated/*.js files esbuild emits as a result are an
  // unused side effect.
  'app/data/generated/**/*.json'
]

// The kit's nodemon watches the whole repo for .json changes, so each save
// from /admin/real-cases (which writes annotations.json and its backups in the
// pack) would restart the server and reload the page. The entry point trick
// above would copy the pack into public/, so add it to nodemon's ignore list
// directly; the kit doesn't export its nodemon config.
const ignoreRealImagesPack = async () => {
  const kitPath = path.dirname(
    require.resolve('nhsuk-prototype-kit/package.json')
  )
  const nodemonConfigUrl = pathToFileURL(
    path.join(kitPath, 'lib', 'nodemon.config.js')
  ).href
  try {
    const { default: nodemonConfig } = await import(nodemonConfigUrl)
    nodemonConfig.ignore.push('real-images/**/*')
  } catch (error) {
    console.warn(
      `Could not stop nodemon watching real-images/: ${error.message}`
    )
  }
}

async function init() {
  if (process.env.NODE_ENV !== 'production') {
    await ignoreRealImagesPack()
  }

  // Our own Nunjucks environment, set up as the kit sets up its default one,
  // so we control the template cache. The kit's default always sets noCache,
  // which recompiles every template on every request - most of a page's
  // render time. Development needs that, because nodemon does not restart on
  // template edits. Production and the test servers never see an edit, so
  // they cache. Only compiled templates are cached; every page still renders
  // with its own request's data.
  const cacheTemplates =
    process.env.NODE_ENV === 'production' ||
    process.env.CACHE_TEMPLATES === 'true'
  const nunjucksEnv = nunjucks.configure([...viewsPath, ...kitSearchPaths], {
    noCache: !cacheTemplates,
    lstripBlocks: true,
    trimBlocks: true
  })

  const prototype = await NHSPrototypeKit.init({
    serviceName: config.serviceName,
    nunjucks: nunjucksEnv,
    buildOptions: {
      entryPoints
    },
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
