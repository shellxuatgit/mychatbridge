const Database = require('better-sqlite3')
const path = require('path')

const dbPath = path.join(process.env.LOCALAPPDATA, 'Google', 'Chrome', 'User Data', 'Default', 'Network', 'Cookies')

try {
  const db = new Database(dbPath, { readonly: true })
  
  const auth = db.prepare("SELECT host_key, name FROM cookies WHERE name = 'authorization'").all()
  console.log('authorization cookies:', auth.length)
  auth.forEach(r => console.log('  ' + r.host_key + ' / ' + r.name))

  // Also check all deepseek cookies
  const ds = db.prepare("SELECT host_key, name FROM cookies WHERE host_key LIKE '%deepseek%'").all()
  console.log('\nAll deepseek cookies:', ds.length)
  ds.forEach(r => console.log('  ' + r.host_key + ' / ' + r.name))

  // Total count
  const total = db.prepare("SELECT count(*) as cnt FROM cookies").get()
  console.log('\nTotal cookies:', total.cnt)

  db.close()
} catch(e) {
  console.log('Error:', e.message)
}
