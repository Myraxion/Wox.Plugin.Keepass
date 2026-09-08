import path from "path"
import fs from "fs"
import { spawn, ChildProcess } from "child_process"
import * as kdbxweb from "kdbxweb"
import { Context, PublicAPI, Query, WoxImage, ExecuteResultAction, ResultAction } from "@wox-launcher/wox-plugin"
import { setupArgon2 } from "../crypto"
import { getAllEntries, FlattenedEntry, searchEntries } from "../search"
import { buildEntryActions, getPlatformModifier, defaultUrlOpener } from "../actions"
import { plugin } from "../index"

describe("Platform-Adaptive Keyboard Actions & Auto-Hide", () => {
  jest.setTimeout(30000)

  const sampleKdbxPath = path.resolve(__dirname, "../../tests/fixtures/sample-auth.kdbx")
  const sampleKeyxPath = path.resolve(__dirname, "../../tests/fixtures/sample-auth.keyx")
  const password = "9VA%9hfe2MzzaHQp"

  let db: kdbxweb.Kdbx
  let allEntries: FlattenedEntry[]
  let mockApi: PublicAPI
  const dummyCtx = {} as Context

  beforeAll(async () => {
    setupArgon2()
    const kdbxData = await fs.promises.readFile(sampleKdbxPath)
    const kdbxBuffer = new Uint8Array(kdbxData).slice().buffer as ArrayBuffer
    const passwordProtected = kdbxweb.ProtectedValue.fromString(password)
    const keyFileBuffer = await fs.promises.readFile(sampleKeyxPath)
    const keyData = new Uint8Array(keyFileBuffer)
    const credentials = new kdbxweb.Credentials(passwordProtected, keyData)
    db = await kdbxweb.Kdbx.load(kdbxBuffer, credentials)
    allEntries = getAllEntries(db)
  }, 30000)

  beforeEach(() => {
    mockApi = {
      Log: jest.fn().mockResolvedValue(undefined),
      GetSetting: jest.fn().mockImplementation(async (_ctx: Context, key: string) => {
        if (key === "kdbxFilePath") return sampleKdbxPath
        if (key === "keyFilePath") return sampleKeyxPath
        return ""
      }),
      SaveSetting: jest.fn().mockResolvedValue(undefined),
      OnSettingChanged: jest.fn().mockResolvedValue(undefined),
      ChangeQuery: jest.fn().mockResolvedValue(undefined),
      Notify: jest.fn().mockResolvedValue(undefined),
      Copy: jest.fn().mockResolvedValue(undefined),
      ShowToolbarMsg: jest.fn().mockResolvedValue(undefined),
      ClearToolbarMsg: jest.fn().mockResolvedValue(undefined)
    } as unknown as PublicAPI
  })

  describe("Platform modifier detection", () => {
    test("detects macOS (darwin) as cmd", () => {
      expect(getPlatformModifier("darwin")).toBe("cmd")
    })

    test("detects Windows (win32) as ctrl", () => {
      expect(getPlatformModifier("win32")).toBe("ctrl")
    })

    test("detects Linux (linux) as ctrl", () => {
      expect(getPlatformModifier("linux")).toBe("ctrl")
    })

    test("defaults to process.platform when not specified", () => {
      const expected = process.platform === "darwin" ? "cmd" : "ctrl"
      expect(getPlatformModifier()).toBe(expected)
    })
  })

  describe("Default URL opener", () => {
    let mockSpawn: jest.Mock
    let mockChild: { unref: jest.Mock }

    beforeEach(() => {
      mockChild = { unref: jest.fn() }
      mockSpawn = jest.fn().mockReturnValue(mockChild as unknown as ChildProcess)
    })

    test("launches open on darwin", () => {
      defaultUrlOpener("https://github.com", "darwin", mockSpawn as unknown as typeof spawn)
      expect(mockSpawn).toHaveBeenCalledWith("open", ["https://github.com"], {
        detached: true,
        stdio: "ignore"
      })
      expect(mockChild.unref).toHaveBeenCalled()
    })

    test("launches rundll32 on win32", () => {
      defaultUrlOpener("https://github.com", "win32", mockSpawn as unknown as typeof spawn)
      expect(mockSpawn).toHaveBeenCalledWith("rundll32.exe", ["url.dll,FileProtocolHandler", "https://github.com"], {
        detached: true,
        stdio: "ignore"
      })
      expect(mockChild.unref).toHaveBeenCalled()
    })

    test("launches xdg-open on linux", () => {
      defaultUrlOpener("https://github.com", "linux", mockSpawn as unknown as typeof spawn)
      expect(mockSpawn).toHaveBeenCalledWith("xdg-open", ["https://github.com"], {
        detached: true,
        stdio: "ignore"
      })
      expect(mockChild.unref).toHaveBeenCalled()
    })
  })

  describe("Default action: Copy Password", () => {
    test("configures IsDefault: true, copy payload, and auto-hide (PreventHideAfterAction: false)", async () => {
      const githubEntry = allEntries.find(e => e.title === "Github")!
      expect(githubEntry).toBeDefined()

      const actions: ResultAction[] = buildEntryActions(githubEntry, mockApi)
      const defaultAction = actions.find(a => a.IsDefault) as ExecuteResultAction
      expect(defaultAction).toBeDefined()
      expect(defaultAction.Id).toBeUndefined()
      expect(defaultAction.Name).toBe("复制密码")
      expect(defaultAction.PreventHideAfterAction).toBe(false)
      expect(defaultAction.Icon).toEqual({
        ImageType: "relative",
        ImageData: "icons/database/C00_Password.svg"
      })

      await defaultAction.Action(dummyCtx, { ResultId: "1", ResultActionId: "copy-password", ContextData: {} })
      expect(mockApi.Copy).toHaveBeenCalledWith(dummyCtx, {
        type: "text",
        text: "Sh~vL4~peCKiJEL4"
      })
    })

    test("handles entries with empty password", async () => {
      const emptyPwEntry = allEntries.find(e => e.title === "Dropbox（通行密钥）")!
      expect(emptyPwEntry).toBeDefined()

      const actions: ResultAction[] = buildEntryActions(emptyPwEntry, mockApi)
      const defaultAction = actions.find(a => a.IsDefault) as ExecuteResultAction

      await defaultAction.Action(dummyCtx, { ResultId: "1", ResultActionId: "copy-password", ContextData: {} })
      expect(mockApi.Copy).toHaveBeenCalledWith(dummyCtx, {
        type: "text",
        text: ""
      })
    })
  })

  describe("Secondary action: Copy Username", () => {
    test("configures platform-adaptive hotkey, copy payload, and auto-hide", async () => {
      const githubEntry = allEntries.find(e => e.title === "Github")!
      const actions: ResultAction[] = buildEntryActions(githubEntry, mockApi, { platform: "win32" })
      const copyUserAction = actions.find(a => a.Name === "复制用户名") as ExecuteResultAction

      expect(copyUserAction).toBeDefined()
      expect(copyUserAction.Id).toBeUndefined()
      expect(copyUserAction.Name).toBe("复制用户名")
      expect(copyUserAction.Hotkey).toBe("ctrl+u")
      expect(copyUserAction.PreventHideAfterAction).toBe(false)
      expect(copyUserAction.Icon).toEqual({
        ImageType: "relative",
        ImageData: "icons/database/C09_Identity.svg"
      })

      await copyUserAction.Action(dummyCtx, { ResultId: "1", ResultActionId: "copy-username", ContextData: {} })
      expect(mockApi.Copy).toHaveBeenCalledWith(dummyCtx, {
        type: "text",
        text: "user111"
      })
    })

    test("assigns cmd+u hotkey on darwin", () => {
      const githubEntry = allEntries.find(e => e.title === "Github")!
      const actions: ResultAction[] = buildEntryActions(githubEntry, mockApi, { platform: "darwin" })
      const copyUserAction = actions.find(a => a.Name === "复制用户名")
      expect(copyUserAction?.Hotkey).toBe("cmd+u")
    })
  })

  describe("Secondary action: Copy TOTP", () => {
    test("copies freshly calculated TOTP token and auto-hides", async () => {
      const githubEntry = allEntries.find(e => e.title === "Github")!
      const fixedTime = 1700000012000
      const actions: ResultAction[] = buildEntryActions(githubEntry, mockApi, { platform: "win32", timestamp: fixedTime })
      const copyTotpAction = actions.find(a => a.Name === "复制 TOTP") as ExecuteResultAction

      expect(copyTotpAction).toBeDefined()
      expect(copyTotpAction.Id).toBeUndefined()
      expect(copyTotpAction.Name).toBe("复制 TOTP")
      expect(copyTotpAction.Hotkey).toBe("ctrl+t")
      expect(copyTotpAction.PreventHideAfterAction).toBe(false)
      expect(copyTotpAction.Icon).toEqual({
        ImageType: "relative",
        ImageData: "icons/database/C39_History.svg"
      })

      await copyTotpAction.Action(dummyCtx, { ResultId: "1", ResultActionId: "copy-totp", ContextData: {} })
      expect(mockApi.Copy).toHaveBeenCalledWith(dummyCtx, {
        type: "text",
        text: expect.stringMatching(/^\d{6}$/)
      })
      expect(mockApi.Notify).not.toHaveBeenCalled()
    })

    test("assigns cmd+t hotkey on darwin", () => {
      const githubEntry = allEntries.find(e => e.title === "Github")!
      const actions: ResultAction[] = buildEntryActions(githubEntry, mockApi, { platform: "darwin" })
      const copyTotpAction = actions.find(a => a.Name === "复制 TOTP")
      expect(copyTotpAction?.Hotkey).toBe("cmd+t")
    })

    test("notifies user when entry has no TOTP configured", async () => {
      const noTotpEntry = allEntries.find(e => e.title === "Dropbox（通行密钥）")!
      const actions: ResultAction[] = buildEntryActions(noTotpEntry, mockApi)
      const copyTotpAction = actions.find(a => a.Name === "复制 TOTP") as ExecuteResultAction

      await copyTotpAction.Action(dummyCtx, { ResultId: "1", ResultActionId: "copy-totp", ContextData: {} })
      expect(mockApi.Copy).not.toHaveBeenCalled()
      expect(mockApi.Notify).toHaveBeenCalledWith(dummyCtx, "未配置 TOTP")
    })
  })

  describe("Secondary action: Open URL", () => {
    test("opens normalized entry URL in browser and auto-hides", async () => {
      const githubEntry = allEntries.find(e => e.title === "Github")!
      const mockOpener = jest.fn()
      const actions: ResultAction[] = buildEntryActions(githubEntry, mockApi, {
        platform: "win32",
        urlOpener: mockOpener
      })
      const openUrlAction = actions.find(a => a.Name === "打开网址") as ExecuteResultAction

      expect(openUrlAction).toBeDefined()
      expect(openUrlAction.Id).toBeUndefined()
      expect(openUrlAction.Name).toBe("打开网址")
      expect(openUrlAction.Hotkey).toBe("ctrl+o")
      expect(openUrlAction.PreventHideAfterAction).toBe(false)
      expect(openUrlAction.Icon).toEqual({
        ImageType: "relative",
        ImageData: "icons/database/C16_Mozilla_Firebird.svg"
      })

      await openUrlAction.Action(dummyCtx, { ResultId: "1", ResultActionId: "open-url", ContextData: {} })
      expect(mockOpener).toHaveBeenCalledWith("https://github.com")
      expect(mockApi.Notify).not.toHaveBeenCalled()
    })

    test("assigns cmd+o hotkey on darwin", () => {
      const githubEntry = allEntries.find(e => e.title === "Github")!
      const actions: ResultAction[] = buildEntryActions(githubEntry, mockApi, { platform: "darwin" })
      const openUrlAction = actions.find(a => a.Name === "打开网址")
      expect(openUrlAction?.Hotkey).toBe("cmd+o")
    })

    test("notifies user when entry has no URL configured", async () => {
      const noUrlEntry = allEntries.find(e => !e.url || e.url.trim() === "")!
      expect(noUrlEntry).toBeDefined()
      const mockOpener = jest.fn()
      const actions: ResultAction[] = buildEntryActions(noUrlEntry, mockApi, { urlOpener: mockOpener })
      const openUrlAction = actions.find(a => a.Name === "打开网址") as ExecuteResultAction

      await openUrlAction.Action(dummyCtx, { ResultId: "1", ResultActionId: "open-url", ContextData: {} })
      expect(mockOpener).not.toHaveBeenCalled()
      expect(mockApi.Notify).toHaveBeenCalledWith(dummyCtx, "未配置网址")
    })
  })

  describe("Wox Tab Action Panel Registration", () => {
    test("all 4 actions register with distinct names and distinct icons, and omit hardcoded Id", () => {
      const githubEntry = allEntries.find(e => e.title === "Github")!
      const actions: ResultAction[] = buildEntryActions(githubEntry, mockApi)

      expect(actions).toHaveLength(4)

      const names = actions.map(a => a.Name)
      const iconPaths = actions.map(a => a.Icon?.ImageData)

      expect(new Set(names).size).toBe(4)
      expect(new Set(iconPaths).size).toBe(4)

      for (const action of actions) {
        expect(action.Id).toBeUndefined()
        expect(action.PreventHideAfterAction).toBe(false)
      }
    })
  })

  describe("Multi-Entry Actions Isolation", () => {
    test("actions from different entries execute their own closures without crosstalk", async () => {
      const githubEntry = allEntries.find(e => e.title === "Github")!
      const dropboxEntry = allEntries.find(e => e.title === "Dropbox（通行密钥）")!

      const mockOpener = jest.fn()
      const fixedTime = 1700000012000

      const githubActions = buildEntryActions(githubEntry, mockApi, { urlOpener: mockOpener, timestamp: fixedTime })
      const dropboxActions = buildEntryActions(dropboxEntry, mockApi, { urlOpener: mockOpener, timestamp: fixedTime })

      const githubOpenUrl = githubActions.find(a => a.Name === "打开网址") as ExecuteResultAction
      const dropboxOpenUrl = dropboxActions.find(a => a.Name === "打开网址") as ExecuteResultAction
      const githubCopyTotp = githubActions.find(a => a.Name === "复制 TOTP") as ExecuteResultAction
      const dropboxCopyTotp = dropboxActions.find(a => a.Name === "复制 TOTP") as ExecuteResultAction

      // 1. Open URL isolation: Github vs Dropbox
      await githubOpenUrl.Action(dummyCtx, { ResultId: "g", ResultActionId: "act-g", ContextData: {} })
      expect(mockOpener).toHaveBeenCalledWith("https://github.com")

      await dropboxOpenUrl.Action(dummyCtx, { ResultId: "d", ResultActionId: "act-d", ContextData: {} })
      expect(mockOpener).toHaveBeenCalledWith("https://www.dropbox.com")

      // 2. TOTP isolation: Github (has TOTP) vs Dropbox (no TOTP)
      await githubCopyTotp.Action(dummyCtx, { ResultId: "g", ResultActionId: "act-g", ContextData: {} })
      expect(mockApi.Copy).toHaveBeenCalledWith(dummyCtx, {
        type: "text",
        text: expect.stringMatching(/^\d{6}$/)
      })

      await dropboxCopyTotp.Action(dummyCtx, { ResultId: "d", ResultActionId: "act-d", ContextData: {} })
      expect(mockApi.Notify).toHaveBeenCalledWith(dummyCtx, "未配置 TOTP")
    })
  })

  describe("Search & Plugin Integration", () => {
    test("searchEntries attaches all 4 actions to every result item", () => {
      const results = searchEntries(db, "Github", mockApi)
      expect(results.length).toBeGreaterThan(0)

      for (const result of results) {
        expect(result.Actions).toBeDefined()
        expect(result.Actions).toHaveLength(4)
        expect(result.Actions![0].IsDefault).toBe(true)
        expect(result.Actions![0].Name).toBe("复制密码")
        expect(result.Actions![1].Name).toBe("复制用户名")
        expect(result.Actions![2].Name).toBe("复制 TOTP")
        expect(result.Actions![3].Name).toBe("打开网址")
      }
    })

    test("plugin.query returns results with functional actions when unlocked", async () => {
      await plugin.init(dummyCtx, {
        PluginDirectory: "",
        API: mockApi
      })

      // Unlock first
      const lockQuery = {
        Id: "1",
        Env: { ActiveWindowTitle: "", ActiveWindowPid: 0, ActiveBrowserUrl: "", ActiveWindowIcon: {} as WoxImage },
        RawQuery: `kp ${password}`,
        Selection: { Type: "text", Text: "", FilePaths: [] },
        Type: "input",
        Search: password,
        TriggerKeyword: "kp",
        Command: "",
        IsGlobalQuery: () => false
      } as Query

      const lockRes = await plugin.query(dummyCtx, lockQuery)
      const lockResults = Array.isArray(lockRes) ? lockRes : lockRes.Results
      const unlockAction = lockResults[0].Actions![0] as ExecuteResultAction
      await unlockAction.Action(dummyCtx, { ResultId: "1", ResultActionId: "unlock", ContextData: {} })

      // Now query entries
      const searchQuery = {
        ...lockQuery,
        RawQuery: "kp Github",
        Search: "Github"
      }

      const res = await plugin.query(dummyCtx, searchQuery)
      const searchResults = Array.isArray(res) ? res : res.Results
      expect(searchResults.length).toBeGreaterThan(0)

      const firstResult = searchResults[0]
      expect(firstResult.Actions).toBeDefined()
      expect(firstResult.Actions).toHaveLength(4)

      // Test default action
      const defaultAction = firstResult.Actions![0] as ExecuteResultAction
      await defaultAction.Action(dummyCtx, { ResultId: "1", ResultActionId: "copy-password", ContextData: {} })
      expect(mockApi.Copy).toHaveBeenCalledWith(dummyCtx, {
        type: "text",
        text: "Sh~vL4~peCKiJEL4"
      })
    })
  })
})
