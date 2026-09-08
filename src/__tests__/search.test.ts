import path from "path"
import fs from "fs"
import * as kdbxweb from "kdbxweb"
import { Context, PublicAPI, Query, WoxImage, ExecuteResultAction } from "@wox-launcher/wox-plugin"
import { setupArgon2 } from "../crypto"
import { getStandardIconPath, getCustomIconDataUri, resolveEntryIcon } from "../icons"
import { searchEntries, getAllEntries, calculateRelevanceScore, calculateFieldCompletenessScore, FlattenedEntry } from "../search"
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
      expect(tagResults.length).toBeGreaterThanOrEqual(1)
      expect(tagResults.some(r => r.Title === "DeepSeek - main - 副本")).toBe(true)
      expect(tagResults[0].Preview?.PreviewData).toContain("- **标签**:")

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
      expect(results.length).toBeGreaterThanOrEqual(1)
      expect(results.some(r => r.Title === "DeepSeek - main - 副本")).toBe(true)
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
      const exactScore = calculateRelevanceScore(githubExact, "Github", exactTokens)
      expect(exactScore).toBe(100 + calculateFieldCompletenessScore(githubExact))

      // Title prefix match
      const prefixScore = calculateRelevanceScore(githubPrefix, "Github", exactTokens)
      expect(prefixScore).toBe(90 + calculateFieldCompletenessScore(githubPrefix))

      // Title substring match
      const subTokens = tokenizeQuery("main")
      const subScore = calculateRelevanceScore(deepseekEntry, "main", subTokens)
      expect(subScore).toBe(80 + calculateFieldCompletenessScore(deepseekEntry))

      // UserName / URL match
      const userTokens = tokenizeQuery("user111")
      const userScore = calculateRelevanceScore(githubExact, "user111", userTokens)
      expect(userScore).toBe(60 + calculateFieldCompletenessScore(githubExact))

      // Tags / Notes match
      const noteTokens = tokenizeQuery("森森森")
      const noteScore = calculateRelevanceScore(notesEntry, "森森森", noteTokens)
      expect(noteScore).toBe(40 + calculateFieldCompletenessScore(notesEntry))

      // Verify strict ordering across match tiers on fixture entries
      expect(exactScore).toBeGreaterThan(prefixScore)
      expect(prefixScore).toBeGreaterThan(subScore)
      expect(subScore).toBeGreaterThan(userScore)
      expect(userScore).toBeGreaterThan(noteScore)
    })

    test("ranks exact Title match before prefix match in search results", () => {
      const results = searchEntries(db, "Github")
      expect(results.length).toBeGreaterThanOrEqual(2)
      expect(results[0].Title).toBe("Github")
      expect(results[1].Title).toBe("Github - 副本")
      expect(results[0].Score!).toBeGreaterThan(results[1].Score!)
    })
  })

  describe("Field Completeness Scoring & Tier Preservation (Issue #10)", () => {
    function createMockEntry(overrides: Partial<FlattenedEntry> = {}, fieldsMap?: Record<string, string>): FlattenedEntry {
      const mockKdbxEntry = {
        fields: new Map<string, string | kdbxweb.ProtectedValue>()
      } as unknown as kdbxweb.KdbxEntry

      if (fieldsMap) {
        for (const [key, val] of Object.entries(fieldsMap)) {
          mockKdbxEntry.fields.set(key, val)
        }
      }

      return {
        entry: mockKdbxEntry,
        title: "Test Title",
        userName: "",
        url: "",
        tags: [],
        notes: "",
        group: "Root",
        groupName: "Root",
        ...overrides
      }
    }

    test("scores 0 bonus when all 6 fields are empty or invalid", () => {
      const entry = createMockEntry({
        userName: "   ",
        url: "",
        notes: "",
        tags: []
      })
      expect(calculateFieldCompletenessScore(entry)).toBe(0)
    })

    test("scores +1 for each valid field independently and up to +6 when all valid", () => {
      // 1. userName only
      const userEntry = createMockEntry({ userName: "admin" })
      expect(calculateFieldCompletenessScore(userEntry)).toBe(1)

      // 2. password only
      const passEntry = createMockEntry({}, { Password: "secretPassword123" })
      expect(calculateFieldCompletenessScore(passEntry)).toBe(1)

      // 3. url only
      const urlEntry = createMockEntry({ url: "https://example.com" })
      expect(calculateFieldCompletenessScore(urlEntry)).toBe(1)

      // 4. notes only
      const notesEntry = createMockEntry({ notes: "some important notes" })
      expect(calculateFieldCompletenessScore(notesEntry)).toBe(1)

      // 5. tags only
      const tagsEntry = createMockEntry({ tags: ["dev", "work"] })
      expect(calculateFieldCompletenessScore(tagsEntry)).toBe(1)

      // 6. otp only (valid KeePassXC TOTP URI)
      const otpEntry = createMockEntry({}, { otp: "otpauth://totp/KeePass:test?secret=JBSWY3DPEHPK3PXP&period=30" })
      expect(calculateFieldCompletenessScore(otpEntry)).toBe(1)

      // Invalid otp format should not score
      const invalidOtpEntry = createMockEntry({}, { otp: "invalid_secret_token" })
      expect(calculateFieldCompletenessScore(invalidOtpEntry)).toBe(0)

      // All 6 fields valid
      const fullEntry = createMockEntry(
        {
          userName: "admin",
          url: "https://example.com",
          notes: "some notes",
          tags: ["admin"]
        },
        {
          Password: "secretPassword123",
          otp: "otpauth://totp/KeePass:test?secret=JBSWY3DPEHPK3PXP&period=30"
        }
      )
      expect(calculateFieldCompletenessScore(fullEntry)).toBe(6)
    })

    test("maintains strict tier hierarchy across all completeness ranges (100 > 96, 90 > 86, 80 > 66, 60 > 46)", () => {
      // Tier 1: Title Exact match (Base 100) -> range [100, 106]
      // Tier 2: Title Prefix match (Base 90) -> range [90, 96]
      // Tier 3: Title Substring match (Base 80) -> range [80, 86]
      // Tier 4: UserName / URL match (Base 60) -> range [60, 66]
      // Tier 5: Tags / Notes match (Base 40) -> range [40, 46]

      const minExactEntry = createMockEntry({ title: "Github" }) // 0 fields -> score 100
      const maxPrefixEntry = createMockEntry(
        { title: "Github Pro", userName: "user", url: "https://gh.com", notes: "note", tags: ["tag"] },
        { Password: "pass", otp: "otpauth://totp/test?secret=JBSWY3DPEHPK3PXP" }
      ) // 6 fields -> score 96
      const minPrefixEntry = createMockEntry({ title: "Github Pro" }) // 0 fields -> score 90
      const maxSubEntry = createMockEntry(
        { title: "My Github Pro", userName: "user", url: "https://gh.com", notes: "note", tags: ["tag"] },
        { Password: "pass", otp: "otpauth://totp/test?secret=JBSWY3DPEHPK3PXP" }
      ) // 6 fields -> score 86
      const minSubEntry = createMockEntry({ title: "My Github Pro" }) // 0 fields -> score 80
      const maxUserEntry = createMockEntry(
        { title: "Work Item", userName: "github", url: "https://gh.com", notes: "note", tags: ["tag"] },
        { Password: "pass", otp: "otpauth://totp/test?secret=JBSWY3DPEHPK3PXP" }
      ) // 6 fields -> score 66
      const minUserEntry = createMockEntry({ title: "Work Item", userName: "github" }) // 1 field (userName) -> score 61
      const maxNotesEntry = createMockEntry(
        { title: "Secret", userName: "user", url: "https://x.com", notes: "github secret", tags: ["tag"] },
        { Password: "pass", otp: "otpauth://totp/test?secret=JBSWY3DPEHPK3PXP" }
      ) // 6 fields -> score 46

      const tokens = tokenizeQuery("Github")

      const scoreMinExact = calculateRelevanceScore(minExactEntry, "Github", tokens)
      const scoreMaxPrefix = calculateRelevanceScore(maxPrefixEntry, "Github", tokens)
      const scoreMinPrefix = calculateRelevanceScore(minPrefixEntry, "Github", tokens)
      const scoreMaxSub = calculateRelevanceScore(maxSubEntry, "Github", tokens)
      const scoreMinSub = calculateRelevanceScore(minSubEntry, "Github", tokens)
      const scoreMaxUser = calculateRelevanceScore(maxUserEntry, "Github", tokens)
      const scoreMinUser = calculateRelevanceScore(minUserEntry, "Github", tokens)
      const scoreMaxNotes = calculateRelevanceScore(maxNotesEntry, "Github", tokens)

      expect(scoreMinExact).toBe(100)
      expect(scoreMaxPrefix).toBe(96)
      expect(scoreMinExact).toBeGreaterThan(scoreMaxPrefix) // 100 > 96

      expect(scoreMinPrefix).toBe(90)
      expect(scoreMaxSub).toBe(86)
      expect(scoreMinPrefix).toBeGreaterThan(scoreMaxSub) // 90 > 86

      expect(scoreMinSub).toBe(80)
      expect(scoreMaxUser).toBe(66)
      expect(scoreMinSub).toBeGreaterThan(scoreMaxUser) // 80 > 66

      expect(scoreMinUser).toBe(61) // base 60 + userName 1
      expect(scoreMaxNotes).toBe(46)
      expect(scoreMinUser).toBeGreaterThan(scoreMaxNotes) // 61 > 46
    })

    test("ranks entries with higher completeness first within the same match tier in searchEntries", () => {
      // Both entries match substring "auth"
      const entryRich = createMockEntry(
        { title: "my auth service", userName: "admin", url: "https://auth.internal", notes: "prod", tags: ["sso"] },
        { Password: "pwd", otp: "otpauth://totp/test?secret=JBSWY3DPEHPK3PXP" }
      ) // 6 fields -> substring match score 80 + 6 = 86
      const entrySparse = createMockEntry({ title: "my auth gateway" }) // 0 fields -> substring match score 80 + 0 = 80

      const tokens = tokenizeQuery("auth")
      const richScore = calculateRelevanceScore(entryRich, "auth", tokens)
      const sparseScore = calculateRelevanceScore(entrySparse, "auth", tokens)

      expect(richScore).toBe(86)
      expect(sparseScore).toBe(80)
      expect(richScore).toBeGreaterThan(sparseScore)

      // End-to-end ranking via searchEntries with a memory database
      const memoryDb = kdbxweb.Kdbx.create(new kdbxweb.Credentials(kdbxweb.ProtectedValue.fromString("pwd")), "Test")
      const group = memoryDb.getDefaultGroup()
      const kdbxEntrySparse = memoryDb.createEntry(group)
      kdbxEntrySparse.fields.set("Title", "my auth gateway")

      const kdbxEntryRich = memoryDb.createEntry(group)
      kdbxEntryRich.fields.set("Title", "my auth service")
      kdbxEntryRich.fields.set("UserName", "admin")
      kdbxEntryRich.fields.set("Password", kdbxweb.ProtectedValue.fromString("pwd"))
      kdbxEntryRich.fields.set("URL", "https://auth.internal")
      kdbxEntryRich.fields.set("Notes", "prod")
      kdbxEntryRich.tags = ["sso"]
      kdbxEntryRich.fields.set("otp", "otpauth://totp/test?secret=JBSWY3DPEHPK3PXP")

      const searchResults = searchEntries(memoryDb, "auth")
      expect(searchResults).toHaveLength(2)
      expect(searchResults[0].Title).toBe("my auth service")
      expect(searchResults[0].Score).toBe(86)
      expect(searchResults[1].Title).toBe("my auth gateway")
      expect(searchResults[1].Score).toBe(80)
    })

    test("breaks ties deterministically by title, then by userName via searchEntries", () => {
      const memoryDb = kdbxweb.Kdbx.create(new kdbxweb.Credentials(kdbxweb.ProtectedValue.fromString("pwd")), "Test")
      const group = memoryDb.getDefaultGroup()

      // Entry 1: Beta, user "a-user"
      const entry1 = memoryDb.createEntry(group)
      entry1.fields.set("Title", "Beta Entry")
      entry1.fields.set("UserName", "a-user")

      // Entry 2: Alpha, user "z-user"
      const entry2 = memoryDb.createEntry(group)
      entry2.fields.set("Title", "Alpha Entry")
      entry2.fields.set("UserName", "z-user")

      // Entry 3: Alpha, user "a-user"
      const entry3 = memoryDb.createEntry(group)
      entry3.fields.set("Title", "Alpha Entry")
      entry3.fields.set("UserName", "a-user")

      const results = searchEntries(memoryDb, "Entry")
      expect(results).toHaveLength(3)

      // All 3 have identical score (80 substring + 1 userName = 81)
      expect(results[0].Score).toBe(81)
      expect(results[1].Score).toBe(81)
      expect(results[2].Score).toBe(81)

      // Deterministic order: Alpha (a-user) -> Alpha (z-user) -> Beta (a-user)
      expect(results[0].Title).toBe("Alpha Entry")
      expect(results[0].SubTitle).toBe("a-user")

      expect(results[1].Title).toBe("Alpha Entry")
      expect(results[1].SubTitle).toBe("z-user")

      expect(results[2].Title).toBe("Beta Entry")
      expect(results[2].SubTitle).toBe("a-user")
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
        Notify: jest.fn().mockResolvedValue(undefined),
        ShowToolbarMsg: jest.fn().mockResolvedValue(undefined),
        ClearToolbarMsg: jest.fn().mockResolvedValue(undefined)
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
      expect(results[0].Score).toBe(100 + calculateFieldCompletenessScore(getAllEntries(db).find(e => e.title === "Github")!))

      expect(results[1].Title).toBe("Github - 副本")
      expect(results[1].SubTitle).toBe("user111")
      expect(results[1].Score).toBe(90 + calculateFieldCompletenessScore(getAllEntries(db).find(e => e.title === "Github - 副本")!))

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
