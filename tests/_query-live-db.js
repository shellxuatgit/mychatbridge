const Database = require('better-sqlite3')
const path = require('path')
const fs = require('fs')

const tmp = path.join(process.env.TEMP, 'chrome-live-cookies.db')
if (!fs.existsSync(tmp)) { console.log('DB not found'); process.exit(1) }

const db = new Database(tmp, { readonly: true })

// Find authorization cookie ANYWHERE
const auth = db.prepare("SELECT host_key, name FROM cookies WHERE name = 'authorization'").all()
console.log('authorization cookies:', auth.length)
auth.forEach(r => console.log(`  ${r.host_key} / ${r.name}`))

// Find ALL deepseek cookies
const ds = db.prepare("SELECT host_key, name FROM cookies WHERE host_key LIKE '%deepseek%'").all()
console.log(`\nAll deepseek cookies (${ds.length}):`)
ds.forEach(r => console.log(`  ${r.host_key} / ${r.name}`))

// Total cookie count
const total = db.prepare("SELECT count(*) as cnt FROM cookies").get()
console.log(`\nTotal cookies in DB: ${total.cnt}`)

db.close()
