// app/routes/users.js
//
// Choosing which user to simulate. See app/views/choose-user.html.

const sharedData = require('../lib/shared-data')
const { getReturnUrl, urlWithReferrer } = require('../lib/utils/referrers')

module.exports = (router) => {
  // The chosen user arrives as _userId, a one-off field kept out of the
  // session, so the user only changes once any warning has been answered.
  // Choosing a user signed in on another browser sharing the same data asks
  // first, because their changes would look like the same person's.
  router.post('/choose-user/answer', (req, res) => {
    const data = req.session.data
    const referrerChain = req.query.referrerChain
    const user = data.users.find(
      (candidate) => candidate.id === req.body._userId
    )

    if (!user) {
      return res.redirect(urlWithReferrer('/choose-user', referrerChain))
    }

    const isSignedInElsewhere =
      user.id !== data.currentUser?.id &&
      sharedData.getUsersSignedInElsewhere(data, req.sessionID)[user.id]

    if (isSignedInElsewhere && req.body._isConfirmed !== 'true') {
      return res.redirect(
        urlWithReferrer(`/choose-user/in-use?_userId=${user.id}`, referrerChain)
      )
    }

    data.currentUserId = user.id
    return res.redirect(getReturnUrl('/dashboard', referrerChain))
  })

  router.get('/choose-user/in-use', (req, res) => {
    const data = req.session.data
    const user = data.users.find(
      (candidate) => candidate.id === req.query._userId
    )
    if (!user) {
      return res.redirect(
        urlWithReferrer('/choose-user', req.query.referrerChain)
      )
    }

    return res.render('choose-user/in-use', {
      user,
      signedInElsewhereCount:
        sharedData.getUsersSignedInElsewhere(data, req.sessionID)[user.id] || 0
    })
  })
}
