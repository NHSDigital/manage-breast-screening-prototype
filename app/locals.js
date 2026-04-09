// app/locals.js
const environmentMiddleware = require('./lib/middleware/environment')

module.exports = (req, res, next) => {
  environmentMiddleware(req, res, () => {})

  const currentUser = req.session.data.currentUser
  const currentBSU = currentUser
    ? req.session.data.breastScreeningUnits?.find(unit => unit.id === currentUser.breastScreeningUnit)
    : null

  const locals = {
    currentUrl: req.path,
    // Don't consume flash for AJAX (XHR) requests — fetch with redirect:'follow' makes
    // an internal GET to the destination which would clear flash before the browser
    // navigates there. Only real browser requests should read and clear flash.
    flash: req.headers['x-requested-with'] === 'XMLHttpRequest' ? {} : req.flash(),
    query: req.query,
    referrerChain: req.query.referrerChain,
    currentUser: currentUser,
    currentBSU: currentBSU,
    isAppointmentWorkflow: false
  }

  // Assign all local variables at once
  Object.assign(res.locals, locals)

  next()
}
