import path from "path"
import { Context, PublicAPI, Query, WoxImage, ExecuteResultAction } from "@wox-launcher/wox-plugin"
import * as session from "../session"
import { plugin } from "../index"

describe("Selection Query Handling", () => {
  jest.setTimeout(30000)

  const sampleKdbxPath = path.resolve(__dirname, "../../tests/fixtures/sample-auth.kdbx")
  const sampleKeyxPath = path.resolve(__dirname, "../../tests/fixtures/sample-auth.keyx")
  const password = "9VA%9hfe2MzzaHQp"

  let mockApi: PublicAPI
  let settingsStore: Record<string, string> = {}

  beforeEach(() => {
    session.lock()
    settingsStore = {
      kdbxFilePath: sampleKdbxPath,
      keyFilePath: sampleKeyxPath,
      autoLockTimeout: "900",
      excludeRules: ""
    }

    mockApi = {
      Log: jest.fn().mockResolvedValue(undefined),
      GetSetting: jest.fn().mockImplementation(async (_ctx: Context, key: string) => {
        return settingsStore[key] || ""
      }),
      SaveSetting: jest.fn().mockResolvedValue(undefined),
      OnSettingChanged: jest.fn().mockResolvedValue(undefined),
      ChangeQuery: jest.fn().mockResolvedValue(undefined),
      Notify: jest.fn().mockResolvedValue(undefined),
      ShowToolbarMsg: jest.fn().mockResolvedValue(undefined),
      ClearToolbarMsg: jest.fn().mockResolvedValue(undefined)
    } as unknown as PublicAPI
  })

  function createSelectionQuery(selectedText: string): Query {
    return {
      Id: "sel-1",
      Env: { ActiveWindowTitle: "", ActiveWindowPid: 0, ActiveBrowserUrl: "", ActiveWindowIcon: {} as WoxImage },
      RawQuery: "",
      Selection: { Type: "text", Text: selectedText, FilePaths: [] },
      Type: "selection",
      Search: "",
      TriggerKeyword: "",
      Command: "",
      IsGlobalQuery(): boolean {
        return false
      }
    }
  }

  function createInputQuery(search = ""): Query {
    return {
      Id: "input-1",
      Env: { ActiveWindowTitle: "", ActiveWindowPid: 0, ActiveBrowserUrl: "", ActiveWindowIcon: {} as WoxImage },
      RawQuery: search ? `kp ${search}` : "kp",
      Selection: { Type: "text", Text: "", FilePaths: [] },
      Type: "input",
      Search: search,
      TriggerKeyword: "kp",
      Command: "",
      IsGlobalQuery(): boolean {
        return false
      }
    }
  }

  test("returns empty array for non-URL text when database is locked", async () => {
    const ctx = {} as Context
    await plugin.init(ctx, { PluginDirectory: "", API: mockApi })

    const response = await plugin.query(ctx, createSelectionQuery("hello world"))
    const results = Array.isArray(response) ? response : response.Results
    expect(results).toEqual([])

    const chineseResponse = await plugin.query(ctx, createSelectionQuery("这是一个普通的文本选区"))
    const chineseResults = Array.isArray(chineseResponse) ? chineseResponse : chineseResponse.Results
    expect(chineseResults).toEqual([])
  })

  test("returns locked status item when selected text is a valid URL but database is locked", async () => {
    const ctx = {} as Context
    await plugin.init(ctx, { PluginDirectory: "", API: mockApi })

    const response = await plugin.query(ctx, createSelectionQuery("https://github.com"))
    const results = Array.isArray(response) ? response : response.Results

    expect(results.length).toBe(1)
    expect(results[0].Title).toBe("🔒 数据库已锁定")
    expect(results[0].SubTitle).toContain("解锁")
  })

  test("returns empty array for non-URL text even when database is unlocked", async () => {
    const ctx = {} as Context
    await plugin.init(ctx, { PluginDirectory: "", API: mockApi })

    // Unlock
    const lockQuery = await plugin.query(ctx, createInputQuery(password))
    const lockResults = Array.isArray(lockQuery) ? lockQuery : lockQuery.Results
    const action = lockResults[0].Actions?.[0] as ExecuteResultAction
    await action.Action(ctx, { ResultId: "1", ResultActionId: "unlock", ContextData: {} })
    expect(session.isUnlocked()).toBe(true)

    // Selection query with non-URL text
    const response = await plugin.query(ctx, createSelectionQuery("random text selection"))
    const results = Array.isArray(response) ? response : response.Results
    expect(results).toEqual([])
  })

  test("searches credentials by extracted hostname for protocol and protocol-less URLs when unlocked", async () => {
    const ctx = {} as Context
    await plugin.init(ctx, { PluginDirectory: "", API: mockApi })

    // Unlock
    const lockQuery = await plugin.query(ctx, createInputQuery(password))
    const lockResults = Array.isArray(lockQuery) ? lockQuery : lockQuery.Results
    const action = lockResults[0].Actions?.[0] as ExecuteResultAction
    await action.Action(ctx, { ResultId: "1", ResultActionId: "unlock", ContextData: {} })
    expect(session.isUnlocked()).toBe(true)

    // Case 1: Protocol URL with path
    const response1 = await plugin.query(ctx, createSelectionQuery("https://github.com/Wox-launcher/Wox/pull/1"))
    const results1 = Array.isArray(response1) ? response1 : response1.Results
    expect(results1.length).toBeGreaterThanOrEqual(1)
    expect(results1[0].Title).toContain("Github")
    expect(results1[0].Icon).toEqual({
      ImageType: "relative",
      ImageData: "icons/app.svg"
    })

    // Case 2: Protocol-less domain
    const response2 = await plugin.query(ctx, createSelectionQuery("github.com"))
    const results2 = Array.isArray(response2) ? response2 : response2.Results
    expect(results2.length).toBeGreaterThanOrEqual(1)
    expect(results2[0].Title).toContain("Github")
    expect(results2[0].Icon).toEqual({
      ImageType: "relative",
      ImageData: "icons/app.svg"
    })
  })
})
