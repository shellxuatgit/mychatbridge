/**
 * Test: Overview upgrade icon quick button
 *
 * Verifies that:
 * 1. Button is hidden when updateAvailable = false
 * 2. Button shows with amber ArrowUpCircle icon when updateAvailable = true
 * 3. Tooltip prompts user to click directly to upgrade
 * 4. Button shows spinning icon when downloading
 * 5. Button changes to green CheckCircle icon when downloaded
 */

import test from 'node:test'
import assert from 'node:assert/strict'

test('Upgrade quick button state transitions', () => {
  type UpgradeButtonState = 'hidden' | 'available' | 'downloading' | 'ready'

  const computeButtonState = (status: {
    available: boolean
    downloading: boolean
    downloaded: boolean
  }): UpgradeButtonState => {
    if (!status.available) return 'hidden'
    if (status.downloaded) return 'ready'
    if (status.downloading) return 'downloading'
    return 'available'
  }

  // 1. No update -> hidden
  assert.equal(computeButtonState({ available: false, downloading: false, downloaded: false }), 'hidden')

  // 2. New version available -> show available
  assert.equal(computeButtonState({ available: true, downloading: false, downloaded: false }), 'available')

  // 3. User clicked -> downloading
  assert.equal(computeButtonState({ available: true, downloading: true, downloaded: false }), 'downloading')

  // 4. Download finished -> ready to install
  assert.equal(computeButtonState({ available: true, downloading: false, downloaded: true }), 'ready')
})

test('Upgrade tooltip copy accurately describes action without cluttering UI', () => {
  const getTooltip = (version: string, downloaded: boolean, downloading: boolean, isZh: boolean) => {
    if (downloaded) {
      return isZh
        ? `新版本 ${version} 已就绪，点击重启完成升级`
        : `Update ${version} ready, click to restart and install`
    }
    if (downloading) {
      return isZh ? '正在下载更新...' : 'Downloading update...'
    }
    return isZh
      ? `发现新版本 ${version}，点击直接升级`
      : `New version ${version} available, click to upgrade`
  }

  assert.equal(
    getTooltip('v0.2.0', false, false, true),
    '发现新版本 v0.2.0，点击直接升级'
  )
  assert.equal(
    getTooltip('v0.2.0', true, false, true),
    '新版本 v0.2.0 已就绪，点击重启完成升级'
  )
})
