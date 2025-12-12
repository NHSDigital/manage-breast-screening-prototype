// app/locals.js

module.exports = (config) => (req, res, next) => {
  const currentUser = req.session.data.currentUser
  const currentBSU = currentUser
    ? req.session.data.breastScreeningUnits?.find(unit => unit.id === currentUser.breastScreeningUnit)
    : null

  const locals = {
    serviceName: config.serviceName,
    currentUrl: req.path,
    flash: req.flash(),
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
