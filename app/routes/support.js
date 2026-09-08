// app/routes/support.js
//
// Support pages are generated from the markdown in app/content/support - see
// docs/support-content.md. There is one route per page shape, not per page.

const {
  getSupportSections,
  getSupportArticle
} = require('../lib/utils/support-content')

module.exports = (router) => {
  // The left-hand nav appears on every support page, so it goes in locals
  router.use('/support', (req, res, next) => {
    res.locals.navActive = 'support'
    res.locals.supportSections = getSupportSections()
    next()
  })

  router.get('/support', (req, res) => {
    res.render('support/index')
  })

  router.get('/support/:sectionSlug/:articleSlug', (req, res, next) => {
    const article = getSupportArticle(
      req.params.sectionSlug,
      req.params.articleSlug
    )

    if (!article) return next()

    res.render('support/article', { article })
  })
}
