// app/routes/admin-real-cases.js
//
// The real case annotator: markers placed on real mammograms, saved to the
// pack's annotations.json (app/lib/real-images-annotation.js). Local only:
// deployed, nothing private may be written to disk, so every route here is a
// 404. See docs/mammogram-images.md.

const fs = require('fs')
const path = require('path')
const config = require('../config')
const {
  getAnnotatorData,
  saveStudyAnnotations
} = require('../lib/real-images-annotation')

const isDeployed = () => process.env.NODE_ENV === 'production'

module.exports = (router) => {
  router.use('/admin/real-cases', (req, res, next) =>
    isDeployed() ? res.sendStatus(404) : next()
  )

  router.get('/admin/real-cases', (req, res) => {
    res.render('admin/real-cases', {
      hasPack: fs.existsSync(path.join(config.paths.realImages, 'manifest.json'))
    })
  })

  router.get('/admin/real-cases/data', (req, res) => {
    const annotatorData = getAnnotatorData()
    if (!annotatorData) return res.sendStatus(404)

    res.set('Cache-Control', 'no-store')
    res.json(annotatorData)
  })

  router.post('/admin/real-cases/save', (req, res) => {
    const { studyId, annotations, review } = req.body || {}

    try {
      res.json(saveStudyAnnotations(studyId, annotations, review))
    } catch (error) {
      console.error('Real case annotator: could not save:', error.message)
      res.status(400).json({ error: error.message })
    }
  })
}
