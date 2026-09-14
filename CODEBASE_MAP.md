# CODEBASE MAP

## 1. Project

```text
Name: MyChatBridge
Purpose: Electron desktop application that manages multiple AI providers and exposes an OpenAI-compatible local proxy.
Language: TypeScript, TSX, JavaScript
Framework: Electron 33, React 18, Koa
Runtime: Electron main process, Chromium renderer, Node.js web-runtime sidecar
Package Manager: npm
Build System: electron-vite, TypeScript, electron-builder
```

## 2. Directory Structure

```text
src/
├── main/                 Electron main process, IPC, storage, OAuth, proxy, providers
│   ├── ipc/              IPC channel constants and main-process handlers
│   ├── oauth/            OAuth adapters and login orchestration
│   ├── providers/        Built-in and custom provider configuration
│   ├── proxy/            Koa OpenAI-compatible proxy and provider forwarding
│   ├── store/            Persistent configuration, providers, accounts, sessions, logs
│   ├── webRuntime/       Browser import, localStorage parsing, sidecar integration
│   ├── window/           Main BrowserWindow lifecycle and loading
│   ├── tray/             System tray integration
│   └── updater/          Application update lifecycle
├── preload/              contextBridge APIs exposed to the renderer
├── renderer/src/         React application, pages, components, Zustand stores
├── shared/               Types and tool-calling contracts shared across processes
├── web-runtime/          Standalone Playwright browser sidecar
└── types/                TypeScript declarations
scripts/                  Build and packaging helper scripts
tests/                    Node test suites organized by module
build/                    Packaging resources and icons
```

## 3. Modules

```text
Module: Electron application bootstrap
Path: src/main/index.ts, src/main/window/
Purpose: Creates the main window, initializes IPC/storage, loads the renderer, and manages app lifecycle.
Depends on: Electron, StoreManager, IPC handlers, TrayManager, UpdaterManager
Used by: Electron entry point

Module: IPC bridge
Path: src/main/ipc/, src/preload/index.ts
Purpose: Defines and implements renderer-to-main process operations.
Depends on: store, proxy, OAuth, webRuntime, updater, Electron
Used by: renderer pages, components, and stores

Module: Persistent storage
Path: src/main/store/
Purpose: Stores app configuration, providers, accounts, sessions, prompts, statistics, and logs.
Depends on: electron-store, Electron safeStorage, migration and log managers
Used by: IPC handlers, proxy, OAuth, provider/account managers, session manager

Module: Provider registry and adapters
Path: src/main/providers/, src/main/proxy/adapters/, src/main/oauth/adapters/
Purpose: Defines built-in providers and implements provider-specific authentication and request handling.
Depends on: shared types, axios, provider configuration
Used by: proxy forwarder, OAuth manager, provider IPC handlers

Module: OpenAI-compatible proxy
Path: src/main/proxy/
Purpose: Serves chat, completion, model, multi-request, and management HTTP routes.
Depends on: Koa, routers, StoreManager, load balancer, model mapper, provider adapters
Used by: proxy IPC handlers and external OpenAI-compatible clients

Module: Web account runtime
Path: src/main/webRuntime/, src/web-runtime/
Purpose: Imports browser cookies/localStorage and runs managed Playwright browser sessions in a sidecar.
Depends on: filesystem, SQLite, DPAPI/AES-GCM, Playwright, sidecar IPC protocol
Used by: web-provider UI flows and web-runtime IPC handlers

Module: Renderer UI
Path: src/renderer/src/
Purpose: Provides dashboard, provider/account management, proxy settings, logs, models, sessions, settings, and API-key UI.
Depends on: React, React Router, Zustand, Radix UI, preload APIs
Used by: Electron renderer window
```

## 4. Files

