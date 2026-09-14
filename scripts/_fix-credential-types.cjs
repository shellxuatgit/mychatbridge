const fs = require('fs')
const files = ['claude','glm','kimi','minimax','qwen','qwen-ai','zai','mimo','perplexity','yuanbao']
let changed = 0
for (const name of files) {
  const p = 'src/main/providers/builtin/' + name + '.ts'
  let s = fs.readFileSync(p, 'utf8')
  const orig = s
  s = s.split("type: 'password'").join("type: 'textarea'")
  if (s !== orig) { fs.writeFileSync(p, s); changed++; console.log('updated:', name) }
}
console.log('total changed:', changed)
