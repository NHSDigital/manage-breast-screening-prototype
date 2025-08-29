// app/filters.js

const fs = require('node:fs')
const path = require('node:path')

module.exports = function () {
  /* eslint-disable-line func-names,no-unused-vars */
  /**
   * Instantiate object used to store the methods registered as a
   * 'filter' (of the same name) within nunjucks. You can override
   * gov.uk core filters by creating filter methods of the same name.
   *
   * @type {object}
   */
  const filters = {}

  // Get all files from utils directory
  const utilsPath = path.join(__dirname, 'lib/utils')
  const filtersPath = path.join(__dirname, 'filters')

  const folderPaths = [utilsPath, filtersPath]

  try {
    folderPaths.forEach((folderPath) => {
      const files = fs.readdirSync(folderPath)

      files.forEach((file) => {
        if (path.extname(file) === '.js') {
          const module = require(path.join(folderPath, file))

          Object.entries(module).forEach(([name, func]) => {
            if (typeof func === 'function') {
              filters[name] = func
            }
          })
        }
      })
    })
  } catch (err) {
    console.warn('Error loading filters:', err)
  }

  return filters
}