```text
File: src/main/index.ts
Purpose: Electron startup, single-instance handling, window creation, storage/IPC initialization, renderer loading.
Exports: restartApp, getAppVersion, isAppQuitting, getMainWindow
Depends on: window manager, IPC handlers, store, tray, updater
Used by: Electron main entry

File: src/main/ipc/channels.ts
Purpose: Canonical IPC channel names.
Exports: IpcChannels, IpcChannel
Depends on: None
Used by: main IPC handlers and preload

File: src/main/ipc/handlers.ts
Purpose: Registers proxy, config, store, provider, account, OAuth, logging, session, updater, and web-runtime IPC handlers.
Exports: registerIpcHandlers
Depends on: all major main-process services
Used by: src/main/index.ts

File: src/preload/index.ts
Purpose: Exposes typed renderer APIs through contextBridge and ipcRenderer.invoke.
Exports: contextBridge APIs including proxyAPI, storeAPI, providersAPI, accountsAPI, OAuth and web-runtime APIs
Depends on: Electron IPC, IpcChannels, shared types
Used by: renderer code through window.electronAPI

File: src/shared/types.ts
Purpose: Shared provider, account, config, API-key, OAuth, session, log, and proxy status types.
Exports: Account, Provider, AppConfig, ApiKey, OAuthResult, SessionConfig, ProxyStatus and related types
Depends on: src/shared/toolCalling.ts
Used by: main, preload, renderer

File: src/main/store/store.ts
Purpose: StoreManager implementation, initialization, encryption, migration, defaults, and persistence operations.
Exports: storeManager and StoreManager-related API
Depends on: electron-store, safeStorage, store/types, log managers, migration
Used by: nearly all main modules

File: src/main/store/types.ts
Purpose: Persistent schema types and default configuration/provider data, including BUILTIN_PROVIDERS.
Exports: StoreSchema, defaults, BUILTIN_PROVIDERS and store-related types
Depends on: shared tool-calling types
Used by: StoreManager, provider management, configuration code

File: src/main/store/providers.ts
Purpose: Provider CRUD and provider filtering operations.
Exports: ProviderManager
Depends on: StoreManager, store types
Used by: IPC handlers and provider flows

File: src/main/store/accounts.ts
Purpose: Account CRUD, status, usage, validation, and credential operations.
Exports: AccountManager
Depends on: StoreManager and credential validator
Used by: IPC handlers, proxy routing, OAuth/web flows

File: src/main/providers/builtin/index.ts
Purpose: Registers the 15 built-in provider configurations.
Exports: builtinProviders, builtinProviderMap, getBuiltinProvider, getBuiltinProviders, individual configs
Depends on: provider config files under src/main/providers/builtin/
Used by: StoreManager and provider IPC handlers

File: src/main/proxy/server.ts
Purpose: Koa proxy server, CORS/body parsing, API-key authentication, quota middleware, route registration, lifecycle.
Exports: ProxyServer
Depends on: Koa, proxy routes, management routes, StoreManager, quota/status managers
Used by: src/main/ipc/handlers.ts

File: src/main/proxy/routes/chat.ts
Purpose: POST /v1/chat/completions validation, routing, fallback, streaming, and response conversion.
Exports: default chat router
Depends on: load balancer, RequestForwarder, model mapper, sessions, tool-format utilities
Used by: ProxyServer

File: src/main/proxy/forwarder.ts
Purpose: Selects provider-specific forwarder and sends requests through provider adapters.
Exports: RequestForwarder
Depends on: axios, provider adapters, stream handlers, sessions, tool-calling and context services
Used by: proxy routes

File: src/main/proxy/routes/management/index.ts
Purpose: Aggregates management routers.
Exports: management router modules and default router list
Depends on: management config/providers/accounts/API keys/model mappings/sessions/statistics/proxy/tool-calling routers
Used by: ProxyServer

File: src/main/webRuntime/autoConnect.ts
Purpose: Implements browser-session detection, L1 import, L2 browser opening, and polling result handling.
Exports: handleAutoConnect, handleCheckSession and related result/dependency types
Depends on: CookieImporter and credentialSources
Used by: web-runtime IPC handlers and renderer ConnectDialog

File: src/main/webRuntime/credentialSources.ts
Purpose: Maps chatgpt-web, doubao-web, and deepseek to cookie/localStorage credential sources.
Exports: CREDENTIAL_SOURCES, getCredentialSource, DEEPSEEK_ORIGIN
Depends on: None
Used by: autoConnect, CookieImporter, localStorage reader

File: src/main/webRuntime/cookieImporter.ts
Purpose: Reads Chrome/Edge Cookies SQLite databases, decrypts values, filters valid provider cookies, and imports sessions.
Exports: CookieImporter, ImportedSession
Depends on: better-sqlite3, Windows DPAPI, AES-GCM, credentialSources
Used by: autoConnect and webRuntimeHandlers

File: src/main/webRuntime/localStorageReader.ts
Purpose: Copies browser LevelDB files and parses .log/.ldb records to locate a localStorage token.
Exports: LocalStorageReader, LocalStorageReaderOptions
Depends on: leveldbLog, leveldbSst, chromeLocalStorage, filesystem
Used by: IPC auto-connect handlers

File: src/main/webRuntime/leveldbLog.ts
Purpose: Parses Chrome LevelDB WAL records and returns live key/value entries.
Exports: LogEntry, parseLogEntries
Depends on: snappy getVarint
Used by: LocalStorageReader and web-runtime tests

File: src/main/webRuntime/leveldbSst.ts
Purpose: Parses LevelDB SST files for compacted localStorage entries.
Exports: parseSstEntries
Depends on: snappy and leveldb log entry type
Used by: LocalStorageReader

File: src/main/webRuntime/chromeLocalStorage.ts
Purpose: Decodes Chrome localStorage typed key/value bytes and finds a requested origin/script value.
Exports: ScriptEntry, extractScriptValue
Depends on: leveldb log entry type
Used by: LocalStorageReader

File: src/main/webRuntime/webRuntimeHandlers.ts
Purpose: Main-process handlers for managed sidecar connect, browser import, and health operations.
Exports: handleConnect, handleImportBrowser, handleHealth
Depends on: WebRuntimeManager, CookieImporter, sidecar Methods
Used by: src/main/ipc/handlers.ts

File: src/main/webRuntime/manager.ts
Purpose: Lazily starts, health-checks, retries, and stops the web-runtime sidecar.
Exports: WebRuntimeManager
Depends on: child_process, WebRuntimeClient, sidecar protocol
Used by: webRuntimeHandlers

File: src/web-runtime/index.ts
Purpose: Sidecar entry point; initializes BrowserManager, SessionManager, ProviderRuntime, HealthMonitor, and IpcServer.
Exports: none
Depends on: Playwright sidecar modules and ipc-protocol
Used by: scripts/build-web-runtime.mjs and WebRuntimeManager

File: src/renderer/src/App.tsx
Purpose: Defines renderer routes and lazy-loaded pages.
Exports: App
Depends on: React Router, MainLayout, page components
Used by: renderer entry

File: src/renderer/src/stores/providersStore.ts
Purpose: Zustand state for providers, built-ins, accounts, statuses, and selections.
Exports: useProvidersStore
Depends on: Zustand and renderer Electron types
Used by: provider pages/components
```

