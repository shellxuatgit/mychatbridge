const Database = require('better-sqlite3')
const path = require('path')

const dbPath = path.join(process.env.TEMP, 'chrome-reread.db')
const db = new Database(dbPath, { readonly: true })

// List ALL distinct cookie names
const allNames = db.prepare("SELECT DISTINCT name, count(*) as cnt FROM cookies GROUP BY name ORDER BY cnt DESC").all()
console.log('All distinct cookie names (' + allNames.length + '):')
allNames.forEach(r => console.log('  ' + r.name + ' (' + r.cnt + ')'))

db.close()
