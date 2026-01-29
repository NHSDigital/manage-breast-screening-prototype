const NHSPrototypeKit = require('nhsuk-prototype-kit')

// Local dependencies
const config = require('./app/config')
const locals = require('./app/locals')
const routes = require('./app/routes')
const sessionDataDefaults = require('./app/data/session-data-defaults')
const filters = require('./app/filters')

const SERVICE_NAME = config.serviceName

// Set configuration variables
const port = parseInt(process.env.PORT || config.port, 10) || 2000

// Initialise applications
const viewsPath = [
  'app/views/',
  'app/views/_templates/',
  'app/views/_includes'
]

async function init() {
  const prototype = await NHSPrototypeKit.init({
    serviceName: SERVICE_NAME,
    buildOptions: {
      entryPoints: [
        'app/assets/sass/main.scss',
        'app/assets/javascript/*.js'
      ]
    },
    viewsPath,
    routes,
    locals,
    sessionDataDefaults
  })

  // Add custom port number
  prototype.app?.set('port', config.port)

  // Add custom Nunjucks filters
  for (const [name, filter] of Object.entries(filters())) {
    prototype.nunjucks?.addFilter(name, filter)
  }

  prototype.start()
}

init()