## 5. Functions

```text
Function: initializeApp
File: src/main/index.ts
Signature: (): Promise<void>
Purpose: Registers Electron lifecycle listeners.
Calls: setupApp
Called by: module bootstrap
Side effects: Registers app event handlers.

Function: setupApp
File: src/main/index.ts
Signature: (): Promise<void>
Purpose: Creates the main window and initializes IPC, tray, and renderer content.
Calls: createWindow, registerIpcHandlers, createTrayManager, loadAppContent
Called by: initializeApp
Side effects: Creates window, initializes storage/services.

Function: registerIpcHandlers
File: src/main/ipc/handlers.ts
Signature: (mainWindow: BrowserWindow | null): Promise<void>
Purpose: Registers all Electron IPC handlers and optionally auto-starts the proxy.
Calls: StoreManager, ProxyServer, OAuthManager, web-runtime handlers
Called by: setupApp
Side effects: Registers global IPC handlers and may start the local proxy.

Function: initialize
File: src/main/store/store.ts
Signature: (): Promise<void>
Purpose: Opens encrypted persistent storage, migrates legacy data, initializes managers/defaults.
Calls: ensureStorageMigrated, initializeDefaultProviders, initializeDefaultModelMappings
Called by: registerIpcHandlers
Side effects: Reads/writes ~/.mychatbridge storage.

Function: initializeDefaultProviders
File: src/main/store/store.ts
Signature: (): Promise<void>
Purpose: Synchronizes built-in provider defaults and backfills missing built-ins.
Calls: StoreManager persistence methods
Called by: initialize
Side effects: Updates persistent provider configuration.

Function: start
File: src/main/proxy/server.ts
Signature: (port?: number, host?: string): Promise<boolean>
Purpose: Starts the Koa HTTP server.
Calls: Node HTTP server listen
Called by: proxy IPC handlers
Side effects: Binds a local TCP port and updates proxy status.

Function: stop
File: src/main/proxy/server.ts
Signature: (): Promise<boolean>
Purpose: Stops the Koa HTTP server.
Calls: Node HTTP server close
Called by: proxy IPC handlers
Side effects: Releases the listening port.

Function: handleChatCompletion
File: src/main/proxy/routes/chat.ts
Signature: UNKNOWN (router callback for POST /v1/chat/completions)
Purpose: Validates and routes chat-completion requests.
Calls: loadBalancer, modelMapper, RequestForwarder, session and fallback services
Called by: Koa router
Side effects: Provider requests, statistics/log/session updates.

Function: forward
File: src/main/proxy/forwarder.ts
Signature: UNKNOWN (RequestForwarder provider dispatch method)
Purpose: Selects a matching provider forwarder and executes it.
Calls: provider-specific forward methods and adapters
Called by: chat/completions and related proxy routes
Side effects: External provider HTTP requests and logs/statistics.

Function: handleAutoConnect
File: src/main/webRuntime/autoConnect.ts
Signature: (providerId: string, deps: AutoConnectDeps): Promise<AutoConnectResult>
Purpose: Attempts existing browser credential import, otherwise opens the provider login URL.
Calls: findCookieSession or findTokenSession, deps.opener
Called by: webRuntime:autoConnect IPC handler
Side effects: Reads browser data or opens an external URL.

Function: handleCheckSession
File: src/main/webRuntime/autoConnect.ts
Signature: (providerId: string, deps: AutoConnectDeps): Promise<CheckSessionResult>
Purpose: Polls browser data for an imported session.
Calls: findCookieSession or findTokenSession
Called by: webRuntime:checkSession IPC handler
Side effects: Reads browser cookie/localStorage files.

Function: parseLogEntries
File: src/main/webRuntime/leveldbLog.ts
Signature: (buf: Buffer): LogEntry[]
Purpose: Parses LevelDB WAL records, fragments, and live internal keys.
Calls: getVarint, parseRecordPayload
Called by: LocalStorageReader
Side effects: None.

Function: parseSstEntries
File: src/main/webRuntime/leveldbSst.ts
Signature: (buf: Buffer): LogEntry[]
Purpose: Parses compacted LevelDB SST key/value records.
Calls: block-handle, block, and Snappy parsing helpers
Called by: LocalStorageReader
Side effects: None.

Function: extractScriptValue
File: src/main/webRuntime/chromeLocalStorage.ts
Signature: (entries: ScriptEntry[], origin: string, scriptKey: string): string | null
Purpose: Locates and decodes a typed Chrome localStorage entry.
Calls: internal decodeValue
Called by: LocalStorageReader
Side effects: None.

Function: findToken
File: src/main/webRuntime/localStorageReader.ts
Signature: (browser: BrowserName, tokenKey: string, originPart: string): Promise<string | null>
Purpose: Copies browser LevelDB files, parses WAL/SST entries, and returns a token.
Calls: parseLogEntries, parseSstEntries, extractScriptValue
Called by: autoConnect dependency in IPC handlers
Side effects: Creates and removes a temporary directory.

Function: invoke
File: src/web-runtime/provider-runtime.ts
Signature: UNKNOWN
Purpose: Executes provider browser actions in the sidecar.
Calls: provider runtime implementations and BrowserManager
Called by: src/web-runtime/index.ts IPC registration
Side effects: Browser navigation/session changes.
```

