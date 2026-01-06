const { join } = require('node:path')

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

const SERVICE_NAME = config.serviceName

// Set configuration variables
const port = parseInt(process.env.PORT || config.port, 10) || 2000

// Initialise applications
const viewsPath = join(__dirname, 'app/views/')

const prototype = NHSPrototypeKit.init({
  serviceName: SERVICE_NAME,
  routes: routes,
  locals: locals,
  sessionDataDefaults: sessionDataDefaults,
  viewsPath: viewsPath,
  buildOptions: {
    entryPoints: ['app/assets/sass/main.scss']
  }
})

// Flash messages
prototype.app.use(flash())

for (const [name, filter] of Object.entries(filters())) {
  prototype.nunjucks.addFilter(name, filter)
}

prototype.start(port)
