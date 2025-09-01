// app/lib/utils/dynamic-routing.js

/**
 * Create a simple dynamic route handler that just attempts template rendering
 * Assumes all data is already set up in res.locals by middleware
 * @param {Object} options - Configuration options
 * @param {string} options.templatePrefix - Template path prefix (e.g., 'participants')
 * @returns {Function} Express route handler
 */
const createDynamicTemplateRoute = (options) => {
  const { templatePrefix } = options

  return (req, res, next) => {
    const { subPaths } = req.params // Get the wildcard paths
    const subPath = subPaths?.join('/') ?? ''

    console.log(`Dynamic route attempting to render: ${templatePrefix}/${subPath}`)

    // Try to render {templatePrefix}/{subPath}
    const templatePath = `${templatePrefix}/${subPath}`

    res.render(templatePath, (error, html) => {
      if (!error) {
        console.log(`Successfully rendered: ${templatePath}`)
        res.set({ 'Content-type': 'text/html; charset=utf-8' })
        res.end(html)
        return
      }
      if (!error.message.startsWith('template not found')) {
        console.log(`Error rendering ${templatePath}:`, error.message)
        next(error)
        return
      }

      console.log(`Template not found: ${templatePath}, trying index variant`)

      // Try with /index if the path doesn't already end with /index
      if (!subPath.endsWith('/index')) {
        const indexPath = `${templatePrefix}/${subPath}/index`
        res.render(indexPath, (indexError, indexHtml) => {
          if (!indexError) {
            console.log(`Successfully rendered: ${indexPath}`)
            res.set({ 'Content-type': 'text/html; charset=utf-8' })
            res.end(indexHtml)
            return
          }
          console.log(`Template not found: ${indexPath}`)
          next() // Template not found, let other routes handle it or trigger 404
        })
        return
      }
      console.log(`No template found for: ${templatePrefix}/${subPath}`)
      next() // Template not found
    })
  }
}

module.exports = {
  createDynamicTemplateRoute
}