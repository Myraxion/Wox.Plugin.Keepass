import path from "path"
import fs from "fs"
import * as kdbxweb from "kdbxweb"
import { Context, PublicAPI, Query, WoxImage, ExecuteResultAction } from "@wox-launcher/wox-plugin"
import { setupArgon2 } from "../crypto"
import { getStandardIconPath, getCustomIconDataUri, resolveEntryIcon } from "../icons"
import { searchEntries, getAllEntries, calculateRelevanceScore } from "../search"
import { tokenizeQuery } from "../tokenizer"
import * as session from "../session"
import { plugin } from "../index"

describe("Icons & Search Engine", () => {
  jest.setTimeout(30000)

  const sampleKdbxPath = path.resolve(__dirname, "../../tests/fixtures/sample-auth.kdbx")
  const sampleKeyxPath = path.resolve(__dirname, "../../tests/fixtures/sample-auth.keyx")
  const password = "9VA%9hfe2MzzaHQp"

  let db: kdbxweb.Kdbx

  beforeAll(async () => {
    setupArgon2()
    const kdbxData = await fs.promises.readFile(sampleKdbxPath)
    const kdbxBuffer = new Uint8Array(kdbxData).slice().buffer as ArrayBuffer
    const passwordProtected = kdbxweb.ProtectedValue.fromString(password)
    const keyFileBuffer = await fs.promises.readFile(sampleKeyxPath)
    const keyData = new Uint8Array(keyFileBuffer)
    const credentials = new kdbxweb.Credentials(passwordProtected, keyData)
    db = await kdbxweb.Kdbx.load(kdbxBuffer, credentials)
  }, 30000)

  describe("Icon Resolution", () => {
    test("maps standard KeePass icons to bundled SVGs", () => {
      expect(getStandardIconPath(0)).toBe("icons/database/C00_Password.svg")
      expect(getStandardIconPath(13)).toBe("icons/database/C13_KGPG_Key3.svg")
      expect(getStandardIconPath(50)).toBe("icons/database/C50_Folder_Tar.svg")
      expect(getStandardIconPath(undefined)).toBe("icons/database/C00_Password.svg")
      expect(getStandardIconPath(999)).toBe("icons/database/C00_Password.svg")
    })

    test("converts custom icon binary to base64 Data URI in-memory without disk writes", () => {
      // Create a mock PNG buffer
      const pngHeader = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x01, 0x02]).buffer
      const dataUri = getCustomIconDataUri(pngHeader)
      expect(dataUri).toMatch(/^data:image\/png;base64,/)
    })

    test("resolves custom icon for fixture entry with custom icon", () => {
      const entries = getAllEntries(db)
      const entryWithCustomIcon = entries.find(e => e.title === "游戏账号11")
      expect(entryWithCustomIcon).toBeDefined()

      const icon = resolveEntryIcon(entryWithCustomIcon!.entry, db)
      expect(icon.ImageType).toBe("base64")
      expect(icon.ImageData).toMatch(/^data:image\/png;base64,/)
    })

    test("resolves standard icon for fixture entry without custom icon", () => {
      const entries = getAllEntries(db)
      const entryWithStandardIcon = entries.find(e => e.title === "Dropbox（通行密钥）")
      expect(entryWithStandardIcon).toBeDefined()

      const icon = resolveEntryIcon(entryWithStandardIcon!.entry, db)
      expect(icon.ImageType).toBe("relative")
      expect(icon.ImageData).toBe("icons/database/C13_KGPG_Key3.svg")
    })
  })

  describe("Multi-keyword AND Matching & Field Prefixes", () => {
    test("matches entries across Title, UserName, URL, Tags, Notes with plain terms", () => {
      // Match by Title
      const titleResults = searchEntries(db, "Github")
      expect(titleResults.some(r => r.Title === "Github")).toBe(true)
      expect(titleResults.some(r => r.Title === "Github - 副本")).toBe(true)

      // Match by UserName
      const userResults = searchEntries(db, "test.111@outlook.com")
      expect(userResults).toHaveLength(1)
      expect(userResults[0].Title).toBe("Dropbox（通行密钥）")

      // Match by URL
      const urlResults = searchEntries(db, "dropbox.com")
      expect(urlResults).toHaveLength(1)
      expect(urlResults[0].Title).toBe("Dropbox（通行密钥）")

      // Match by Tags
      const tagResults = searchEntries(db, "人工智能")
      expect(tagResults).toHaveLength(1)
      expect(tagResults[0].Title).toBe("DeepSeek - main - 副本")

      // Match by Notes
      const notesResults = searchEntries(db, "森森森")
      expect(notesResults).toHaveLength(1)
      expect(notesResults[0].Title).toBe("222")
    })

    test("supports field prefix u: for UserName", () => {
      const results = searchEntries(db, "u:user111")
      expect(results).toHaveLength(2)
      expect(results.map(r => r.Title).sort()).toEqual(["Github", "Github - 副本"].sort())
    })

    test("supports field prefix url: for URL", () => {
      const results = searchEntries(db, "url:github.com")
      expect(results).toHaveLength(2)
      expect(results.map(r => r.Title).sort()).toEqual(["Github", "Github - 副本"].sort())
    })

    test("supports field prefix t: for Tags and double-quoted values", () => {
      const singleTagResults = searchEntries(db, "t:通行密钥")
      expect(singleTagResults).toHaveLength(1)
      expect(singleTagResults[0].Title).toBe("Dropbox（通行密钥）")

      const quotedTagResults = searchEntries(db, 't:"ni d"')
      expect(quotedTagResults).toHaveLength(2)
      expect(quotedTagResults.map(r => r.Title).sort()).toEqual(["222", "游戏账号11"].sort())
    })

    test("supports field prefix g: for Group path with quotes", () => {
      const results = searchEntries(db, 'g:"子  群组"')
      expect(results).toHaveLength(1)
      expect(results[0].Title).toBe("DeepSeek - main - 副本")
    })

    test("requires all tokens to match (logical AND)", () => {
      // u:user111 matches 2 entries; adding "副本" matches only 1
      const andResults = searchEntries(db, 'u:user111 "副本"')
      expect(andResults).toHaveLength(1)
      expect(andResults[0].Title).toBe("Github - 副本")

      // Multiple tags AND: t:"ni d" AND t:游戏 -> only "游戏账号11"
      const tagsAndResults = searchEntries(db, 't:"ni d" t:游戏')
      expect(tagsAndResults).toHaveLength(1)
      expect(tagsAndResults[0].Title).toBe("游戏账号11")

      // When one term fails to match, returns 0
      const noMatch = searchEntries(db, "Github non_existent_token_xyz")
      expect(noMatch).toHaveLength(0)
    })
  })

  describe("Relevance Scoring & Deterministic Ranking", () => {
    test("prioritizes Title exact match (100) > Title prefix match (90) > Title substring (80) > UserName/URL (60) > Tags/Notes (40)", () => {
      const entries = getAllEntries(db)
      const githubExact = entries.find(e => e.title === "Github")!
      const githubPrefix = entries.find(e => e.title === "Github - 副本")!
      const deepseekEntry = entries.find(e => e.title === "DeepSeek - main - 副本")!
      const notesEntry = entries.find(e => e.title === "222")!

      // Title exact match
      const exactTokens = tokenizeQuery("Github")
      expect(calculateRelevanceScore(githubExact, "Github", exactTokens)).toBe(100)

      // Title prefix match
      expect(calculateRelevanceScore(githubPrefix, "Github", exactTokens)).toBe(90)

      // Title substring match
      const subTokens = tokenizeQuery("main")
      expect(calculateRelevanceScore(deepseekEntry, "main", subTokens)).toBe(80)

      // UserName / URL match
      const userTokens = tokenizeQuery("user111")
      expect(calculateRelevanceScore(githubExact, "user111", userTokens)).toBe(60)

      // Tags / Notes match
      const noteTokens = tokenizeQuery("森森森")
      expect(calculateRelevanceScore(notesEntry, "森森森", noteTokens)).toBe(40)
    })

    test("ranks exact Title match before prefix match in search results", () => {
      const results = searchEntries(db, "Github")
      expect(results.length).toBeGreaterThanOrEqual(2)
      expect(results[0].Title).toBe("Github")
      expect(results[0].Score).toBe(100)
      expect(results[1].Title).toBe("Github - 副本")
      expect(results[1].Score).toBe(90)
    })
  })

  describe("Plugin Query Integration when Unlocked", () => {
    let mockApi: PublicAPI
    const settingsStore: Record<string, string> = {}

    beforeEach(() => {
      session.lock()
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
        OnSettingChanged: jest.fn().mockResolvedValue(undefined),
        ChangeQuery: jest.fn().mockResolvedValue(undefined),
        Notify: jest.fn().mockResolvedValue(undefined)
      } as unknown as PublicAPI
    })

    function createQuery(search = ""): Query {
      return {
        Id: "1",
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
      } as Query
    }

    test("returns empty array for empty search when unlocked", async () => {
      const ctx = {} as Context
      await plugin.init(ctx, {
        PluginDirectory: "",
        API: mockApi
      })

      // Unlock first
      const lockQuery = await plugin.query(ctx, createQuery(password))
      const lockResults = Array.isArray(lockQuery) ? lockQuery : lockQuery.Results
      const action = lockResults[0].Actions?.[0] as ExecuteResultAction
      await action.Action(ctx, { ResultId: "1", ResultActionId: "unlock", ContextData: {} })

      // Query with empty search string
      const emptyResponse = await plugin.query(ctx, createQuery(""))
      const emptyResults = Array.isArray(emptyResponse) ? emptyResponse : emptyResponse.Results
      expect(emptyResults).toEqual([])

      const spaceResponse = await plugin.query(ctx, createQuery("   "))
      const spaceResults = Array.isArray(spaceResponse) ? spaceResponse : spaceResponse.Results
      expect(spaceResults).toEqual([])
    })

    test("returns ranked entries with Title, SubTitle (UserName), and Icon when unlocked", async () => {
      const ctx = {} as Context
      await plugin.init(ctx, {
        PluginDirectory: "",
        API: mockApi
      })

      // Unlock
      const lockQuery = await plugin.query(ctx, createQuery(password))
      const lockResults = Array.isArray(lockQuery) ? lockQuery : lockQuery.Results
      const action = lockResults[0].Actions?.[0] as ExecuteResultAction
      await action.Action(ctx, { ResultId: "1", ResultActionId: "unlock", ContextData: {} })

      // Search "Github"
      const searchResponse = await plugin.query(ctx, createQuery("Github"))
      const results = Array.isArray(searchResponse) ? searchResponse : searchResponse.Results

      expect(results.length).toBeGreaterThanOrEqual(2)
      expect(results[0].Title).toBe("Github")
      expect(results[0].SubTitle).toBe("user111")
      expect(results[0].Icon).toEqual({
        ImageType: "relative",
        ImageData: "icons/database/C00_Password.svg"
      })
      expect(results[0].Score).toBe(100)

      expect(results[1].Title).toBe("Github - 副本")
      expect(results[1].SubTitle).toBe("user111")
      expect(results[1].Score).toBe(90)

      // Preview card validation
      expect(results[0].Preview).toBeDefined()
      expect(results[0].Preview?.PreviewType).toBe("markdown")
      expect(results[0].Preview?.PreviewData).toContain("# Github")
      expect(results[0].Preview?.PreviewData).toContain("- **密码**: ••••••••••••")
      expect(results[0].Preview?.PreviewTags?.some(t => t.Tooltip === "分组")).toBe(true)

      // Tails validation: Github has TOTP, Github - 副本 does not
      expect(results[0].Tails).toBeDefined()
      expect(results[0].Tails?.[0]?.Type).toBe("text")
      expect(results[0].Tails?.[0]?.Text).toMatch(/^\d{3} \d{3} \(\d{1,2}s\)$/)
      expect(results[1].Tails).toBeUndefined()
    })

    test("searchEntries attaches deterministic TOTP countdown badge and preview with timestamp", () => {
      const fixedTime = 1700000012000 // 28s remaining
      const results = searchEntries(db, "Github", fixedTime)

      expect(results.length).toBeGreaterThanOrEqual(2)
      const githubResult = results[0]
      expect(githubResult.Title).toBe("Github")
      expect(githubResult.Tails).toBeDefined()
      expect(githubResult.Tails?.[0]?.Text).toContain("(28s)")

      expect(githubResult.Preview?.PreviewData).toContain("(28s)")
      expect(githubResult.Preview?.PreviewData).toContain("••••••••••••")
    })
  })
})
