import path from "path"
import fs from "fs"
import { Context, PublicAPI, Query, WoxImage, ExecuteResultAction } from "@wox-launcher/wox-plugin"
import { plugin } from "../index"
import * as session from "../session"

describe("State Lifecycle & Invalidation", () => {
  let mockApi: PublicAPI
  let settingChangeHandler: ((ctx: Context, key: string, value: string) => void) | null = null
  const settingsStore: Record<string, string> = {}
  const sampleKdbxPath = path.resolve(__dirname, "../../tests/fixtures/sample-auth.kdbx")
  const sampleKeyxPath = path.resolve(__dirname, "../../tests/fixtures/sample-auth.keyx")
  const password = "9VA%9hfe2MzzaHQp"

  let tempKdbxPath: string

  beforeEach(() => {
    session.lock()
    settingChangeHandler = null
    for (const key of Object.keys(settingsStore)) {
      delete settingsStore[key]
    }

    // Create a temporary copy of sample-auth.kdbx for file modification tests
    tempKdbxPath = path.resolve(__dirname, `../../tests/fixtures/temp-${Date.now()}.kdbx`)
    fs.copyFileSync(sampleKdbxPath, tempKdbxPath)

    settingsStore["kdbxFilePath"] = tempKdbxPath
    settingsStore["keyFilePath"] = sampleKeyxPath
    settingsStore["autoLockTimeout"] = "60"
    settingsStore["excludeRules"] = ""

    mockApi = {
      Log: jest.fn().mockResolvedValue(undefined),
      GetSetting: jest.fn().mockImplementation(async (_ctx: Context, key: string) => {
        return settingsStore[key] || ""
      }),
      SaveSetting: jest.fn().mockResolvedValue(undefined),
      OnSettingChanged: jest.fn().mockImplementation(async (_ctx: Context, handler: (ctx: Context, key: string, value: string) => void) => {
        settingChangeHandler = handler
      }),
      ChangeQuery: jest.fn().mockResolvedValue(undefined),
      Notify: jest.fn().mockResolvedValue(undefined),
      ShowToolbarMsg: jest.fn().mockResolvedValue(undefined),
      ClearToolbarMsg: jest.fn().mockResolvedValue(undefined)
    } as unknown as PublicAPI
  })

  afterEach(() => {
    session.lock()
    if (fs.existsSync(tempKdbxPath)) {
      try {
        fs.unlinkSync(tempKdbxPath)
      } catch {
        // ignore
      }
    }
  })

  function createQuery(search = "", triggerKeyword: string | undefined = "kp"): Query {
    return {
      Id: "1",
      Env: { ActiveWindowTitle: "", ActiveWindowPid: 0, ActiveBrowserUrl: "", ActiveWindowIcon: {} as WoxImage },
      RawQuery: search ? `${triggerKeyword || "kp"} ${search}` : triggerKeyword || "kp",
      Selection: { Type: "text", Text: "", FilePaths: [] },
      Type: "input",
      Search: search,
      TriggerKeyword: triggerKeyword,
      Command: "",
      IsGlobalQuery(): boolean {
        return false
      }
    } as Query
  }

  async function unlockPlugin(ctx: Context) {
    await plugin.init(ctx, { PluginDirectory: "", API: mockApi })
    const response = await plugin.query(ctx, createQuery(password))
    const results = Array.isArray(response) ? response : response.Results
    const action = results[0].Actions?.[0] as ExecuteResultAction
    await action.Action(ctx, { ResultId: "1", ResultActionId: "unlock", ContextData: {} })
    expect(session.isUnlocked()).toBe(true)
  }

  test("querying 'lock' yields lock action item and only locks vault upon explicit Enter action", async () => {
    const ctx = {} as Context
    await unlockPlugin(ctx)

    // Run command 'keepass lock' with TriggerKeyword 'keepass'
    const lockResponse = await plugin.query(ctx, createQuery("lock", "keepass"))
    const lockResults = Array.isArray(lockResponse) ? lockResponse : lockResponse.Results

    // Should NOT automatically lock immediately
    expect(session.isUnlocked()).toBe(true)
    expect(lockResults[0].Title).toBe("🔒 锁定数据库")
    expect(lockResults[0].SubTitle).toBe("按 Enter 立即锁定 KeePass 数据库")
    expect(lockResults[0].Actions).toBeDefined()
    expect(lockResults[0].Actions!.length).toBeGreaterThan(0)

    const lockAction = lockResults[0].Actions![0] as ExecuteResultAction
    expect(lockAction.Name).toBe("锁定")

    // Explicit Enter triggers the lock action
    await lockAction.Action(ctx, { ResultId: "lock-action", ResultActionId: "lock", ContextData: {} })

    // Now it should be locked
    expect(session.isUnlocked()).toBe(false)
    expect(mockApi.ChangeQuery).toHaveBeenCalledWith(ctx, {
      QueryType: "input",
      QueryText: "keepass "
    })
    expect(mockApi.Notify).toHaveBeenCalledWith(ctx, "数据库已锁定")

    // Subsequent search is locked
    const nextResponse = await plugin.query(ctx, createQuery("游戏"))
    const nextResults = Array.isArray(nextResponse) ? nextResponse : nextResponse.Results
    expect(nextResults[0].Title).toBe("🔒 数据库已锁定")
  })

  test("inactivity triggers automatic cache purge after timeout", async () => {
    const ctx = {} as Context
    settingsStore["autoLockTimeout"] = "1" // 1 second timeout
    await unlockPlugin(ctx)

    expect(session.isUnlocked()).toBe(true)

    // Wait for timeout (1.2 seconds)
    await new Promise(resolve => setTimeout(resolve, 1200))

    expect(session.isUnlocked()).toBe(false)

    const response = await plugin.query(ctx, createQuery("游戏"))
    const results = Array.isArray(response) ? response : response.Results
    expect(results[0].Title).toBe("🔒 数据库已锁定")
  })

  test("activity refreshes auto-lock timeout duration", async () => {
    const ctx = {} as Context
    settingsStore["autoLockTimeout"] = "2" // 2 seconds timeout
    await unlockPlugin(ctx)

    // After 1 second, do a query to touch activity
    await new Promise(resolve => setTimeout(resolve, 1000))
    await plugin.query(ctx, createQuery("游戏"))
    expect(session.isUnlocked()).toBe(true)

    // Another 1 second passed (total 2s from unlock, but only 1s since last query)
    await new Promise(resolve => setTimeout(resolve, 1000))
    expect(session.isUnlocked()).toBe(true)

    // Wait for remaining 1.2s without activity -> now it should auto-lock
    await new Promise(resolve => setTimeout(resolve, 1200))
    expect(session.isUnlocked()).toBe(false)
  })

  test("external modifications to .kdbx file automatically invalidate cache", async () => {
    const ctx = {} as Context
    await unlockPlugin(ctx)

    expect(session.isUnlocked()).toBe(true)

    // Modify file mtime externally
    const futureTime = new Date(Date.now() + 5000)
    fs.utimesSync(tempKdbxPath, futureTime, futureTime)

    // Next query detects mtime change and invalidates
    const response = await plugin.query(ctx, createQuery("游戏"))
    const results = Array.isArray(response) ? response : response.Results

    expect(session.isUnlocked()).toBe(false)
    expect(results[0].Title).toBe("🔒 数据库已锁定")
  })

  test("file watcher triggers cache invalidation on file change event", async () => {
    const ctx = {} as Context
    await unlockPlugin(ctx)

    expect(session.isUnlocked()).toBe(true)

    // Wait 50ms then touch file
    await new Promise(resolve => setTimeout(resolve, 50))
    const futureTime = new Date(Date.now() + 10000)
    fs.utimesSync(tempKdbxPath, futureTime, futureTime)

    // Wait for fs.watch event to trigger
    await new Promise(resolve => setTimeout(resolve, 300))

    expect(session.isUnlocked()).toBe(false)
  })

  test("OnSettingChanged: changing database or key path resets lock state", async () => {
    const ctx = {} as Context
    await unlockPlugin(ctx)

    expect(session.isUnlocked()).toBe(true)
    expect(settingChangeHandler).not.toBeNull()

    // Changing kdbxFilePath locks vault
    settingChangeHandler!(ctx, "kdbxFilePath", "C:\\new\\path.kdbx")
    expect(session.isUnlocked()).toBe(false)

    // Re-unlock
    settingsStore["kdbxFilePath"] = tempKdbxPath
    await unlockPlugin(ctx)
    expect(session.isUnlocked()).toBe(true)

    // Changing keyFilePath locks vault
    settingChangeHandler!(ctx, "keyFilePath", "C:\\new\\key.key")
    expect(session.isUnlocked()).toBe(false)
  })

  test("OnSettingChanged: modifying excludeRules refreshes filters without re-locking", async () => {
    const ctx = {} as Context
    await unlockPlugin(ctx)

    expect(session.isUnlocked()).toBe(true)
    expect(settingChangeHandler).not.toBeNull()

    // Query before exclude rules shows results
    const beforeResponse = await plugin.query(ctx, createQuery("游戏账号"))
    const beforeResults = Array.isArray(beforeResponse) ? beforeResponse : beforeResponse.Results
    expect(beforeResults.length).toBeGreaterThan(0)

    // Modify excludeRules via setting
    settingChangeHandler!(ctx, "excludeRules", 't:"游戏"')

    // Still unlocked!
    expect(session.isUnlocked()).toBe(true)

    // Subsequent search applies new exclude rules
    const afterResponse = await plugin.query(ctx, createQuery("游戏账号"))
    const afterResults = Array.isArray(afterResponse) ? afterResponse : afterResponse.Results
    expect(afterResults.length).toBe(0)
  })

  test("OnSettingChanged: setting autoLockTimeout to 0 disables idle timeout locking", async () => {
    const ctx = {} as Context
    await unlockPlugin(ctx)
    expect(session.isUnlocked()).toBe(true)

    // Set autoLockTimeout to 0 (disabled)
    settingChangeHandler!(ctx, "autoLockTimeout", "0")

    // Fast-forward time past 900s
    jest.useFakeTimers()
    try {
      jest.advanceTimersByTime(1000 * 1000)
      // Since timeout is 0 (disabled), session remains unlocked
      expect(session.isUnlocked()).toBe(true)
    } finally {
      jest.useRealTimers()
    }
  })
})
