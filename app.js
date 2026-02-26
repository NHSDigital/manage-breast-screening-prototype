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
  'app/assets/javascript/*.js',
  'app/data/generated/**/*.json'
]

async function init() {
  const prototype = await NHSPrototypeKit.init({
    serviceName: config.serviceName,
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

  prototype.start(config.port)
}

init()
