/**
 * electron-rebuild writes the Electron-ABI better-sqlite3 binary into
 * `better-sqlite3/bin/<platform>-<arch>-<abi>/`, while `bindings` loads
 * `build/Release/better_sqlite3.node`. Copy the rebuilt binary into the path
 * the runtime actually loads before electron-builder packs the app.
 */
const fs = require('node:fs')
const path = require('node:path')

const moduleRoot = path.join(__dirname, '..', 'node_modules', 'better-sqlite3')
const binRoot = path.join(moduleRoot, 'bin')
const destination = path.join(moduleRoot, 'build', 'Release', 'better_sqlite3.node')

function fail(message) {
  console.error(`[native] ${message}`)
  process.exit(1)
}

if (!fs.existsSync(binRoot)) fail(`missing ${binRoot}; run electron-rebuild first`)
if (!fs.existsSync(destination)) fail(`missing ${destination}; run electron-rebuild first`)

const candidates = fs
  .readdirSync(binRoot, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && /^(win32|darwin|linux)-/.test(entry.name))
  .map((entry) => {
    const file = path.join(binRoot, entry.name, 'better-sqlite3.node')
    return fs.existsSync(file)
      ? { file, mtimeMs: fs.statSync(file).mtimeMs }
      : null
  })
  .filter(Boolean)
  .sort((left, right) => right.mtimeMs - left.mtimeMs)

if (candidates.length === 0) fail(`no rebuilt better-sqlite3 binary under ${binRoot}`)

fs.copyFileSync(candidates[0].file, destination)
console.log(`[native] copied ${path.basename(path.dirname(candidates[0].file))} binary into build/Release`)
