import path from "path"
import fs from "fs"
import { Context, PublicAPI, Query, WoxImage, ExecuteResultAction } from "@wox-launcher/wox-plugin"
import { plugin } from "../index"

describe("KeePass Plugin Locked State & Unlock Flow", () => {
  let mockApi: PublicAPI
  let settingChangeHandler: ((ctx: Context, key: string, value: string) => void) | null = null
  const settingsStore: Record<string, string> = {}
  const sampleKdbxPath = path.resolve(__dirname, "../../tests/fixtures/sample-auth.kdbx")
  const sampleKeyxPath = path.resolve(__dirname, "../../tests/fixtures/sample-auth.keyx")

  beforeEach(() => {
    settingChangeHandler = null
    for (const key of Object.keys(settingsStore)) {
      delete settingsStore[key]
    }

    settingsStore["kdbxFilePath"] = sampleKdbxPath
    settingsStore["keyFilePath"] = sampleKeyxPath

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

  test("shows static locked result when configured and locked", async () => {
    const ctx = {} as Context
    await plugin.init(ctx, {
      PluginDirectory: "",
      API: mockApi
    })

    const response = await plugin.query(ctx, createQuery())
    const results = Array.isArray(response) ? response : response.Results

    expect(results).toHaveLength(1)
    const result = results[0]
    expect(result.Title).toBe("🔒 数据库已锁定")
    expect(result.SubTitle).toBe("输入主密码后按 Enter 解锁")
    expect(result.Icon).toEqual({
      ImageType: "relative",
      ImageData: "icons/app.svg"
    })

    const defaultAction = result.Actions?.[0] as ExecuteResultAction | undefined
    expect(defaultAction).toBeDefined()
    expect(defaultAction?.Name).toBe("解锁")
    expect(defaultAction?.IsDefault).toBe(true)
    expect(defaultAction?.PreventHideAfterAction).toBe(true)
  })

  test("locked state subtitle remains static when password is typed in query", async () => {
    const ctx = {} as Context
    await plugin.init(ctx, {
      PluginDirectory: "",
      API: mockApi
    })

    const response = await plugin.query(ctx, createQuery("mySuperSecretPassword123!"))
    const results = Array.isArray(response) ? response : response.Results

    expect(results).toHaveLength(1)
    const result = results[0]
    expect(result.Title).toBe("🔒 数据库已锁定")
    expect(result.SubTitle).toBe("输入主密码后按 Enter 解锁")
  })

  test("triggering unlock with empty password notifies user to enter password", async () => {
    const ctx = {} as Context
    await plugin.init(ctx, {
      PluginDirectory: "",
      API: mockApi
    })

    const response = await plugin.query(ctx, createQuery(""))
    const results = Array.isArray(response) ? response : response.Results
    const action = results[0].Actions?.[0] as ExecuteResultAction

    await action.Action(ctx, { ResultId: "1", ResultActionId: "unlock", ContextData: {} })

    expect(mockApi.Notify).toHaveBeenCalledWith(ctx, "请输入主密码")
    expect(mockApi.ShowToolbarMsg).toHaveBeenCalledWith(
      ctx,
      expect.objectContaining({
        Id: "keepass-unlock",
        Title: "请输入主密码"
      })
    )
    expect(mockApi.ChangeQuery).not.toHaveBeenCalled()
  })

  test("triggering unlock with incorrect password notifies error and remains locked", async () => {
    const ctx = {} as Context
    await plugin.init(ctx, {
      PluginDirectory: "",
      API: mockApi
    })

    const response = await plugin.query(ctx, createQuery("wrongPassword!"))
    const results = Array.isArray(response) ? response : response.Results
    const action = results[0].Actions?.[0] as ExecuteResultAction

    await action.Action(ctx, { ResultId: "1", ResultActionId: "unlock", ContextData: {} })

    expect(mockApi.Notify).toHaveBeenCalledWith(ctx, expect.stringContaining("解锁失败"))
    expect(mockApi.ShowToolbarMsg).toHaveBeenCalledWith(
      ctx,
      expect.objectContaining({
        Id: "keepass-unlock",
        Title: expect.stringContaining("解锁失败")
      })
    )
    expect(mockApi.ChangeQuery).not.toHaveBeenCalled()

    // 依然处于锁定状态
    const afterQuery = await plugin.query(ctx, createQuery())
    const afterResults = Array.isArray(afterQuery) ? afterQuery : afterQuery.Results
    expect(afterResults[0].Title).toBe("🔒 数据库已锁定")
  })

  test("triggering unlock with corrupted key file notifies error and remains locked", async () => {
    const ctx = {} as Context
    const corruptedKeyx = path.resolve(__dirname, "../../tests/fixtures/corrupted.keyx")
    fs.writeFileSync(corruptedKeyx, "corrupted key data")

    try {
      settingsStore["keyFilePath"] = corruptedKeyx
      await plugin.init(ctx, {
        PluginDirectory: "",
        API: mockApi
      })

      const response = await plugin.query(ctx, createQuery("9VA%9hfe2MzzaHQp"))
      const results = Array.isArray(response) ? response : response.Results
      const action = results[0].Actions?.[0] as ExecuteResultAction

      await action.Action(ctx, { ResultId: "1", ResultActionId: "unlock", ContextData: {} })

      expect(mockApi.Notify).toHaveBeenCalledWith(ctx, expect.stringContaining("解锁失败"))
      expect(mockApi.ChangeQuery).not.toHaveBeenCalled()
    } finally {
      if (fs.existsSync(corruptedKeyx)) {
        fs.unlinkSync(corruptedKeyx)
      }
    }
  })

  test("successful unlock sanitizes query via ChangeQuery and transitions to unlocked state", async () => {
    const ctx = {} as Context
    await plugin.init(ctx, {
      PluginDirectory: "",
      API: mockApi
    })

    const response = await plugin.query(ctx, createQuery("9VA%9hfe2MzzaHQp"))
    const results = Array.isArray(response) ? response : response.Results
    const action = results[0].Actions?.[0] as ExecuteResultAction

    await action.Action(ctx, { ResultId: "1", ResultActionId: "unlock", ContextData: {} })

    expect(mockApi.ShowToolbarMsg).toHaveBeenCalledWith(ctx, {
      Id: "keepass-unlock",
      Title: "正在解锁 KeePass 数据库...",
      Icon: {
        ImageType: "relative",
        ImageData: "icons/app.svg"
      },
      Indeterminate: true
    })
    expect(mockApi.ShowToolbarMsg).toHaveBeenCalledWith(
      ctx,
      expect.objectContaining({
        Id: "keepass-unlock",
        Title: "数据库解锁成功"
      })
    )
    expect(mockApi.Notify).toHaveBeenCalledWith(ctx, "数据库解锁成功")

    expect(mockApi.ChangeQuery).toHaveBeenCalledWith(ctx, {
      QueryType: "input",
      QueryText: "kp "
    })

    // 解锁后查询，不再显示锁定结果
    const unlockedResponse = await plugin.query(ctx, createQuery(""))
    const unlockedResults = Array.isArray(unlockedResponse) ? unlockedResponse : unlockedResponse.Results
    expect(unlockedResults).toEqual([])

    // 验证日志中绝不包含主密码
    const logCalls = (mockApi.Log as jest.Mock).mock.calls
    for (const call of logCalls) {
      expect(JSON.stringify(call)).not.toContain("9VA%9hfe2MzzaHQp")
    }

    // 验证修改配置后自动重置为锁定状态
    expect(settingChangeHandler).not.toBeNull()
    settingChangeHandler!(ctx, "kdbxFilePath", sampleKdbxPath)

    const relockedResponse = await plugin.query(ctx, createQuery())
    const relockedResults = Array.isArray(relockedResponse) ? relockedResponse : relockedResponse.Results
    expect(relockedResults[0].Title).toBe("🔒 数据库已锁定")
  })

  test("successful unlock dynamically uses query.TriggerKeyword for ChangeQuery", async () => {
    const ctx = {} as Context
    await plugin.init(ctx, {
      PluginDirectory: "",
      API: mockApi
    })

    // Case 1: TriggerKeyword is 'keepass'
    const responseKeepass = await plugin.query(ctx, createQuery("9VA%9hfe2MzzaHQp", "keepass"))
    const resultsKeepass = Array.isArray(responseKeepass) ? responseKeepass : responseKeepass.Results
    const actionKeepass = resultsKeepass[0].Actions?.[0] as ExecuteResultAction

    await actionKeepass.Action(ctx, { ResultId: "1", ResultActionId: "unlock", ContextData: {} })

    expect(mockApi.ChangeQuery).toHaveBeenCalledWith(ctx, {
      QueryType: "input",
      QueryText: "keepass "
    })

    // Re-lock to test another keyword
    settingChangeHandler!(ctx, "kdbxFilePath", sampleKdbxPath)

    // Case 2: Custom trigger keyword 'pwd'
    const responsePwd = await plugin.query(ctx, createQuery("9VA%9hfe2MzzaHQp", "pwd"))
    const resultsPwd = Array.isArray(responsePwd) ? responsePwd : responsePwd.Results
    const actionPwd = resultsPwd[0].Actions?.[0] as ExecuteResultAction

    await actionPwd.Action(ctx, { ResultId: "1", ResultActionId: "unlock", ContextData: {} })

    expect(mockApi.ChangeQuery).toHaveBeenCalledWith(ctx, {
      QueryType: "input",
      QueryText: "pwd "
    })
  })
})
