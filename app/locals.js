// app/locals.js
const environmentMiddleware = require('./lib/middleware/environment')

module.exports = (req, res, next) => {
  environmentMiddleware(req, res, () => {})

  const currentUser = req.session.data.currentUser
  const currentBSU = currentUser
    ? req.session.data.breastScreeningUnits?.find(
        (unit) => unit.id === currentUser.breastScreeningUnit
      )
    : null

  const locals = {
    currentUrl: req.path,
    query: req.query,
    referrerChain: req.query.referrerChain,
    currentUser: currentUser,
    currentBSU: currentBSU,
    isAppointmentWorkflow: false
  }

  // Assign all local variables at once
  Object.assign(res.locals, locals)

  // Read the flash only when something asks for it, usually a page rendering.
  // Reading it here on every request would use up a message on a request that
  // only redirects, before it reaches the page meant to show it. On render the
  // kit's express-flash has already moved the messages to res.locals.messages
  let flash
  Object.defineProperty(res.locals, 'flash', {
    enumerable: true,
    configurable: true,
    get: () => (flash ??= res.locals.messages ?? req.flash()),
    set: (value) => {
      flash = value
    }
  })

  next()
}
