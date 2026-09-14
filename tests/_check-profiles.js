const Database = require('better-sqlite3')
const fs = require('fs')
const path = require('path')

const chromeData = path.join(process.env.LOCALAPPDATA, 'Google', 'Chrome', 'User Data')

for (const profile of ['Default', 'Profile 1']) {
  const src = path.join(chromeData, profile, 'Network', 'Cookies')
  if (!fs.existsSync(src)) continue
  const tmp = path.join(process.env.TEMP, `chrome-${profile.replace(' ', '')}-check.db`)
  fs.copyFileSync(src, tmp)
  
  const db = new Database(tmp, { readonly: true })
  console.log(`=== ${profile} ===`)
  const rows = db.prepare(
    "SELECT host_key, name FROM cookies WHERE host_key LIKE '%deepseek%' OR host_key LIKE '%chatgpt%' OR name = 'authorization'"
  ).all()
  rows.forEach(r => console.log(`  ${r.host_key} / ${r.name}`))
  if (!rows.length) console.log('  (no relevant cookies)')
  db.close()
  fs.unlinkSync(tmp)
}
