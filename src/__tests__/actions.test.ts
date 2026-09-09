import path from "path"
import fs from "fs"
import { spawn, ChildProcess } from "child_process"
import * as kdbxweb from "kdbxweb"
import { Context, PublicAPI, Query, WoxImage, ExecuteResultAction, ResultAction } from "@wox-launcher/wox-plugin"
import { setupArgon2 } from "../crypto"
import { getAllEntries, FlattenedEntry, searchEntries } from "../search"
import { buildEntryActions, getPlatformModifier, defaultUrlOpener, escapeSendKeys, defaultKeystrokeTyper } from "../actions"
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
      ClearToolbarMsg: jest.fn().mockResolvedValue(undefined),
      HideApp: jest.fn().mockResolvedValue(undefined)
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

  describe("Windows SendKeys special character escaping", () => {
    test("escapes special SendKeys characters: +^%~{}[]()", () => {
      expect(escapeSendKeys("+")).toBe("{+}")
      expect(escapeSendKeys("^")).toBe("{^}")
      expect(escapeSendKeys("%")).toBe("{%}")
      expect(escapeSendKeys("~")).toBe("{~}")
      expect(escapeSendKeys("{")).toBe("{{}")
      expect(escapeSendKeys("}")).toBe("{}}")
      expect(escapeSendKeys("[")).toBe("{[}")
      expect(escapeSendKeys("]")).toBe("{]}")
      expect(escapeSendKeys("(")).toBe("{(}")
      expect(escapeSendKeys(")")).toBe("{)}")
    })

    test("leaves standard alphanumeric and other characters intact", () => {
      const normalStr = "HelloWorld123!@#$&*-_=\\|;:'\",<.>/?`"
      expect(escapeSendKeys(normalStr)).toBe(normalStr)
    })

    test("properly escapes complex passwords with mixed special characters", () => {
      const complex = "P@ss+w0rd^{123}%~[]()"
      expect(escapeSendKeys(complex)).toBe("P@ss{+}w0rd{^}{{}123{}}{%}{~}{[}{]}{(}{)}")
    })

    test("covers entire ASCII character set (0-127)", () => {
      const specialSet = new Set(["+", "^", "%", "~", "{", "}", "[", "]", "(", ")"])
      for (let code = 0; code < 128; code++) {
        const char = String.fromCharCode(code)
        const escaped = escapeSendKeys(char)
        if (specialSet.has(char)) {
          expect(escaped).toBe(`{${char}}`)
        } else {
          expect(escaped).toBe(char)
        }
      }
    })
  })

  describe("Cross-platform keystroke typer (defaultKeystrokeTyper)", () => {
    let mockChild: {
      stdin: { write: jest.Mock; end: jest.Mock }
      on: jest.Mock
    }
    let mockSpawn: jest.Mock

    beforeEach(() => {
      mockChild = {
        stdin: { write: jest.fn(), end: jest.fn() },
        on: jest.fn().mockImplementation((event: string, handler: (...args: unknown[]) => void) => {
          if (event === "close") {
            setTimeout(() => handler(0), 0)
          }
          return mockChild
        })
      }
      mockSpawn = jest.fn().mockReturnValue(mockChild as unknown as ChildProcess)
    })

    test("launches powershell with raw payload on win32 via stdin", async () => {
      await defaultKeystrokeTyper("Pass+1", "win32", mockSpawn as unknown as typeof spawn)
      expect(mockSpawn).toHaveBeenCalledWith(
        "powershell.exe",
        expect.arrayContaining(["-NoProfile", "-NonInteractive", "-Command"]),
        expect.objectContaining({
          stdio: ["pipe", "ignore", "ignore"],
          windowsHide: true
        })
      )
      const commandArg = mockSpawn.mock.calls[0][1][3]
      expect(commandArg).toContain("SendInput")
      expect(commandArg).toContain("[Console]::InputEncoding = [System.Text.Encoding]::UTF8")
      expect(commandArg).toContain("[Console]::In.ReadToEnd()")
      expect(mockChild.stdin.write).toHaveBeenCalledWith("Pass+1")
      expect(mockChild.stdin.end).toHaveBeenCalled()
    })

    test("passes complex special characters unescaped on win32", async () => {
      const complex = "P@ss+w0rd^{123}%~[]()"
      await defaultKeystrokeTyper(complex, "win32", mockSpawn as unknown as typeof spawn)
      expect(mockChild.stdin.write).toHaveBeenCalledWith(complex)
    })

    test("supports non-ASCII and Unicode characters on win32", async () => {
      const unicodeStr = "管理员密码_测试éñ"
      await defaultKeystrokeTyper(unicodeStr, "win32", mockSpawn as unknown as typeof spawn)
      expect(mockChild.stdin.write).toHaveBeenCalledWith(unicodeStr)
    })

    test("launches osascript with raw payload on darwin via stdin", async () => {
      await defaultKeystrokeTyper("Pass+1", "darwin", mockSpawn as unknown as typeof spawn)
      expect(mockSpawn).toHaveBeenCalledWith(
        "osascript",
        [
          "-l",
          "JavaScript",
          "-e",
          "ObjC.import('Foundation'); var data = $.NSFileHandle.fileHandleWithStandardInput.readDataToEndOfFile; var str = $.NSString.alloc.initWithDataEncoding(data, $.NSUTF8StringEncoding).js; Application('System Events').keystroke(str);"
        ],
        expect.objectContaining({
          stdio: ["pipe", "ignore", "ignore"],
          windowsHide: true
        })
      )
      expect(mockChild.stdin.write).toHaveBeenCalledWith("Pass+1")
      expect(mockChild.stdin.end).toHaveBeenCalled()
    })

    test("launches xdotool with raw payload on linux via stdin", async () => {
      await defaultKeystrokeTyper("Pass+1", "linux", mockSpawn as unknown as typeof spawn)
      expect(mockSpawn).toHaveBeenCalledWith(
        "xdotool",
        ["type", "--clearmodifiers", "--file", "-"],
        expect.objectContaining({
          stdio: ["pipe", "ignore", "ignore"],
          windowsHide: true
        })
      )
      expect(mockChild.stdin.write).toHaveBeenCalledWith("Pass+1")
      expect(mockChild.stdin.end).toHaveBeenCalled()
    })

    test("rejects when process exits with non-zero code", async () => {
      mockChild.on.mockImplementation((event: string, handler: (...args: unknown[]) => void) => {
        if (event === "close") {
          setTimeout(() => handler(1), 0)
        }
        return mockChild
      })

      await expect(defaultKeystrokeTyper("test", "linux", mockSpawn as unknown as typeof spawn)).rejects.toThrow("Typing process exited with code 1")
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

    test("omits password actions and falls back default action to next available field when password is empty", async () => {
      const emptyPwEntry = allEntries.find(e => e.title === "Dropbox（通行密钥）")!
      expect(emptyPwEntry).toBeDefined()

      const actions: ResultAction[] = buildEntryActions(emptyPwEntry, mockApi)
      expect(actions.some(a => a.Name === "复制密码")).toBe(false)
      expect(actions.some(a => a.Name === "模拟键入密码")).toBe(false)

      const defaultAction = actions.find(a => a.IsDefault) as ExecuteResultAction
      expect(defaultAction).toBeDefined()
      expect(defaultAction.Name).toBe("复制用户名")

      await defaultAction.Action(dummyCtx, { ResultId: "1", ResultActionId: "copy-username", ContextData: {} })
      expect(mockApi.Copy).toHaveBeenCalledWith(dummyCtx, {
        type: "text",
        text: "test.111@outlook.com"
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

    test("omits TOTP action when entry has no TOTP configured", () => {
      const noTotpEntry = allEntries.find(e => e.title === "Dropbox（通行密钥）")!
      const actions: ResultAction[] = buildEntryActions(noTotpEntry, mockApi)
      expect(actions.some(a => a.Name.includes("TOTP"))).toBe(false)
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

    test("omits Open URL action when entry has no URL configured", () => {
      const noUrlEntry = allEntries.find(e => !e.url || e.url.trim() === "")!
      expect(noUrlEntry).toBeDefined()
      const mockOpener = jest.fn()
      const actions: ResultAction[] = buildEntryActions(noUrlEntry, mockApi, { urlOpener: mockOpener })
      expect(actions.some(a => a.Name === "打开网址")).toBe(false)
    })
  })

  describe("Output Mode & Action Structure", () => {
    test("clipboard mode: 5 actions, Copy Password default, Type Password mod+p, Copy Username mod+u, Copy TOTP mod+t, Open URL mod+o", async () => {
      const githubEntry = allEntries.find(e => e.title === "Github")!
      const mockTyper = jest.fn()
      const mockOpener = jest.fn()
      const fixedTime = 1700000012000

      const actions = buildEntryActions(githubEntry, mockApi, {
        platform: "win32",
        outputMode: "clipboard",
        typer: mockTyper,
        urlOpener: mockOpener,
        timestamp: fixedTime,
        typingDelayMs: 0
      })

      expect(actions).toHaveLength(5)
      expect(actions[0].Name).toBe("复制密码")
      expect(actions[0].IsDefault).toBe(true)
      expect(actions[0].Hotkey).toBeUndefined()
      expect(actions[0].Icon?.ImageData).toBe("icons/database/C00_Password.svg")

      expect(actions[1].Name).toBe("模拟键入密码")
      expect(actions[1].IsDefault).toBeUndefined()
      expect(actions[1].Hotkey).toBe("ctrl+p")
      expect(actions[1].Icon?.ImageData).toBe("icons/database/C22_ASCII.svg")

      expect(actions[2].Name).toBe("复制用户名")
      expect(actions[2].Hotkey).toBe("ctrl+u")
      expect(actions[2].Icon?.ImageData).toBe("icons/database/C09_Identity.svg")

      expect(actions[3].Name).toBe("复制 TOTP")
      expect(actions[3].Hotkey).toBe("ctrl+t")
      expect(actions[3].Icon?.ImageData).toBe("icons/database/C39_History.svg")

      expect(actions[4].Name).toBe("打开网址")
      expect(actions[4].Hotkey).toBe("ctrl+o")
      expect(actions[4].Icon?.ImageData).toBe("icons/database/C16_Mozilla_Firebird.svg")

      // Test Type Password execution
      const typePwAction = actions[1] as ExecuteResultAction
      await typePwAction.Action(dummyCtx, { ResultId: "1", ResultActionId: "type-password", ContextData: {} })
      expect(mockApi.HideApp).toHaveBeenCalledWith(dummyCtx)
      expect(mockTyper).toHaveBeenCalledWith("Sh~vL4~peCKiJEL4")
    })

    test("type mode: 5 actions, Type Password default, Copy Password mod+c, Type Username mod+u, Type TOTP mod+t, Open URL mod+o", async () => {
      const githubEntry = allEntries.find(e => e.title === "Github")!
      const mockTyper = jest.fn()
      const mockOpener = jest.fn()
      const fixedTime = 1700000012000

      const actions = buildEntryActions(githubEntry, mockApi, {
        platform: "darwin",
        outputMode: "type",
        typer: mockTyper,
        urlOpener: mockOpener,
        timestamp: fixedTime,
        typingDelayMs: 0
      })

      expect(actions).toHaveLength(5)
      expect(actions[0].Name).toBe("模拟键入密码")
      expect(actions[0].IsDefault).toBe(true)
      expect(actions[0].Hotkey).toBeUndefined()
      expect(actions[0].Icon?.ImageData).toBe("icons/database/C22_ASCII.svg")

      expect(actions[1].Name).toBe("复制密码")
      expect(actions[1].IsDefault).toBeUndefined()
      expect(actions[1].Hotkey).toBe("cmd+c")
      expect(actions[1].Icon?.ImageData).toBe("icons/database/C00_Password.svg")

      expect(actions[2].Name).toBe("模拟键入用户名")
      expect(actions[2].Hotkey).toBe("cmd+u")
      expect(actions[2].Icon?.ImageData).toBe("icons/database/C09_Identity.svg")

      expect(actions[3].Name).toBe("模拟键入 TOTP")
      expect(actions[3].Hotkey).toBe("cmd+t")
      expect(actions[3].Icon?.ImageData).toBe("icons/database/C39_History.svg")

      expect(actions[4].Name).toBe("打开网址")
      expect(actions[4].Hotkey).toBe("cmd+o")
      expect(actions[4].Icon?.ImageData).toBe("icons/database/C16_Mozilla_Firebird.svg")

      // Test actions execution
      const typePwAction = actions[0] as ExecuteResultAction
      await typePwAction.Action(dummyCtx, { ResultId: "1", ResultActionId: "type-password", ContextData: {} })
      expect(mockApi.HideApp).toHaveBeenCalledWith(dummyCtx)
      expect(mockTyper).toHaveBeenCalledWith("Sh~vL4~peCKiJEL4")

      const copyPwAction = actions[1] as ExecuteResultAction
      await copyPwAction.Action(dummyCtx, { ResultId: "1", ResultActionId: "copy-password", ContextData: {} })
      expect(mockApi.Copy).toHaveBeenCalledWith(dummyCtx, { type: "text", text: "Sh~vL4~peCKiJEL4" })

      const typeUserAction = actions[2] as ExecuteResultAction
      await typeUserAction.Action(dummyCtx, { ResultId: "1", ResultActionId: "type-user", ContextData: {} })
      expect(mockTyper).toHaveBeenCalledWith("user111")

      const typeTotpAction = actions[3] as ExecuteResultAction
      await typeTotpAction.Action(dummyCtx, { ResultId: "1", ResultActionId: "type-totp", ContextData: {} })
      expect(mockTyper).toHaveBeenCalledWith(expect.stringMatching(/^\d{6}$/))
    })
  })

  describe("Dynamic Action Filtering & Default Fallback", () => {
    test("when password is empty, omits password actions and falls back default to username (clipboard & type modes)", async () => {
      const emptyPwEntry = allEntries.find(e => e.title === "Dropbox（通行密钥）")!
      const mockTyper = jest.fn()

      // 1. clipboard mode
      const clipActions = buildEntryActions(emptyPwEntry, mockApi, { outputMode: "clipboard" })
      expect(clipActions).toHaveLength(2) // Username and URL
      expect(clipActions[0].Name).toBe("复制用户名")
      expect(clipActions[0].IsDefault).toBe(true)
      expect(clipActions[0].Hotkey).toBeUndefined()
      expect(clipActions[1].Name).toBe("打开网址")
      expect(clipActions[1].IsDefault).toBeUndefined()

      // 2. type mode
      const typeActions = buildEntryActions(emptyPwEntry, mockApi, { outputMode: "type", typer: mockTyper, typingDelayMs: 0 })
      expect(typeActions).toHaveLength(2)
      expect(typeActions[0].Name).toBe("模拟键入用户名")
      expect(typeActions[0].IsDefault).toBe(true)
      expect(typeActions[0].Hotkey).toBeUndefined()
      expect(typeActions[1].Name).toBe("打开网址")

      const typeUserAction = typeActions[0] as ExecuteResultAction
      await typeUserAction.Action(dummyCtx, { ResultId: "1", ResultActionId: "type-username", ContextData: {} })
      expect(mockTyper).toHaveBeenCalledWith("test.111@outlook.com")
    })

    test("when username is empty, omits username action", () => {
      const noUserEntry: FlattenedEntry = {
        entry: { fields: new Map([["Password", "secret"]]) } as unknown as kdbxweb.KdbxEntry,
        title: "No User",
        userName: "",
        url: "https://example.com",
        tags: [],
        notes: "",
        group: "Root",
        groupName: "Root"
      }

      const actions = buildEntryActions(noUserEntry, mockApi)
      expect(actions.some(a => a.Name.includes("用户名"))).toBe(false)
    })

    test("calculates fresh TOTP at action execution time rather than closure creation time", async () => {
      const githubEntry = allEntries.find(e => e.title === "Github")!
      const laterTime = 1700000045000 // 45 seconds later, next rotation period

      const actions = buildEntryActions(githubEntry, mockApi, {
        platform: "win32",
        outputMode: "clipboard",
        timestamp: laterTime
      })
      const copyTotpAction = actions.find(a => a.Name === "复制 TOTP") as ExecuteResultAction

      await copyTotpAction.Action(dummyCtx, { ResultId: "1", ResultActionId: "copy-totp", ContextData: {} })
      expect(mockApi.Copy).toHaveBeenCalledWith(dummyCtx, {
        type: "text",
        text: expect.stringMatching(/^\d{6}$/)
      })
    })

    test("when only URL exists, Open URL is the only action and is set to default", () => {
      const mockEntry: FlattenedEntry = {
        entry: { fields: new Map() } as unknown as kdbxweb.KdbxEntry,
        title: "Web Only",
        userName: "",
        url: "https://example.com",
        tags: [],
        notes: "",
        group: "Root",
        groupName: "Root"
      }

      const actions = buildEntryActions(mockEntry, mockApi)
      expect(actions).toHaveLength(1)
      expect(actions[0].Name).toBe("打开网址")
      expect(actions[0].IsDefault).toBe(true)
    })

    test("when entry has no interactive fields, returns empty actions array", () => {
      const emptyEntry: FlattenedEntry = {
        entry: { fields: new Map() } as unknown as kdbxweb.KdbxEntry,
        title: "Empty Entry",
        userName: "",
        url: "",
        tags: [],
        notes: "",
        group: "Root",
        groupName: "Root"
      }

      const actions = buildEntryActions(emptyEntry, mockApi)
      expect(actions).toHaveLength(0)
    })
  })

  describe("Wox Tab Action Panel Registration", () => {
    test("all 5 actions register with distinct names and distinct icons, and omit hardcoded Id", () => {
      const githubEntry = allEntries.find(e => e.title === "Github")!
      const actions: ResultAction[] = buildEntryActions(githubEntry, mockApi)

      expect(actions).toHaveLength(5)

      const names = actions.map(a => a.Name)
      const iconPaths = actions.map(a => a.Icon?.ImageData)

      expect(new Set(names).size).toBe(5)
      expect(new Set(iconPaths).size).toBe(5)

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

      expect(githubActions).toHaveLength(5)
      expect(dropboxActions).toHaveLength(2)

      const githubOpenUrl = githubActions.find(a => a.Name === "打开网址") as ExecuteResultAction
      const dropboxOpenUrl = dropboxActions.find(a => a.Name === "打开网址") as ExecuteResultAction
      const githubCopyTotp = githubActions.find(a => a.Name === "复制 TOTP") as ExecuteResultAction

      // 1. Open URL isolation: Github vs Dropbox
      await githubOpenUrl.Action(dummyCtx, { ResultId: "g", ResultActionId: "act-g", ContextData: {} })
      expect(mockOpener).toHaveBeenCalledWith("https://github.com")

      await dropboxOpenUrl.Action(dummyCtx, { ResultId: "d", ResultActionId: "act-d", ContextData: {} })
      expect(mockOpener).toHaveBeenCalledWith("https://www.dropbox.com")

      // 2. TOTP isolation: Github (has TOTP) vs Dropbox (no TOTP action)
      await githubCopyTotp.Action(dummyCtx, { ResultId: "g", ResultActionId: "act-g", ContextData: {} })
      expect(mockApi.Copy).toHaveBeenCalledWith(dummyCtx, {
        type: "text",
        text: expect.stringMatching(/^\d{6}$/)
      })

      expect(dropboxActions.some(a => a.Name.includes("TOTP"))).toBe(false)
      expect(dropboxActions.some(a => a.Name.includes("密码"))).toBe(false)
    })
  })

  describe("Search & Plugin Integration", () => {
    test("searchEntries attaches actions dynamically, with 5 actions on full-field Github entry", () => {
      const results = searchEntries(db, "Github", mockApi)
      expect(results.length).toBeGreaterThan(0)

      const githubResult = results.find(r => r.Title === "Github")
      expect(githubResult).toBeDefined()
      expect(githubResult!.Actions).toBeDefined()
      expect(githubResult!.Actions).toHaveLength(5)
      expect(githubResult!.Actions![0].IsDefault).toBe(true)
      expect(githubResult!.Actions![0].Name).toBe("复制密码")
      expect(githubResult!.Actions![1].Name).toBe("模拟键入密码")
      expect(githubResult!.Actions![2].Name).toBe("复制用户名")
      expect(githubResult!.Actions![3].Name).toBe("复制 TOTP")
      expect(githubResult!.Actions![4].Name).toBe("打开网址")
    })

    test("plugin.query returns results with functional actions when unlocked, and reflects outputMode", async () => {
      let settingChangedCb: ((_ctx: Context, key: string, value: string) => void) | undefined

      const interactiveMockApi = {
        ...mockApi,
        OnSettingChanged: jest.fn().mockImplementation(async (_ctx: Context, cb: (_ctx: Context, key: string, value: string) => void) => {
          settingChangedCb = cb
        })
      } as unknown as PublicAPI

      await plugin.init(dummyCtx, {
        PluginDirectory: "",
        API: interactiveMockApi
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

      // 1. Query entries under default clipboard mode
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
      expect(firstResult.Actions).toHaveLength(5)
      expect(firstResult.Actions![0].Name).toBe("复制密码")

      // Test default action
      const defaultAction = firstResult.Actions![0] as ExecuteResultAction
      await defaultAction.Action(dummyCtx, { ResultId: "1", ResultActionId: "copy-password", ContextData: {} })
      expect(interactiveMockApi.Copy).toHaveBeenCalledWith(dummyCtx, {
        type: "text",
        text: "Sh~vL4~peCKiJEL4"
      })

      // 2. Change outputMode setting to "type" and query again
      if (settingChangedCb) {
        settingChangedCb(dummyCtx, "outputMode", "type")
      }

      const resType = await plugin.query(dummyCtx, searchQuery)
      const searchResultsType = Array.isArray(resType) ? resType : resType.Results
      const firstResultType = searchResultsType[0]
      expect(firstResultType.Actions).toHaveLength(5)
      expect(firstResultType.Actions![0].Name).toBe("模拟键入密码")
      expect(firstResultType.Actions![0].IsDefault).toBe(true)
      expect(firstResultType.Actions![1].Name).toBe("复制密码")
      expect(firstResultType.Actions![1].Hotkey).toBe(process.platform === "darwin" ? "cmd+c" : "ctrl+c")
    })
  })
})
