const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const { spawnSync } = require('node:child_process')

const workspace = path.resolve(__dirname, '..')
const electronPackage = require.resolve('electron/package.json', { paths: [workspace] })
const electronDir = fs.realpathSync(path.dirname(electronPackage))
const distDir = path.join(electronDir, 'dist')
const pathFile = path.join(electronDir, 'path.txt')
const executableName = process.platform === 'win32' ? 'electron.exe' : 'electron'
const executablePath = path.join(distDir, executableName)

function isInstalled() {
  return (
    fs.existsSync(executablePath) &&
    fs.existsSync(pathFile) &&
    fs.readFileSync(pathFile, 'utf8') === executableName
  )
}

if (isInstalled()) process.exit(0)

const installResult = spawnSync(process.execPath, [path.join(electronDir, 'install.js')], {
  cwd: electronDir,
  stdio: 'inherit'
})
if (installResult.error) throw installResult.error
if (isInstalled()) process.exit(0)
if (process.platform !== 'win32') {
  throw new Error(`Electron install failed with exit code ${installResult.status}`)
}

const packageJson = JSON.parse(fs.readFileSync(electronPackage, 'utf8'))
const archiveName = `electron-v${packageJson.version}-win32-${process.arch}.zip`
const checksums = JSON.parse(fs.readFileSync(path.join(electronDir, 'checksums.json'), 'utf8'))
const expectedHash = checksums[archiveName]
const cacheRoots = [
  process.env.electron_config_cache,
  process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'electron', 'Cache'),
  process.env.TEMP
].filter(Boolean)

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
}

function findArchive() {
  for (const root of cacheRoots) {
    if (!fs.existsSync(root)) continue
    const direct = path.join(root, archiveName)
    if (fs.existsSync(direct) && sha256(direct) === expectedHash) return direct
    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      const nested = path.join(root, entry.name, archiveName)
      if (fs.existsSync(nested) && sha256(nested) === expectedHash) return nested
    }
  }
  throw new Error(`Verified Electron archive not found: ${archiveName}`)
}

if (!electronDir.startsWith(`${workspace}${path.sep}`) || path.dirname(distDir) !== electronDir) {
  throw new Error(`Unsafe Electron directory: ${electronDir}`)
}

const archive = findArchive()
fs.rmSync(distDir, { recursive: true, force: true })
fs.mkdirSync(distDir, { recursive: true })
const quote = (value) => value.replaceAll("'", "''")
const extractResult = spawnSync(
  'powershell.exe',
  [
    '-NoProfile',
    '-NonInteractive',
    '-Command',
    `Expand-Archive -LiteralPath '${quote(archive)}' -DestinationPath '${quote(distDir)}' -Force`
  ],
  { stdio: 'inherit' }
)
if (extractResult.error) throw extractResult.error
if (extractResult.status !== 0) throw new Error(`Expand-Archive failed: ${extractResult.status}`)
fs.writeFileSync(pathFile, executableName, 'utf8')
if (!isInstalled()) throw new Error('Electron binary missing after verified archive extraction')