## 6. Classes / Interfaces / Types

```text
Name: StoreManager
File: src/main/store/store.ts
Kind: class
Purpose: Persistent encrypted application storage and data access.
Key methods: initialize, getConfig, updateConfig, getProviders, getAccounts, add/update/delete operations, flushPendingWrites
Used by: most main-process modules.

Name: ProxyServer
File: src/main/proxy/server.ts
Kind: class
Purpose: Koa HTTP proxy lifecycle and route host.
Key methods: start, stop, getStatus, getStatistics
Used by: IPC handlers.

Name: RequestForwarder
File: src/main/proxy/forwarder.ts
Kind: class
Purpose: Provider matching and request forwarding.
Key methods: provider-specific forward methods and dispatch logic
Used by: proxy routes.

Name: SessionManagerClass
File: src/main/proxy/sessionManager.ts
Kind: class
Purpose: Conversation session creation, reuse, cleanup, and persistence.
Key methods: initialize, destroy, getOrCreateSession, getActiveSession, createSession
Used by: proxy routes, adapters, IPC handlers.

Name: ProviderManager
File: src/main/store/providers.ts
Kind: class with static methods
Purpose: Provider CRUD and filtering facade.
Key methods: getAll, getById, create, update, delete, getEnabled
Used by: IPC handlers and renderer provider flows.

Name: AccountManager
File: src/main/store/accounts.ts
Kind: class with static methods
Purpose: Account CRUD, status, validation, and usage facade.
Key methods: getAll, getById, getByProviderId, create, update, delete, updateStatus
Used by: IPC handlers and proxy/OAuth flows.

Name: OAuthManager
File: src/main/oauth/manager.ts
Kind: class extends EventEmitter
Purpose: Coordinates provider login, cancellation, callbacks, progress, and in-app login.
Key methods: startLogin, cancelLogin, validateToken, refreshToken, startInAppLogin
Used by: OAuth IPC handlers and renderer OAuth UI.

Name: CookieImporter
File: src/main/webRuntime/cookieImporter.ts
Kind: class
Purpose: Imports and decrypts Chrome/Edge provider cookies.
Key methods: browserPaths, readDecryptionKey, scan, importSession
Used by: autoConnect and browser-import handlers.

Name: LocalStorageReader
File: src/main/webRuntime/localStorageReader.ts
Kind: class
Purpose: Reads Chrome/Edge localStorage LevelDB files.
Key methods: findToken
Used by: DeepSeek auto-connect.

Name: WebRuntimeManager
File: src/main/webRuntime/manager.ts
Kind: class
Purpose: Controls the standalone Playwright sidecar process.
Key methods: getInstance, ensureStarted, stop, ensureBrowser
Used by: webRuntimeHandlers.

Name: Provider / Account / AppConfig / ApiKey
File: src/shared/types.ts
Kind: interfaces
Purpose: Shared public data contracts across main, preload, and renderer.
Key methods: N/A
Used by: IPC, storage, proxy, and UI.

Name: CredentialSourceConfig / AutoConnectDeps / SessionPayload
File: src/main/webRuntime/credentialSources.ts and autoConnect.ts
Kind: interfaces
Purpose: Web credential import and auto-connect contracts.
Key methods: N/A
Used by: web-runtime handlers and tests.
```

