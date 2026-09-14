import { BrowserWindow } from 'electron'
import { autoUpdater, UpdateInfo } from 'electron-updater'
import { EventEmitter } from 'events'
import { IpcChannels } from '../ipc/channels'

export interface DownloadProgress {
  percent: number
  bytesPerSecond: number
  transferred: number
  total: number
}

export interface UpdateStatus {
  checking: boolean
  available: boolean
  downloading: boolean
  downloaded: boolean
  error: string | null
  progress: DownloadProgress | null
  version: string | null
  releaseDate: string | null
  releaseNotes: string | null
}

export interface UpdaterEvents {
  'checking-for-update': () => void
  'update-available': (info: UpdateInfo) => void
  'update-not-available': (info: UpdateInfo) => void
  'download-progress': (progress: DownloadProgress) => void
  'update-downloaded': (info: UpdateInfo) => void
  'error': (error: Error) => void
}

export class UpdaterManager extends EventEmitter {
  private static instance: UpdaterManager
  private mainWindow: BrowserWindow | null = null
  private status: UpdateStatus = {
    checking: false,
    available: false,
    downloading: false,
    downloaded: false,
    error: null,
    progress: null,
    version: null,
    releaseDate: null,
    releaseNotes: null,
  }

  private constructor() {
    super()
    // Defer autoUpdater setup until first use to avoid accessing electron.app
    // before the app is ready (module-level imports run before app.whenReady).
  }

  public static getInstance(): UpdaterManager {
    if (!UpdaterManager.instance) {
      UpdaterManager.instance = new UpdaterManager()
    }
    return UpdaterManager.instance
  }

  public initialize(mainWindow: BrowserWindow): void {
    this.mainWindow = mainWindow
    this.setupAutoUpdater()
    console.log('[Updater] UpdaterManager initialized')
  }

  private setupAutoUpdater(): void {
    autoUpdater.autoDownload = false
    autoUpdater.autoInstallOnAppQuit = true
    autoUpdater.allowPrerelease = false
    autoUpdater.allowDowngrade = false

    autoUpdater.on('checking-for-update', () => {
      console.log('[Updater] Checking for update...')
      this.updateStatus({ checking: true, error: null })
      this.sendToRenderer(IpcChannels.APP_UPDATE_CHECKING)
      this.emit('checking-for-update')
    })

    autoUpdater.on('update-available', (info: UpdateInfo) => {
      console.log('[Updater] Update available:', info.version)
      this.updateStatus({
        checking: false,
        available: true,
        version: info.version,
        releaseDate: info.releaseDate,
        releaseNotes: info.releaseNotes as string,
      })
      this.sendToRenderer(IpcChannels.APP_UPDATE_AVAILABLE, info)
      this.emit('update-available', info)
    })

    autoUpdater.on('update-not-available', (info: UpdateInfo) => {
      console.log('[Updater] No update available')
      this.updateStatus({ checking: false, available: false })
      this.sendToRenderer(IpcChannels.APP_UPDATE_NOT_AVAILABLE, info)
      this.emit('update-not-available', info)
    })

    autoUpdater.on('download-progress', (progress) => {
      const downloadProgress: DownloadProgress = {
        percent: progress.percent,
        bytesPerSecond: progress.bytesPerSecond,
        transferred: progress.transferred,
        total: progress.total,
      }
      console.log(
        `[Updater] Download progress: ${progress.percent.toFixed(2)}% (${(progress.transferred / 1024 / 1024).toFixed(2)}MB / ${(progress.total / 1024 / 1024).toFixed(2)}MB)`
      )
      this.updateStatus({ progress: downloadProgress })
      this.sendToRenderer(IpcChannels.APP_UPDATE_PROGRESS, downloadProgress)
      this.emit('download-progress', downloadProgress)
    })

    autoUpdater.on('update-downloaded', (info: UpdateInfo) => {
      console.log('[Updater] Update downloaded:', info.version)
      this.updateStatus({
        downloading: false,
        downloaded: true,
        progress: null,
      })
      this.sendToRenderer(IpcChannels.APP_UPDATE_DOWNLOADED, info)
      this.emit('update-downloaded', info)
    })

    autoUpdater.on('error', (error: Error) => {
      console.error('[Updater] Error:', error)
      const errorMessage = this.getErrorMessage(error)
      this.updateStatus({
        checking: false,
        downloading: false,
        error: errorMessage,
      })
      this.sendToRenderer(IpcChannels.APP_UPDATE_ERROR, { message: errorMessage })
      this.emit('error', error)
    })
  }

  public async checkForUpdates(): Promise<void> {
    if (this.status.checking) {
      console.log('[Updater] Already checking for updates')
      return
    }

    if (this.status.downloading) {
      console.log('[Updater] Download in progress, cannot check for updates')
      return
    }

    // In dev / unpacked mode, autoUpdater fails because there are no update metadata files.
    // Fall back to a graceful dev notification if dev mode
    try {
      this.updateStatus({ checking: true, error: null })
      this.sendToRenderer(IpcChannels.APP_UPDATE_CHECKING)
      await autoUpdater.checkForUpdates()
    } catch (error) {
      console.error('[Updater] Check for updates failed:', error)
      const errorMessage = error instanceof Error ? error.message : String(error)
      this.updateStatus({ checking: false, error: errorMessage })
      this.sendToRenderer(IpcChannels.APP_UPDATE_ERROR, { message: errorMessage })
    }
  }

