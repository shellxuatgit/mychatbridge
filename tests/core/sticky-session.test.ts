/**
 * Core Gateway Module - Sticky Session Tests
 * Verifies the session manager's sticky routing helpers and message append.
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import { SessionManagerClass } from '../../src/main/proxy/sessionManager.ts'
import { storeManager } from '../../src/main/store/store.ts'

// The singleton's methods delegate to the real storeManager, which reads
// electron-store and requires an Electron runtime. To keep this test pure we
// exercise the sticky helpers against a store-shaped fake by stubbing the
// storeManager surface the helpers touch.
function makeFakeStore(initialSessions: any[] = []) {
  const sessions: any[] = initialSessions
  return {
    sessions,
    getSessionById(id: string) {
      return sessions.find(s => s.id === id)
    },
    addMessageToSession(sessionId: string, message: any) {
      const s = sessions.find(x => x.id === sessionId)
      if (!s) return null
      s.messages.push(message)
      s.lastActiveAt = Date.now()
      return s
    },
    getSessionConfig: () => ({ sessionTimeout: 30, maxMessagesPerSession: 50 }),
  }
}

test('resolveStickySession returns binding for an active session', () => {
  const fake = makeFakeStore([
    { id: 's1', providerId: 'deepseek', accountId: 'acc-1', status: 'active', model: 'deepseek-v4-flash', messages: [], lastActiveAt: Date.now() },
  ])

  // Stub storeManager used by the real SessionManagerClass.
  const originalGet = storeManager.getSessionById
  const originalAdd = storeManager.addMessageToSession
  // @ts-expect-error - test-only stub of the store surface
  storeManager.getSessionById = (id: string) => fake.getSessionById(id)
  // @ts-expect-error - test-only stub of the store surface
  storeManager.addMessageToSession = (id: string, msg: any) => fake.addMessageToSession(id, msg)

  try {
    const mgr = new SessionManagerClass()
    const binding = mgr.resolveStickySession('s1')
    assert.ok(binding)
    assert.equal(binding!.providerId, 'deepseek')
    assert.equal(binding!.accountId, 'acc-1')
    assert.equal(binding!.model, 'deepseek-v4-flash')
  } finally {
    storeManager.getSessionById = originalGet
    storeManager.addMessageToSession = originalAdd
  }
})

test('resolveStickySession returns undefined for unknown or expired sessions', () => {
  const fake = makeFakeStore([
    { id: 's-expired', providerId: 'p', accountId: 'a', status: 'expired', messages: [] },
  ])

  const originalGet = storeManager.getSessionById
  // @ts-expect-error - test-only stub
  storeManager.getSessionById = (id: string) => fake.getSessionById(id)

  try {
    const mgr = new SessionManagerClass()
    assert.equal(mgr.resolveStickySession('does-not-exist'), undefined)
    assert.equal(mgr.resolveStickySession('s-expired'), undefined)
  } finally {
    storeManager.getSessionById = originalGet
  }
})

test('appendMessages persists into an active session and updates lastActiveAt', () => {
  const fake = makeFakeStore([
    { id: 's1', providerId: 'p', accountId: 'a', status: 'active', messages: [], lastActiveAt: 0 },
  ])

  const originalGet = storeManager.getSessionById
  const originalAdd = storeManager.addMessageToSession
  // @ts-expect-error - test-only stub
  storeManager.getSessionById = (id: string) => fake.getSessionById(id)
  // @ts-expect-error - test-only stub
  storeManager.addMessageToSession = (id: string, msg: any) => fake.addMessageToSession(id, msg)

  try {
    const mgr = new SessionManagerClass()
    const ok = mgr.appendMessages('s1', [
      { role: 'user', content: 'hi', timestamp: Date.now() },
      { role: 'assistant', content: 'hello', timestamp: Date.now() },
    ])
    assert.equal(ok, true)
    assert.equal(fake.sessions[0].messages.length, 2)
    assert.ok(fake.sessions[0].lastActiveAt > 0)
  } finally {
    storeManager.getSessionById = originalGet
    storeManager.addMessageToSession = originalAdd
  }
})

test('appendMessages no-ops for unknown session or empty messages', () => {
  const fake = makeFakeStore([])

  const originalGet = storeManager.getSessionById
  // @ts-expect-error - test-only stub
  storeManager.getSessionById = (id: string) => fake.getSessionById(id)

  try {
    const mgr = new SessionManagerClass()
    assert.equal(mgr.appendMessages('missing', [{ role: 'user', content: 'x', timestamp: Date.now() }]), false)
    assert.equal(mgr.appendMessages('missing', []), false)
  } finally {
    storeManager.getSessionById = originalGet
  }
})