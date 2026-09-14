#!/usr/bin/env node
/**
 * Build the WebLLM browser sidecar for packaging.
 *
 * Step 1: compile all TypeScript files under src/web-runtime (CJS) into
 *         out/web-runtime via its standalone tsconfig.
 * Step 2: copy src/web-runtime/providers/{chatgpt,doubao}/ unchanged into
 *         out/web-runtime/providers/ — these are plain .js runtimes (loaded
 *         via `require` from provider-runtime.ts) plus their manifest.json,
 *         so tsc's compile produces nothing for them.
 *
 * electron-builder then copies out/web-runtime -> <resources>/web-runtime via
 * build.extraResources (see package.json).
 */
import { spawnSync } from 'node:child_process'
import { cpSync, existsSync, rmSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
// Invoke the TypeScript compiler directly via its JS entry: the .bin shim path
// contains spaces on Windows and breaks under a `shell` spawn.
const tscJs = path.join(root, 'node_modules', 'typescript', 'lib', 'tsc.js')

const build = spawnSync(
  process.execPath,
  [tscJs, '-p', path.join('src', 'web-runtime', 'tsconfig.json')],
  { cwd: root, stdio: 'inherit' },
)

if (build.status !== 0) {
  process.exit(build.status ?? 1)
}

const srcProviders = path.join(root, 'src', 'web-runtime', 'providers')
const outProviders = path.join(root, 'out', 'web-runtime', 'providers')

// Replace any stale providers output with a fresh copy so deleted provider
// runtimes never linger in the built artifact.
rmSync(outProviders, { recursive: true, force: true })
cpSync(srcProviders, outProviders, { recursive: true })

// Ship Playwright (and its bundled playwright-core) plus zod inside the
// sidecar output so the packaged sidecar under <resources>/web-runtime can
// `require('playwright')` / `require('zod')` without relying on an install-tree
// node_modules that does not exist in a real install. electron-builder copies
// this whole directory via build.extraResources.
const outNodeModules = path.join(root, 'out', 'web-runtime', 'node_modules')
for (const pkg of ['playwright', 'playwright-core', 'zod']) {
  const src = path.join(root, 'node_modules', pkg)
  const dest = path.join(outNodeModules, pkg)
  rmSync(dest, { recursive: true, force: true })
  if (existsSync(src)) {
    cpSync(src, dest, { recursive: true })
  } else {
    throw new Error(`[web-runtime] missing dependency for sidecar packaging: ${pkg}`)
  }
}

console.log('[web-runtime] compiled + copied providers + deps ->', path.relative(root, outNodeModules))