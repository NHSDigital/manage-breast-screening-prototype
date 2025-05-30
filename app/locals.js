// app/locals.js

module.exports = (config) => (req, res, next) => {

  const locals = {
    serviceName: config.serviceName,
    currentUrl: req.path,
    flash: req.flash(),
    query: req.query,
    referrerChain: req.query.referrerChain
  }

  // Assign all local variables at once
  Object.assign(res.locals, locals)

  next()
}
