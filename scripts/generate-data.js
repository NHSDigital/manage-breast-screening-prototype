// scripts/generate-data.js
//
// Generate the seed data files (app/data/generated/*.json) ahead of boot.
// Run via `npm run generate`; called from heroku-postbuild so dynos start
// with data already on disk instead of generating on first require.

const generateData = require('../app/lib/generate-seed-data')

const started = Date.now()

generateData()
  .then(() => {
    console.log(`Seed data generated in ${Date.now() - started}ms`)
  })
  .catch((err) => {
    console.error('Seed data generation failed:', err)
    process.exit(1)
  })
