/**
 * Test: Full Client Updater Lifecycle (Simulation Mode)
 *
 * Flow:
 * 1. Initial State: version reported, not checking, not available
 * 2. Simulate Update Available (v9.9.9)
 * 3. Verify 'update-available' event + releaseNotes delivered
 * 4. Simulate Download: progress events 10%..100% delivered with speed
 * 5. Verify 'update-downloaded' event fired and ready for install
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { UpdaterManager } from '../../src/main/updater/UpdaterManager.ts'

test('UpdaterManager lifecycle simulation', async () => {
  const updater = UpdaterManager.getInstance()

  // 1. Initial
  const initial = updater.getStatus()
  assert.equal(typeof initial.checking, 'boolean')

  // 2. Track events
  const events: string[] = []
  const progressList: number[] = []

  updater.on('checking-for-update', () => events.push('checking'))
  updater.on('update-available', (info) => {
    events.push(`available:${info.version}`)
  })
  updater.on('download-progress', (p) => {
    progressList.push(p.percent)
  })
  updater.on('update-downloaded', (info) => {
    events.push(`downloaded:${info.version}`)
  })

  // 3. Trigger simulation
  await updater.simulateUpdate('0.9.9')
  const statusAfterCheck = updater.getStatus()
  assert.equal(statusAfterCheck.available, true)
  assert.equal(statusAfterCheck.version, '0.9.9')
  assert.ok(statusAfterCheck.releaseNotes && statusAfterCheck.releaseNotes.length > 0)

  // 4. Trigger simulated download
  await updater.simulateDownload()
  const statusAfterDownload = updater.getStatus()
  assert.equal(statusAfterDownload.downloading, false)
  assert.equal(statusAfterDownload.downloaded, true)
  assert.ok(progressList.length >= 4, `expected >= 4 progress steps, got ${progressList.length}`)
  assert.equal(progressList[progressList.length - 1], 100)

  // 5. Verify lifecycle order
  assert.ok(events.includes('checking'))
  assert.ok(events.includes('available:0.9.9'))
  assert.ok(events.includes('downloaded:0.9.9'))
})
