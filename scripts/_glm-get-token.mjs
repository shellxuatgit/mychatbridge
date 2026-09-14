import { chromium } from 'playwright'
import { join } from 'path'
import { homedir } from 'os'

const profileDir = join(homedir(), '.mychatbridge', 'web-runtime', 'playwright-users', 'glm')
const ctx = await chromium.launchPersistentContext(profileDir, { headless: true })
const cookies = await ctx.cookies()
await ctx.close()

const refreshToken = cookies.find(c => c.name === 'chatglm_refresh_token')
const token = cookies.find(c => c.name === 'chatglm_token')

import fs from 'fs'
    refresh_token: refreshToken.value,
    access_token: token?.value || '',
  }, null, 2))
  console.log('REFRESH_TOKEN_LEN', refreshToken.value.length)
  console.log('REFRESH_TOKEN_START', refreshToken.value.substring(0, 30))
} else {
  console.log('NO_REFRESH_TOKEN_FOUND')
}