## 7. APIs / Entry Points

```text
API / Entry Point: Electron main process
File: src/main/index.ts
Handler: initializeApp → setupApp
Request: Electron app lifecycle
Response: Main BrowserWindow, IPC handlers, tray, proxy lifecycle
Calls: StoreManager, registerIpcHandlers, TrayManager, renderer loading

API / Entry Point: Renderer IPC API
File: src/preload/index.ts
Handler: contextBridge-exposed methods invoking IpcChannels
Request: Typed renderer method arguments
Response: Promises and event callbacks
Calls: ipcRenderer.invoke/on

API / Entry Point: OpenAI-compatible proxy
File: src/main/proxy/server.ts and src/main/proxy/routes/
Handler: Koa routes
Request: HTTP requests, primarily POST /v1/chat/completions and GET /v1/models
Response: OpenAI-compatible JSON/SSE responses
Calls: authentication middleware, quota middleware, routing, model mapping, provider adapters

API / Entry Point: Proxy management API
File: src/main/proxy/routes/management/
Handler: Routers under /v0/management
Request: Management HTTP requests authenticated by management middleware/secret
Response: Provider, account, config, model mapping, session, statistics, proxy, and tool-calling data
Calls: StoreManager and proxy services

API / Entry Point: Web-runtime IPC
File: src/main/ipc/handlers.ts and src/main/webRuntime/webRuntimeHandlers.ts
Handler: webRuntime:connect, webRuntime:importBrowser, webRuntime:autoConnect, webRuntime:checkSession, webRuntime:health
Request: Provider/account/browser parameters
Response: Connect/import/health results or auto-connect status payloads
Calls: WebRuntimeManager, CookieImporter, LocalStorageReader, autoConnect

API / Entry Point: Web-runtime sidecar stdin/fd3 IPC
File: src/web-runtime/index.ts, src/web-runtime/ipc-server.ts
Handler: Methods.BROWSER_INVOKE, BROWSER_HEALTH, SESSION_SAVE, SESSION_RESTORE, PROVIDER_LOAD, PROVIDER_RELOAD
Request: Sidecar protocol messages
Response: Sidecar protocol responses
Calls: BrowserManager, ProviderRuntime, SessionManager, HealthMonitor
```

## 8. Dependencies

```text
src/main/index.ts → src/main/ipc/handlers.ts → StoreManager / ProxyServer / OAuthManager / WebRuntime handlers
src/preload/index.ts → src/main/ipc/channels.ts → src/main/ipc/handlers.ts
ProxyServer → proxy routes → RequestForwarder → provider adapters → axios/provider APIs
ProxyServer → StoreManager → providers/accounts/configuration
chat route → modelMapper → loadBalancer/fallback graph → RequestForwarder
RequestForwarder → SessionManager → StoreManager
OAuthManager → OAuth adapters → provider APIs → AccountManager/StoreManager
webRuntime:autoConnect → autoConnect.ts → CookieImporter or LocalStorageReader
LocalStorageReader → leveldbLog.ts + leveldbSst.ts → chromeLocalStorage.ts
webRuntimeHandlers → WebRuntimeManager → WebRuntimeClient → src/web-runtime/index.ts sidecar
src/web-runtime/index.ts → BrowserManager / ProviderRuntime / SessionManager / IpcServer
Renderer pages/components → preload window APIs → IPC handlers → main services
StoreManager → BUILTIN_PROVIDERS and default configuration → ProviderManager/renderer provider state
```

## 9. Feature Routing

