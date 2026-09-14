import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

const skillPaths = [
  {
    file: 'skills/mychatbridge-management-api/SKILL.md',
    name: 'mychatbridge-management-api',
    description:
      "Use when operating MyChatBridge's management API for testing, including health checks, config snapshots, temporary API keys, model mappings, sessions, logs, and cleanup verification.",
  },
  {
    file: 'skills/mychatbridge-har-tool-fixture/SKILL.md',
    name: 'mychatbridge-har-tool-fixture',
    description:
      'Use when converting OpenAI-compatible client HAR files into sanitized replayable MyChatBridge tool-calling fixtures.',
  },
  {
    file: 'skills/mychatbridge-tool-client-replay/SKILL.md',
    name: 'mychatbridge-tool-client-replay',
    description:
      'Use when replaying sanitized client tool-calling fixtures against MyChatBridge with client-specific pass/fail rules.',
  },
  {
    file: 'skills/mychatbridge-provider-model-matrix/SKILL.md',
    name: 'mychatbridge-provider-model-matrix',
    description:
      'Use when running MyChatBridge provider and model matrix tests using live /v1/models discovery and management API attribution.',
  },
  {
    file: 'skills/mychatbridge-proxy-testing/SKILL.md',
    name: 'mychatbridge-management-api'
    description:
      'Use when validating MyChatBridge proxy behavior across dialogue, tool calling, context, provider routing, request logs, and live client replay workflows.',
  },
]

const focusedSkillFiles = skillPaths.filter(({ name }) => name !== 'mychatbridge-proxy-testing').map(({ file }) => file)
const implementedScriptPaths = [
  'skills/mychatbridge-management-api/scripts/management-api.mjs',
  'skills/mychatbridge-har-tool-fixture/scripts/extract-har-fixtures.mjs',
  'skills/mychatbridge-tool-client-replay/scripts/replay-client-fixture.mjs',
  'skills/mychatbridge-provider-model-matrix/scripts/run-model-matrix.mjs',
]

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

test('versioned MyChatBridge testing skills exist and have trigger-only descriptions', () => {
  for (const { file, name, description } of skillPaths) {
    const text = fs.readFileSync(file, 'utf8')
    // Skill frontmatter is a discovery contract; keep exact names and descriptions stable.
    assert.match(
      text,
      new RegExp(`^---\\nname: ${escapeRegExp(name)}\\ndescription: ${escapeRegExp(description)}\\n---`, 'm'),
      file,
    )
    assert.doesNotMatch(text, /T[B]D|FI[X]ME|deferred work/, file)
  }
})

test('focused skill docs reference implemented script paths only', () => {
  for (const file of focusedSkillFiles) {
    const text = fs.readFileSync(file, 'utf8')
    assert.doesNotMatch(text, /Planned Script/, file)
  }

  for (const file of implementedScriptPaths) {
    assert.equal(fs.existsSync(file), true, file)
  }
})

test('proxy testing skill delegates focused responsibilities', () => {
  const text = fs.readFileSync('skills/mychatbridge-proxy-testing/SKILL.md', 'utf8')
  assert.match(text, /mychatbridge-management-api/)
  assert.match(text, /mychatbridge-har-tool-fixture/)
  assert.match(text, /mychatbridge-tool-client-replay/)
  assert.match(text, /mychatbridge-provider-model-matrix/)
})

test('versioned proxy testing skill warns against ignored local source of truth', () => {
  const text = fs.readFileSync('skills/mychatbridge-proxy-testing/SKILL.md', 'utf8')
  assert.match(text, /versioned source of truth/)
  assert.match(text, /ignored \.codex/)
})
