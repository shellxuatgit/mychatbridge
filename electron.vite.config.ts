import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import type { Plugin } from 'vite'

/**
 * Injects a Content-Security-Policy meta tag into the packaged renderer HTML.
 *
 * Electron warns via `warnAboutInsecureCSP` whenever the renderer allows `eval`
 * (`sandbox: false`) and the page declares no CSP. Dev builds are skipped on
 * purpose: Vite injects an inline React Refresh preamble and serves modules
 * from the dev server, which a strict production policy would block.
 */
function productionCspPlugin(): Plugin {
  const policy = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: https:",
    "font-src 'self' data:",
    "connect-src 'self' http: https: ws:",
    "object-src 'none'",
    "base-uri 'self'",
    "frame-src 'none'",
  ].join('; ')

  return {
    name: 'mychatbridge-production-csp',
    apply: 'build',
    transformIndexHtml(html) {
      return html.replace(
        '<head>',
        `<head>\n    <meta http-equiv="Content-Security-Policy" content="${policy}" />`
      )
    },
  }
}

export default defineConfig({
  main: {
    plugins: [
      externalizeDepsPlugin({
        exclude: [
          'axios',
          '@koa/router',
          'koa',
          'koa-bodyparser',
          'koa-router',
          'eventsource-parser',
          'js-sha3',
          'mime-types',
          'zstd-codec',
          'electron-store',
          'electron-updater'
        ]
      })
    ],
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/main/index.ts')
        },
        output: {
          format: 'cjs'
        }
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/preload/index.ts')
        }
      }
    }
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/renderer/index.html')
        }
      }
    },
    plugins: [react(), productionCspPlugin()],
    resolve: {
      alias: {
        '@': resolve(__dirname, 'src/renderer/src')
      }
    },
    server: {
      host: '0.0.0.0',
      port: 5173
    }
  }
})