```text
OpenAI chat completion
→ ProxyServer
→ src/main/proxy/routes/chat.ts
→ POST /v1/chat/completions router callback
→ modelMapper + load balancer + fallback graph + RequestForwarder
→ provider adapter and stream handler
→ tests/providers, tests/core, tests/e2e-gateway-stack.test.ts

Provider/account management
→ renderer Providers page and provider components
→ preload providersAPI/accountsAPI
→ src/main/ipc/handlers.ts
→ ProviderManager / AccountManager
→ StoreManager
→ tests/providers and tests/store

Provider-specific request forwarding
→ src/main/proxy/forwarder.ts
→ providerForwarders matching provider adapters
→ src/main/proxy/adapters/<provider>.ts and stream handlers
→ provider API
→ tests/providers/provider-flow.test.ts and provider-specific tests

OAuth/token login
→ renderer OAuth components
→ preload OAuth API
→ src/main/ipc/handlers.ts
→ OAuthManager
→ src/main/oauth/adapters/index.ts and provider adapters
→ AccountManager / StoreManager
→ tests/updater or provider/OAuth-related suites where applicable

Cookie browser import
→ provider UI browser-import flow
→ webRuntime:importBrowser IPC
→ webRuntimeHandlers.handleImportBrowser
→ CookieImporter.scan/importSession
→ Chrome/Edge Cookies SQLite database and decryption
→ tests/web-runtime/cookie-importer.test.ts

Web auto-connect
→ ConnectDialog/provider web flow
→ webRuntime:autoConnect and webRuntime:checkSession IPC
→ autoConnect.handleAutoConnect/handleCheckSession
→ CookieImporter for cookie providers or LocalStorageReader for DeepSeek
→ account payload persistence in renderer/main flow
→ tests/web-runtime/auto-connect.test.ts, credential-sources.test.ts, local-storage-reader.test.ts

DeepSeek localStorage token extraction
→ LocalStorageReader.findToken
→ copy browser Local Storage/leveldb files
→ parseLogEntries and parseSstEntries
→ extractScriptValue(origin, userToken)
→ DeepSeek account token payload
→ tests/web-runtime/leveldb-log.test.ts, chrome-local-storage.test.ts, local-storage-reader.test.ts

Managed browser session
→ webRuntime:connect IPC
→ webRuntimeHandlers.handleConnect
→ WebRuntimeManager.ensureBrowser/ensureStarted
→ sidecar Methods.BROWSER_INVOKE and SESSION_SAVE
→ BrowserManager + ProviderRuntime + SessionManager
→ tests/web-runtime/manager.test.ts, provider-runtime-connect.test.ts, e2e-sidecar.test.ts

Renderer navigation and home UI
→ src/renderer/src/App.tsx routes
→ MainLayout/Header/Sidebar
→ page components and Zustand stores
→ preload APIs
→ tests/renderer/*.test.ts and *.test.mjs
```

## 10. Change Impact

```text
File: src/shared/types.ts
Impact: Shared data contracts for providers, accounts, configuration, OAuth, sessions, and proxy status.
Affected files: src/main/, src/preload/index.ts, src/renderer/src/
Affected functions: Most IPC handlers and store/provider/account methods
Risk: HIGH
Reason: Type changes cross process boundaries and UI/API contracts.

File: src/main/ipc/channels.ts
Impact: IPC protocol names.
Affected files: src/main/ipc/handlers.ts, src/preload/index.ts, renderer consumers
Affected functions: All corresponding invoke/event handlers
Risk: HIGH
Reason: A channel mismatch breaks renderer-main communication.

File: src/main/store/types.ts
Impact: Persistent schema and built-in defaults.
Affected files: store.ts, providers.ts, renderer provider state, migrations
Affected functions: StoreManager.initialize and default synchronization
Risk: HIGH
Reason: Changes affect persisted data, startup defaults, and provider availability.

File: src/main/store/store.ts
Impact: Central persistence and encryption service.
Affected files: provider/account/session/log/config modules and IPC handlers
Affected functions: initialize, default initialization, CRUD and flush operations
Risk: HIGH
Reason: Nearly every main-process feature depends on it.

File: src/main/proxy/forwarder.ts
Impact: Provider dispatch and external AI requests.
Affected files: all proxy adapters, routes, session/context/tool-calling services
Affected functions: RequestForwarder dispatch and provider forward methods
Risk: HIGH
Reason: Changes can affect all providers and authentication/request formats.

File: src/main/proxy/server.ts and src/main/proxy/routes/
Impact: HTTP API behavior, middleware, authentication, and route contracts.
Affected files: proxy clients, management clients, forwarder, tests
Affected functions: ProxyServer lifecycle and route callbacks
Risk: HIGH
Reason: Public local HTTP interfaces and streaming behavior.

File: src/main/webRuntime/autoConnect.ts
Impact: Browser credential discovery and web-provider login flow.
Affected files: web provider UI, IPC handlers, CookieImporter, LocalStorageReader
Affected functions: handleAutoConnect, handleCheckSession
Risk: MEDIUM
Reason: Provider-specific credential source assumptions and user-facing flow.

File: src/main/webRuntime/leveldbLog.ts, leveldbSst.ts, chromeLocalStorage.ts
Impact: Browser localStorage token extraction.
Affected files: LocalStorageReader, DeepSeek auto-connect tests
Affected functions: parseLogEntries, parseSstEntries, extractScriptValue, findToken
Risk: HIGH
Reason: Binary file formats and sensitive credential extraction are fragile.

File: src/main/providers/builtin/ and BUILTIN_PROVIDERS
Impact: Built-in provider identity, models, endpoints, auth types, and defaults.
Affected files: provider adapters, StoreManager, UI model/provider lists
Affected functions: provider matching, default synchronization, routing
Risk: HIGH
Reason: Configurations are consumed in multiple layers and must remain synchronized.

File: src/preload/index.ts
Impact: Renderer-facing API surface.
Affected files: all renderer pages/components/stores and IPC handlers
Affected functions: every exposed API method
Risk: HIGH
Reason: It is the process boundary and public renderer contract.
```

