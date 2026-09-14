import { spawn, spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { existsSync, readFileSync } from 'node:fs'
import process from 'node:process'

const isWindows = process.platform === 'win32'
const isMacOS = process.platform === 'darwin'
const isLinux = process.platform === 'linux'
const require = createRequire(import.meta.url)

function run(command, args, options = {}) {
  const child = spawn(command, args, {
    stdio: 'inherit',
    ...options,
  })

  child.on('error', (error) => {
    console.error(`Failed to start ${command}:`, error.message)
    process.exit(1)
  })

  child.on('exit', (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal)
    } else {
      process.exit(code ?? 1)
    }
  })
}

function runWindowsCommand(command, args) {
  // Avoid spawning npx.cmd with shell:true (which triggers Node DEP0190).
  // cmd.exe is the explicit Windows command interpreter instead.
  run(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', command, ...args])
}

function ensureElectronInstalled() {
  let electronEntry

  try {
    electronEntry = require.resolve('electron')
  } catch {
    console.error('Electron is not installed. Run `npm install` (or `pnpm install`) and try again.')
    process.exit(1)
  }

  const electronDir = dirname(electronEntry)
  const pathFile = join(electronDir, 'path.txt')

  if (existsSync(pathFile)) {
    const relativeExecutable = readFileSync(pathFile, 'utf8').trim()
    if (relativeExecutable && existsSync(join(electronDir, 'dist', relativeExecutable))) {
      return
    }
  }

  const installScript = join(electronDir, 'install.js')
  if (!existsSync(installScript)) {
    console.error('Electron is installed as a package, but its runtime binary is missing.')
    console.error('Please reinstall Electron with `npm install electron --save-dev` and try again.')
    process.exit(1)
  }

  console.log('Electron runtime is missing; running Electron install script...')
  const result = spawnSync(process.execPath, [installScript], {
    stdio: 'inherit',
    env: process.env,
  })

  if (result.status !== 0) {
    console.error('Electron runtime installation failed.')
    console.error('Check your network/proxy settings, then run `npm install electron --save-dev` and try again.')
    process.exit(result.status ?? 1)
  }

  if (!existsSync(pathFile)) {
    console.error('Electron install completed without creating path.txt; the Electron binary is still unavailable.')
    console.error('Try deleting node_modules and reinstalling dependencies.')
    process.exit(1)
  }
}

const npx = isWindows ? 'npx.cmd' : 'npx'
const electronViteArgs = ['electron-vite', 'dev']

ensureElectronInstalled()

// Windows does not need (and should not depend on) WSL/bash.
if (isWindows) {
  runWindowsCommand(npx, electronViteArgs)
} else if (isMacOS) {
  // macOS uses the native display server.
  if (process.getuid?.() === 0) {
    console.log('Detected root user, using --no-sandbox')
    run(npx, [...electronViteArgs, '--', '--no-sandbox'])
  } else {
    run(npx, electronViteArgs)
  }
} else if (isLinux) {
  // Linux may run headless in CI/container environments.
  if (!process.env.DISPLAY && !process.env.WAYLAND_DISPLAY) {
    const hasXvfb = spawn('sh', ['-c', 'command -v xvfb-run'], {
      stdio: 'ignore',
    })

    hasXvfb.on('exit', (code) => {
      if (code !== 0) {
        console.error('Error: no display server detected and Xvfb is not installed.')
        console.error('Install it with: apt-get install xvfb')
        process.exit(1)
      }

      run('xvfb-run', [
        '--auto-servernum',
        '--server-args=-screen 0 1024x768x24',
        npx,
        ...electronViteArgs,
        '--',
        '--no-sandbox',
      ])
    })

    hasXvfb.on('error', () => {
      console.error('Error: unable to check for Xvfb.')
      process.exit(1)
    })
  } else if (process.getuid?.() === 0) {
    console.log('Detected root user, using --no-sandbox')
    run(npx, [...electronViteArgs, '--', '--no-sandbox'])
  } else {
    run(npx, electronViteArgs)
  }
} else {
  console.error(`Unsupported platform: ${process.platform}`)
  process.exit(1)
}
