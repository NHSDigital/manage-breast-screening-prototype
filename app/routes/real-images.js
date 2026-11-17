// app/routes/real-images.js
//
// Real mammogram images: serving them, and unlocking them with the access
// code (app/lib/real-images-access.js). Registered ahead of the session data
// middleware in app/routes.js, which none of these need. See
// docs/mammogram-images.md.

const realImages = require('../lib/real-images')
const {
  isRealImagesUnlocked,
  unlockRealImages
} = require('../lib/real-images-access')
const { getReturnUrl, urlWithReferrer } = require('../lib/utils/referrers')

const ACCESS_CODE_FIELD = '_realImagesAccessCode'
const ACCESS_CODE_LINK_PARAM = '_realImagesCode'

module.exports = (router) => {
  // Images from the pack's images/ folder. Served here rather than from
  // app/assets or public because the kit serves those before its password
  // check, and these must never be public. no-store so they aren't left in
  // the browser's disk cache on shared reading workstations.
  router.get('/real-images/*imagePath', (req, res) => {
    if (!isRealImagesUnlocked(req.session.data)) return res.sendStatus(403)

    const image = realImages.getImageSource(req.params.imagePath.join('/'))

    if (!image) return res.sendStatus(404)

    res.set('Cache-Control', 'no-store')
    if (image.redirectUrl) return res.redirect(image.redirectUrl)
    res.sendFile(image.filePath, { cacheControl: false })
  })

  // A link can carry the access code (?_realImagesCode=...), so a participant
  // can be sent a link that unlocks real images. The code is taken out of the
  // address straight away.
  router.use((req, res, next) => {
    const code = req.query[ACCESS_CODE_LINK_PARAM]
    if (code === undefined || req.method !== 'GET') return next()

    if (unlockRealImages(req.session.data, code)) {
      req.flash('success', 'Real mammogram images unlocked')
    } else {
      req.flash('error', {
        text: 'The access code in the link is not correct. Ask the research team for a new link',
        href: '/real-images-access'
      })
    }

    // Back to the same address without the code. Leading slashes and
    // backslashes are collapsed so the redirect can't leave the site
    const [path, queryString = ''] = req.originalUrl.split('?')
    const params = new URLSearchParams(queryString)
    params.delete(ACCESS_CODE_LINK_PARAM)
    const query = params.toString()
    res.redirect(path.replace(/^[/\\]+/, '/') + (query ? `?${query}` : ''))
  })

  router.post('/real-images-access-answer', (req, res) => {
    // Underscore field, so the kit never saves the code in session data
    const code = req.body[ACCESS_CODE_FIELD]

    if (!unlockRealImages(req.session.data, code)) {
      req.flash('error', {
        text: code?.trim()
          ? 'The access code is not correct'
          : 'Enter the access code',
        name: ACCESS_CODE_FIELD,
        href: '#realImagesAccessCode'
      })
      return res.redirect(
        urlWithReferrer('/real-images-access', req.query.referrerChain)
      )
    }

    req.flash('success', 'Real mammogram images unlocked')
    res.redirect(getReturnUrl('/settings', req.query.referrerChain))
  })
}
