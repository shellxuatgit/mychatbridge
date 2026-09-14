import { existsSync, readdirSync, copyFileSync, mkdtempSync, rmSync, readFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { parseLogEntries, type LogEntry } from './leveldbLog.ts'
import { parseSstEntries } from './leveldbSst.ts'
import { extractScriptValue } from './chromeLocalStorage.ts'

export type BrowserName = 'chrome' | 'edge'

export interface LocalStorageReaderOptions {
  browserPaths?: (browser: BrowserName) => { leveldbDir: string } | null
}

function defaultLeveldbDir(browser: BrowserName): string | null {
  if (!process.env.LOCALAPPDATA) return null
  const base = join(
    process.env.LOCALAPPDATA,
    browser === 'chrome' ? 'Google\\Chrome' : 'Microsoft\\Edge',
    'User Data'
  )
  return join(base, 'Default', 'Local Storage', 'leveldb')
}

export class LocalStorageReader {
  private resolveDirs: (browser: BrowserName) => { leveldbDir: string } | null

  constructor(opts: LocalStorageReaderOptions = {}) {
    this.resolveDirs = opts.browserPaths ?? ((b) => ({ leveldbDir: defaultLeveldbDir(b) }))
  }

  /**
   * Read the deepseek userToken from the browser's localStorage LevelDB WAL
   * (.log) files. Returns null when the dir is missing or no match is found —
   * never throws to the caller.
   */
  async findToken(browser: BrowserName, tokenKey: string, originPart: string): Promise<string | null> {
    const resolved = this.resolveDirs(browser)
    if (!resolved) return null
    const { leveldbDir } = resolved
    if (!leveldbDir || !existsSync(leveldbDir)) return null

    // Copy source files to a temp dir to avoid file locks while Chrome runs
    const tmp = mkdtempSync(join(tmpdir(), 'mcb-ls-'))
    try {
      const files = readdirSync(leveldbDir)
      for (const f of files) {
        if (f.endsWith('.log') || f.endsWith('.ldb')) {
          copyFileSync(join(leveldbDir, f), join(tmp, f))
        }
      }

      // Parse newest log first (higher numeric prefix = newer)
      const logs = readdirSync(tmp).filter((f) => f.endsWith('.log'))
      const allEntries: LogEntry[] = []
      for (const log of logs.sort((a, b) => parseInt(b, 10) - parseInt(a, 10))) {
        try {
          const entries = parseLogEntries(readFileSync(join(tmp, log)))
          allEntries.push(...entries)
        } catch {
          // skip corrupted log, continue
        }
      }

      // WAL only holds recent writes; older state is compacted into .ldb SSTs.
      // Parse those too so tokens landed in .ldb still resolve.
      for (const sst of readdirSync(tmp).filter((f) => f.endsWith('.ldb'))) {
        try {
          const entries = parseSstEntries(readFileSync(join(tmp, sst)))
          if (entries.length > 0) allEntries.push(...entries)
        } catch {
          // skip corrupted sst, continue
        }
      }

      const token = extractScriptValue(allEntries, originPart, tokenKey)
      return token
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  }
}