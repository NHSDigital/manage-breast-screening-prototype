// Core dependencies
const gulp = require('gulp');

// External dependencies
const babel = require('gulp-babel');
const browserSync = require('browser-sync');
const clean = require('gulp-clean');
const nodemon = require('gulp-nodemon');
const gulpSass = require('gulp-sass');
const PluginError = require('plugin-error');
const dartSass = require('sass-embedded');

// Local dependencies
const config = require('./app/config');

// Set configuration variables
const port = parseInt(process.env.PORT) || config.port;

// Set Sass compiler
const sass = gulpSass(dartSass);

// Delete all the files in /public build directory
function cleanPublic() {
  return gulp.src('public', { allowEmpty: true }).pipe(clean());
}

// Compile SASS to CSS
function compileStyles(done) {
  return gulp
    .src(['app/assets/sass/**/*.scss', 'docs/assets/sass/**/*.scss'], {
      sourcemaps: true
    })
    .pipe(sass({
      loadPaths: ['node_modules'],
      sourceMap: true,
      sourceMapIncludeSources: true,
    }).on('error', (error) => {
      done(
        new PluginError('compileCSS', error.messageFormatted, {
          showProperties: false,
        })
      )
    }))
    .pipe(gulp.dest('public/css', {
      sourcemaps: '.'
    }))
}

// Compile JavaScript (with ES6 support)
function compileScripts() {
  return gulp
    .src(['app/assets/javascript/**/*.js'], {
      sourcemaps: true
    })
    .pipe(babel())
    .pipe(
      gulp.dest('public/js', {
        sourcemaps: '.'
      })
    )
}

// Compile assets
function compileAssets() {
  return gulp
    .src([
      'app/assets/**/**/*.*',
      'docs/assets/**/**/*.*',
      '!**/assets/**/**/*.js',
      '!**/assets/**/**/*.scss',
    ], { encoding: false })
    .pipe(gulp.dest('public'));
}


// Start nodemon
function startNodemon(done) {
  const server = nodemon({
    script: 'app.js',
    stdout: true,
    ext: 'js json',
    watch: [
      'app/**/*.js',
      'app.js',
      'routes/**/*.js',
      'lib/**/*.js',
      'config/**/*.js'
    ],
    ignore: [
      'app/assets/**',
      'public/**',
      'node_modules/**'
    ],
    delay: 1000,
    quiet: false,
  })

  let starting = false

  const onReady = () => {
    starting = false
    done()
  }

  server.on('start', () => {
    starting = true
    setTimeout(onReady)
  })

  server.on('stdout', (stdout) => {
    process.stdout.write(stdout)
    if (starting) {
      onReady()
    }
  })

  server.on('restart', () => {
    console.log('Restarting server due to changes...')
  })
}

function reload() {
  browserSync.reload();
}

// Start browsersync
function startBrowserSync(done) {
  browserSync.init({
    proxy: 'localhost:' + port,
    port: port + 1000,
    ui: false,
    files: [
      'app/views/**/*',
      'public/css/**/*.css',
      'public/js/**/*.js'
    ],
    ghostMode: false,
    open: false,
    notify: false,
    logFileChanges: false,
    reloadDebounce: 1000
  }, done)

  // Watch compiled files for reload
  gulp.watch('public/**/*.*').on('change', reload)
}

// Watch files
function watch() {
  gulp.watch('app/assets/sass/**/*.scss', compileStyles)
  gulp.watch('app/assets/javascript/**/*.js', compileScripts)
  gulp.watch('app/assets/**/**/*.*', compileAssets)
  gulp.watch('docs/assets/sass/**/*.scss', compileStyles)
  gulp.watch('docs/assets/javascript/**/*.js', compileScripts)
  gulp.watch('docs/assets/**/**/*.*', compileAssets)
}

exports.watch = watch
exports.compileStyles = compileStyles
exports.compileScripts = compileScripts
exports.cleanPublic = cleanPublic

gulp.task('build',
  gulp.series(cleanPublic, compileStyles, compileScripts, compileAssets)
)

gulp.task('default', gulp.series(startNodemon, startBrowserSync, watch))