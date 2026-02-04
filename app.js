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
  'app/views/_includes'
]

const entryPoints = [
  'app/assets/sass/main.scss',
  'app/assets/javascript/*.js'
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

  prototype.start(port)
}

init()
