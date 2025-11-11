// app/locals.js

module.exports = (req, res, next) => {
  const locals = {
    currentUrl: req.path,
    flash: req.flash(),
    query: req.query,
    referrerChain: req.query.referrerChain,
    currentUser: req.session.data.currentUser,
    isAppointmentWorkflow: false
  }

  // Assign all local variables at once
  Object.assign(res.locals, locals)

  next()
}