## 11. Configuration

```text
Config File: package.json
Environment Variables: NODE_ENV, ELECTRON_RENDERER_URL, LOCALAPPDATA, WEBLLM_DEV_ENTRY; platform-specific environment variables may be used by Electron/Node.
Important Options: proxyPort, proxyHost, autoStartProxy, API-key enablement, loadBalanceStrategy, modelMappings, sessionConfig, toolCallingConfig, managementApi, language.
Defaults: DEFAULT_CONFIG and related constants in src/main/store/types.ts; proxy server fallback host 127.0.0.1 and port 8080.
Persistent Storage: ~/.mychatbridge/; legacy ~/.chat2api/ is migrated by src/main/store/migrate.ts.
Renderer Dev Server: 0.0.0.0:5173 in electron.vite.config.ts.
OAuth Callback Port: 8311 default in src/main/oauth/manager.ts.
Credentials: Stored through StoreManager encryption; no credentials are documented here.
External Services: AI provider APIs and optional Playwright browser installation; exact runtime availability depends on provider configuration.
Database Setup: No application database migration command identified; browser cookie SQLite databases are read from Chrome/Edge profiles.
Seed Data: Built-in providers, prompts, model mappings, and default configuration are defined in src/main/store/types.ts and src/main/data/builtin-prompts.ts.
```

## 12. How to Start

### Install

```bash
npm install
```

`postinstall` runs `electron-builder install-app-deps`.

### Development

```bash
npm run dev:win
```

```bash
npm run dev
```

`dev:win` runs `electron-vite dev`; `dev` runs `scripts/dev.sh` and is intended for the development environment supported by that script.

### Production

```bash
npm run build
npm run preview
```

For packaged installers:

```bash
npm run build:win
npm run build:mac
npm run build:linux
```

Required runtime/version: package configuration specifies Electron `^33.0.2`; TypeScript target is ES2020. A compatible Node.js/npm installation is required. Exact minimum Node.js version: UNKNOWN.
Required environment variables: None explicitly required by package scripts for normal startup. `LOCALAPPDATA` is required for Windows Chrome/Edge browser import discovery; `ELECTRON_RENDERER_URL` is used for development loading when set.
Required external services: Provider APIs for live proxy requests. Exact required services depend on enabled providers.
Ports: renderer dev server 5173; proxy default 8080; OAuth callback default 8311; configurable proxy and management ports.
Database setup/migrations: No manual setup or migration command identified. Store migration runs during initialization.

## 13. How to Test

The repository has no `test` script in `package.json`. Tests use Node's built-in test runner and `tsx` for TypeScript files.

### Unit Tests

```bash
node --import tsx --test tests/web-runtime/snappy.test.ts
node --import tsx --test tests/web-runtime/leveldb-log.test.ts
node --import tsx --test tests/web-runtime/local-storage-reader.test.ts
node --import tsx --test tests/core/*.test.ts
```

These commands verify focused binary parsers, browser import logic, routing primitives, and core services. The `*.test.ts` glob is supported by the shell/environment only when expanded correctly; run individual files if glob expansion is unavailable.

### Integration Tests

```bash
node --import tsx --test tests/web-runtime/*.test.ts
node --import tsx --test tests/providers/*.test.ts
node --import tsx --test tests/store/*.test.ts
node --import tsx --test tests/tool-calling/*.test.ts
```

These cover web-runtime, provider, persistent-store, and tool-calling integration boundaries. Exact cross-platform glob behavior may require enumerating files.

### E2E Tests

```bash
node --import tsx --test tests/e2e-gateway-stack.test.ts
node --import tsx --test tests/web-runtime/e2e-sidecar.test.ts
```

These exercise the gateway stack and sidecar behavior. Browser/network availability may be required by individual cases.

### Type Check

```bash
npx tsc -p tsconfig.json --noEmit
npx tsc -p tsconfig.node.json --noEmit
```

These commands check renderer/shared and main/preload/sidecar-adjacent TypeScript projects. No dedicated `typecheck` npm script is defined.

### Lint

```text
UNKNOWN: No lint script or lint configuration was identified in package.json or the inspected repository files.
```

### Build

```bash
npm run build
```