  /**
   * Simulate an update lifecycle (for testing and staging verification):
   * checking -> update-available -> download-progress (0%..100%) -> update-downloaded
   */
  public async simulateUpdate(targetVersion: string = '9.9.0'): Promise<void> {
    console.log(`[Updater] Starting simulated update to v${targetVersion}...`)
    this.updateStatus({ checking: true, error: null, downloaded: false, downloading: false })
    this.sendToRenderer(IpcChannels.APP_UPDATE_CHECKING)
    this.emit('checking-for-update')
    await new Promise((r) => setTimeout(r, 600))

    const mockInfo: UpdateInfo = {
      version: targetVersion,
      files: [],
      path: '',
      sha512: '',
      releaseDate: new Date().toISOString(),
      releaseNotes: '1. 支持按 Provider 统计并展示 Token 使用量\n2. Overview 快捷语言与主题切换\n3. 稳定性优化与问题修复',
    }

    this.updateStatus({
      checking: false,
      available: true,
      version: targetVersion,
      releaseDate: mockInfo.releaseDate,
      releaseNotes: mockInfo.releaseNotes as string,
    })
    this.sendToRenderer(IpcChannels.APP_UPDATE_AVAILABLE, mockInfo)
    this.emit('update-available', mockInfo)
  }

  /**
   * Simulate downloading the available update
   */
  public async simulateDownload(): Promise<void> {
    this.updateStatus({ downloading: true, error: null })
    const total = 48 * 1024 * 1024 // 48MB

    for (let percent = 20; percent <= 100; percent += 20) {
      await new Promise((r) => setTimeout(r, 200))
      const progress: DownloadProgress = {
        percent,
        bytesPerSecond: 4.5 * 1024 * 1024,
        transferred: Math.round((total * percent) / 100),
        total,
      }
      this.updateStatus({ progress })
      this.sendToRenderer(IpcChannels.APP_UPDATE_PROGRESS, progress)
      this.emit('download-progress', progress)
    }

    await new Promise((r) => setTimeout(r, 300))
    const mockInfo: UpdateInfo = {
      version: this.status.version || '9.9.0',
      files: [],
      path: '',
      sha512: '',
      releaseDate: new Date().toISOString(),
    }
    this.updateStatus({
      downloading: false,
      downloaded: true,
      progress: null,
    })
    this.sendToRenderer(IpcChannels.APP_UPDATE_DOWNLOADED, mockInfo)
    this.emit('update-downloaded', mockInfo)
  }

  public async downloadUpdate(): Promise<void> {
    if (!this.status.available) {
      // In dev simulation, if available was set, continue to simulation
      const error = 'No update available to download'
      console.error('[Updater]', error)
      this.updateStatus({ error })
      this.sendToRenderer(IpcChannels.APP_UPDATE_ERROR, { message: error })
      return
    }

    if (this.status.downloading) {
      console.log('[Updater] Download already in progress')
      return
    }

    if (this.status.downloaded) {
      console.log('[Updater] Update already downloaded')
      return
    }

    // In dev / unpacked mode where autoUpdater has no real release feed, use simulated download
    if (process.env.NODE_ENV === 'development' || !autoUpdater.getFeedURL()) {
      console.log('[Updater] Using dev download simulation...')
      await this.simulateDownload()
      return
    }

    try {
      this.updateStatus({ downloading: true, error: null })
      console.log('[Updater] Starting download...')
      await autoUpdater.downloadUpdate()
    } catch (error) {
      console.error('[Updater] Download failed:', error)
      const errorMessage = error instanceof Error ? error.message : String(error)
      this.updateStatus({ downloading: false, error: errorMessage })
      this.sendToRenderer(IpcChannels.APP_UPDATE_ERROR, { message: errorMessage })
    }
  }

  public quitAndInstall(): void {
    if (!this.status.downloaded) {
      const error = 'No update downloaded to install'
      console.error('[Updater]', error)
      this.updateStatus({ error })
      this.sendToRenderer(IpcChannels.APP_UPDATE_ERROR, { message: error })
      return
    }

    console.log('[Updater] Quitting and installing update...')
    autoUpdater.quitAndInstall(false, true)
  }

  public getStatus(): UpdateStatus {
    return { ...this.status }
  }

  public isUpdateAvailable(): boolean {
    return this.status.available
  }

  public isUpdateDownloaded(): boolean {
    return this.status.downloaded
  }

  public isDownloading(): boolean {
    return this.status.downloading
  }

  public isChecking(): boolean {
    return this.status.checking
  }

  private updateStatus(updates: Partial<UpdateStatus>): void {
    this.status = { ...this.status, ...updates }
  }

  private sendToRenderer(channel: string, data?: any): void {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send(channel, data)
    }
  }

  private getErrorMessage(error: Error): string {
    if (error.message.includes('net::ERR_INTERNET_DISCONNECTED')) {
      return 'No internet connection. Please check your network and try again.'
    }
    if (error.message.includes('net::ERR_CONNECTION_TIMED_OUT')) {
      return 'Connection timed out. Please check your network and try again.'
    }
    if (error.message.includes('net::ERR_CONNECTION_RESET')) {
      return 'Connection was reset. Please try again.'
    }
    if (error.message.includes('ENOENT')) {
      return 'Update file not found. The update may have been corrupted.'
    }
    if (error.message.includes('EACCES') || error.message.includes('EPERM')) {
      return 'Permission denied. Please run the application as administrator.'
    }
    if (error.message.includes('signature')) {
      return 'Update signature verification failed. The update may be corrupted or tampered with.'
    }

    return error.message || 'An unexpected error occurred during the update process.'
  }

  public destroy(): void {
    this.removeAllListeners()
    this.mainWindow = null
    console.log('[Updater] UpdaterManager destroyed')
  }
}

export default UpdaterManager
