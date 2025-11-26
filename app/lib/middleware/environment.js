// app/lib/middleware/environment.js

/**
 * Format a link as HTML
 *
 * @param {string} url - The URL to link to
 * @param {string} text - The link text
 * @returns {string} HTML anchor tag
 */
const formatLink = (url, text) => {
  return `<a href="${url}">${text}</a>`
}

/**
 * Environment middleware
 * Sets res.locals.environment based on the current environment
 * Supports: development, production, and review (for Heroku PRs)
 */
const environment = (req, res, next) => {
  let environment = 'production'
  const { HEROKU_BRANCH, HEROKU_PR_NUMBER, NODE_ENV } = process.env

  if (NODE_ENV === 'development') {
    environment = 'development'
  }

  if (HEROKU_PR_NUMBER || HEROKU_BRANCH) {
    environment = 'review'
  }

  const pullRequestUrl =
    HEROKU_PR_NUMBER &&
    `https://github.com/NHSDigital/manage-breast-screening-prototype/pull/${HEROKU_PR_NUMBER}`

  const environments = {
    development: {
      colour: 'white',
      name: 'Prototype',
      text: 'This is a prototype in development.'
    },
    production: {
      colour: 'grey',
      name: 'Prototype',
      text: 'This is a prototype for research.'
    },
    review: {
      colour: 'purple',
      name: HEROKU_PR_NUMBER ? `Prototype PR ${HEROKU_PR_NUMBER}` : 'Prototype',
      html: HEROKU_PR_NUMBER
        ? `This is a prototype for review. ${formatLink(pullRequestUrl, 'View pull request')}`
        : 'This is a prototype for review.'
    }
  }

  res.locals.environment = environments[environment]

  next()
}

module.exports = environment