This runs source-artifact validation, compiles the web-runtime sidecar, and builds main/preload/renderer bundles with electron-vite.

## 14. Test Map

```text
Module: Core proxy routing and runtime primitives
Implementation: src/main/proxy/core/, src/main/proxy/sessionManager.ts, src/main/proxy/loadbalancer.ts
Unit Tests: tests/core/*.test.ts
Integration Tests: tests/e2e-gateway-stack.test.ts
E2E Tests: tests/e2e-gateway-stack.test.ts

Module: Provider adapters
Implementation: src/main/proxy/adapters/, src/main/providers/builtin/, src/main/oauth/adapters/
Unit Tests: tests/providers/*.test.ts
Integration Tests: tests/providers/provider-flow.test.ts
E2E Tests: UNKNOWN

Module: Store and persistence
Implementation: src/main/store/
Unit Tests: tests/store/migrate.test.ts
Integration Tests: tests/store/migrate.test.ts and dependent proxy/provider suites
E2E Tests: UNKNOWN

Module: Web-runtime browser/session sidecar
Implementation: src/main/webRuntime/, src/web-runtime/
Unit Tests: tests/web-runtime/manager.test.ts, client.test.ts, ipc-protocol.test.ts, reliability.test.ts
Integration Tests: tests/web-runtime/provider-runtime-connect.test.ts, web-bridge-adapter.test.ts
E2E Tests: tests/web-runtime/e2e-sidecar.test.ts

Module: Browser cookie import
Implementation: src/main/webRuntime/cookieImporter.ts
Unit Tests: tests/web-runtime/cookie-importer.test.ts
Integration Tests: tests/web-runtime/builtin-web-providers.test.ts
E2E Tests: UNKNOWN

Module: Chrome localStorage token parsing
Implementation: src/main/webRuntime/leveldbLog.ts, leveldbSst.ts, chromeLocalStorage.ts, localStorageReader.ts
Unit Tests: tests/web-runtime/snappy.test.ts, leveldb-log.test.ts, chrome-local-storage.test.ts, local-storage-reader.test.ts
Integration Tests: tests/web-runtime/auto-connect.test.ts
E2E Tests: UNKNOWN

Module: Renderer UI
Implementation: src/renderer/src/pages/, components/, stores/
Unit Tests: tests/renderer/*.test.ts and tests/renderer/*.test.mjs
Integration Tests: tests/renderer/web-provider-flow.test.ts
E2E Tests: UNKNOWN

Module: Tool calling
Implementation: src/main/proxy/toolCalling/, src/shared/toolCalling.ts
Unit Tests: tests/tool-calling/*.test.ts
Integration Tests: tests/skills/mychatbridge-tool-client-replay.test.mjs
E2E Tests: UNKNOWN
```

## 15. Modification Guide

```text
Before modifying:
1. Identify the feature and follow its Feature Routing entry.
2. Inspect the implementation file and exact functions/classes involved.
3. Inspect callers, preload/IPC contracts, shared types, and provider configuration consumers.
4. Check related tests under tests/ using the same module path.
5. For provider changes, inspect both the provider config and src/main/store/types.ts defaults.
6. For IPC changes, update channels, main handlers, preload exposure, types, and renderer callers together.

After modifying:
1. Run the closest unit tests.
2. Run relevant integration or E2E tests.
3. Run TypeScript checks applicable to the changed process.
4. Run npm run build when build/package paths or cross-process code changes.
5. Check API, IPC, shared-type, provider, and persistence compatibility.
6. Do not commit changes unless explicitly requested.
```

## 16. Critical Invariants

```text
- Renderer/main communication must use matching names from src/main/ipc/channels.ts and matching preload/main handler contracts.
- Shared interfaces in src/shared/types.ts are process-boundary contracts and must remain compatible across main, preload, and renderer.
- Built-in provider configuration is represented in provider config modules and the BUILTIN_PROVIDERS defaults in src/main/store/types.ts; keep both synchronized.
- Built-in provider core identity/configuration is restricted by ProviderManager.update.
- Persistent credentials must remain inside StoreManager's protected storage path; do not expose or log secrets.
- The proxy defaults to 127.0.0.1 and must preserve configured host/port behavior and API-key middleware semantics.
- Web-runtime sidecar methods must match src/web-runtime/ipc-protocol.ts registrations and WebRuntimeClient requests.
- Chrome localStorage parsing must remove LevelDB internal key suffixes, ignore deletion records, and decode Chrome typed values before matching origin/script keys.
- Browser profile files may be locked or partially written; browser import readers must tolerate missing, locked, corrupt, or truncated input without crashing the renderer.
- Provider-specific forwarding must preserve adapter matching, authentication formats, streaming/non-streaming response contracts, and session handling.
- Do not modify generated output, dependency caches, or packaged artifacts as source changes.
```