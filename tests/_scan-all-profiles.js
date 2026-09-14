const Database = require('better-sqlite3')
const fs = require('fs')
const path = require('path')

const chromeData = path.join(process.env.LOCALAPPDATA, 'Google', 'Chrome', 'User Data')

// Find all profiles
const entries = fs.readdirSync(chromeData, { withFileTypes: true })
const profiles = entries
  .filter(e => e.isDirectory() && (e.name === 'Default' || e.name.startsWith('Profile')))
  .map(e => e.name)

console.log(`Found ${profiles.length} profiles: ${profiles.join(', ')}\n`)

for (const profile of profiles) {
  const cookiesDb = path.join(chromeData, profile, 'Network', 'Cookies')
  if (!fs.existsSync(cookiesDb)) {
    console.log(`[${profile}] No Cookies DB`)
    continue
  }

  const tmp = path.join(process.env.TEMP, `scan-${profile.replace(/\s/g, '')}.db`)
  fs.copyFileSync(cookiesDb, tmp)

  const db = new Database(tmp, { readonly: true })

  // Check for authorization cookie on any deepseek domain
  const authRows = db.prepare(
    "SELECT host_key, name, length(encrypted_value) as enc_len FROM cookies WHERE name = 'authorization'"
  ).all()

  // Also check for all deepseek-related cookies
  const dsRows = db.prepare(
    "SELECT host_key, name FROM cookies WHERE host_key LIKE '%deepseek%' ORDER BY host_key, name"
  ).all()

  console.log(`[${profile}]`)
  console.log(`  DeepSeek cookies: ${dsRows.length}`)
  dsRows.forEach(r => console.log(`    ${r.host_key} / ${r.name}`))

  if (authRows.length > 0) {
    console.log(`  >>> authorization cookie FOUND:`)
    authRows.forEach(r => console.log(`    ${r.host_key} / ${r.name} (encrypted_len=${r.enc_len})`))
  } else {
    console.log(`  No authorization cookie anywhere`)
  }
  console.log()

  db.close()
  fs.unlinkSync(tmp)
}
