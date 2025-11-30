const { join } = require('node:path')
const { format: urlFormat } = require('node:url')

// External dependencies
const flash = require('connect-flash')
const express = require('express')
const nunjucks = require('nunjucks')

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
const app = express()

// Add variables that are available in all views
app.locals.asset_path = '/public/'
app.locals.serviceName = config.serviceName

// Nunjucks configuration for application
const appViews = [
  join(__dirname, 'app/views/'),
  join(__dirname, 'app/views/_templates'),
  join(__dirname, 'app/views/_includes'),
  join(__dirname, 'node_modules/nhsuk-frontend/dist/nhsuk/components'),
  join(__dirname, 'node_modules/nhsuk-frontend/dist/nhsuk/macros'),
  join(__dirname, 'node_modules/nhsuk-frontend/dist/nhsuk'),
  join(__dirname, 'node_modules/nhsuk-frontend/dist')
]

/**
 * @type {ConfigureOptions}
 */
const nunjucksConfig = {
  autoescape: true,
  noCache: true
}

nunjucksConfig.express = app

let nunjucksAppEnv = nunjucks.configure(appViews, nunjucksConfig)

// Flash messages
app.use(flash())

// Serve the images as static assets
app.use('/images', express.static(join(__dirname, 'app/assets/images')))

// Use public folder for static assets
app.use(express.static(join(__dirname, 'public')))

// Use assets from NHS frontend
app.use(
  '/nhsuk-frontend',
  express.static(join(__dirname, 'node_modules/nhsuk-frontend/dist/nhsuk'))
)

// Add Nunjucks filters
for (const [name, filter] of Object.entries(filters())) {
  nunjucksAppEnv.addFilter(name, filter)

  // Duplicate filter as global function
  nunjucksAppEnv.addGlobal(name, filter)
}

const prototype = NHSPrototypeKit.init({
  serviceName: config.serviceName,
  express: app,
  nunjucks: nunjucksAppEnv,
  routes: routes,
  locals: locals,
  sessionDataDefaults: sessionDataDefaults,
  buildOptions: {
    entryPoints: ['app/assets/sass/main.scss', 'app/assets/javascript/**/*.js']
  }
})

prototype.start()
