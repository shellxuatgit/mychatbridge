const Database = require('better-sqlite3')
const path = require('path')

const dbPath = path.join(process.env.LOCALAPPDATA, 'Google', 'Chrome', 'User Data', 'Default', 'Network', 'Cookies')
const db = new Database(dbPath, { readonly: true })

// Search for any cookie with 'auth' in name
const auth = db.prepare("SELECT host_key, name, length(encrypted_value) as val_len FROM cookies WHERE name LIKE '%auth%' ORDER BY host_key").all()
console.log('Cookies with "auth" in name (' + auth.length + '):')
auth.forEach(r => console.log('  ' + r.host_key + ' / ' + r.name + ' (encrypted_value length: ' + r.val_len + ')'))

// Also check all deepseek cookies with full details
console.log('\n--- All deepseek.com cookies (full detail) ---')
const ds = db.prepare("SELECT host_key, name, path, is_secure, is_httponly, length(encrypted_value) as val_len, datetime(expires_utc/1000000-11644473600, 'unixepoch') as expires FROM cookies WHERE host_key LIKE '%deepseek%'").all()
ds.forEach(r => console.log('  ' + r.host_key + ' | ' + r.name + ' | path=' + r.path + ' | secure=' + r.is_secure + ' | httponly=' + r.is_httponly + ' | val_len=' + r.val_len + ' | expires=' + r.expires))

db.close()
