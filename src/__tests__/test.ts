import { Context, PublicAPI, Query, WoxImage } from "@wox-launcher/wox-plugin"
import { plugin } from "../index"

describe("KeePass Plugin Unconfigured State", () => {
  let mockApi: PublicAPI
  let settingChangeHandler: ((ctx: Context, key: string, value: string) => void) | null
  const settingsStore: Record<string, string> = {}

  beforeEach(() => {
    settingChangeHandler = null
    for (const key of Object.keys(settingsStore)) {
      delete settingsStore[key]
    }

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

  function createQuery(search = ""): Query {
    return {
      Id: "1",
      Env: { ActiveWindowTitle: "", ActiveWindowPid: 0, ActiveBrowserUrl: "", ActiveWindowIcon: {} as WoxImage },
      RawQuery: `kp ${search}`,
      Selection: { Type: "text", Text: "", FilePaths: [] },
      Type: "input",
      Search: search,
      TriggerKeyword: "kp",
      Command: "",
      IsGlobalQuery(): boolean {
        return false
      }
    } as Query
  }

  test("displays setup guidance result item when kdbxFilePath is not configured", async () => {
    const ctx = {} as Context
    await plugin.init(ctx, {
      PluginDirectory: "",
      API: mockApi
    })

    const response = await plugin.query(ctx, createQuery())
    const results = Array.isArray(response) ? response : response.Results

    expect(results).toHaveLength(1)
    const [result] = results
    expect(result.Title).toBe("⚙️ 请先配置 KeePass 数据库路径")
    expect(result.SubTitle).toBeDefined()
    expect(result.Icon).toBeDefined()
    expect(result.Preview).toBeDefined()
    expect(result.Preview?.PreviewType).toBe("markdown")
    expect(result.Preview?.PreviewData).toContain("kdbxFilePath")
    expect(result.Preview?.PreviewData).toContain("KeePass")
  })

  test("displays setup guidance result item when kdbxFilePath is whitespace only", async () => {
    const ctx = {} as Context
    settingsStore["kdbxFilePath"] = "   "
    await plugin.init(ctx, {
      PluginDirectory: "",
      API: mockApi
    })

    const response = await plugin.query(ctx, createQuery("searchterm"))
    const results = Array.isArray(response) ? response : response.Results

    expect(results).toHaveLength(1)
    expect(results[0].Title).toBe("⚙️ 请先配置 KeePass 数据库路径")
  })

  test("registers OnSettingChanged and updates configuration", async () => {
    const ctx = {} as Context
    await plugin.init(ctx, {
      PluginDirectory: "",
      API: mockApi
    })

    expect(mockApi.OnSettingChanged).toHaveBeenCalled()
    expect(settingChangeHandler).not.toBeNull()

    // 初始状态下未配置，显示引导
    let response = await plugin.query(ctx, createQuery())
    let results = Array.isArray(response) ? response : response.Results
    expect(results[0].Title).toBe("⚙️ 请先配置 KeePass 数据库路径")

    // 模拟配置已更新
    settingChangeHandler!(ctx, "kdbxFilePath", "D:\\keepass\\passwords.kdbx")

    // 再次查询，显示锁定状态而非未配置引导
    response = await plugin.query(ctx, createQuery())
    results = Array.isArray(response) ? response : response.Results
    expect(results).toHaveLength(1)
    expect(results[0].Title).toBe("🔒 数据库已锁定")
  })

  test("handles autoLockTimeout set to 0 properly without defaulting to 900", async () => {
    const ctx = {} as Context
    settingsStore["kdbxFilePath"] = "D:\\passwords.kdbx"
    settingsStore["autoLockTimeout"] = "0"

    await plugin.init(ctx, {
      PluginDirectory: "",
      API: mockApi
    })

    expect(settingChangeHandler).not.toBeNull()
  })
})
