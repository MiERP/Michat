const path = require('node:path')
const { spawn, spawnSync } = require('node:child_process')

const workspace = path.resolve(__dirname, '..')
const windows = process.platform === 'win32'
const pnpm = windows ? 'pnpm.cmd' : 'pnpm'
let stopping = false

function run(script) {
  return spawn(pnpm, ['run', script], {
    cwd: workspace,
    shell: windows,
    stdio: 'inherit',
    windowsHide: false
  })
}

function terminate(child) {
  if (!child.pid || child.exitCode !== null) return
  if (windows) {
    spawnSync('taskkill.exe', ['/pid', String(child.pid), '/t', '/f'], { stdio: 'ignore' })
  } else {
    child.kill('SIGTERM')
  }
}

const office = run('office:start')
const electron = run('dev:electron')

function shutdown(code) {
  if (stopping) return
  stopping = true
  spawnSync(pnpm, ['run', 'office:stop'], {
    cwd: workspace,
    shell: windows,
    stdio: 'inherit',
    windowsHide: false
  })
  terminate(office)
  terminate(electron)
  process.exit(code)
}

office.on('error', (error) => {
  console.error(`Word add-in startup failed: ${error.message}`)
  shutdown(1)
})
office.on('exit', (code) => {
  if (!stopping && code && code !== 0) shutdown(code)
})
electron.on('error', (error) => {
  console.error(`Electron startup failed: ${error.message}`)
  shutdown(1)
})
electron.on('exit', (code) => shutdown(code ?? 0))
process.on('SIGINT', () => shutdown(130))
process.on('SIGTERM', () => shutdown(143))
