import path from "path"
import fs from "fs"
import * as kdbxweb from "kdbxweb"
import { setupArgon2 } from "../crypto"
import { parseExcludeRules, ExcludeRule } from "../tokenizer"
import { isEntryExcluded, searchEntries, getAllEntries, FlattenedEntry } from "../search"

describe("Exclusion Rules Parsing and Filtering", () => {
  describe("parseExcludeRules", () => {
    test("returns empty array for empty or whitespace-only strings", () => {
      expect(parseExcludeRules("")).toEqual([])
      expect(parseExcludeRules("   ")).toEqual([])
      expect(parseExcludeRules("\t  \n")).toEqual([])
    })

    test("parses single rule without quotes", () => {
      expect(parseExcludeRules("t:Trash")).toEqual<ExcludeRule[]>([{ type: "t", value: "Trash" }])
      expect(parseExcludeRules("g:Archive")).toEqual<ExcludeRule[]>([{ type: "g", value: "Archive" }])
    })

    test("parses multiple comma-separated rules with double-quoted values", () => {
      const input = 'g:"Recycle Bin", t:Trash'
      expect(parseExcludeRules(input)).toEqual<ExcludeRule[]>([
        { type: "g", value: "Recycle Bin" },
        { type: "t", value: "Trash" }
      ])
    })

    test("supports double-quoted values containing commas and spaces", () => {
      const input = 'g:"Folder, Subfolder", t:"My Tag, Special"'
      expect(parseExcludeRules(input)).toEqual<ExcludeRule[]>([
        { type: "g", value: "Folder, Subfolder" },
        { type: "t", value: "My Tag, Special" }
      ])
    })

    test("strictly ignores rules that do not have t: or g: prefixes", () => {
      const input = 'invalid, u:"admin", g:"Recycle Bin", url:example.com, t:Trash, somethingElse'
      expect(parseExcludeRules(input)).toEqual<ExcludeRule[]>([
        { type: "g", value: "Recycle Bin" },
        { type: "t", value: "Trash" }
      ])
    })

    test("handles case-insensitive prefixes", () => {
      const input = 'T:trash, G:"Recycle Bin"'
      expect(parseExcludeRules(input)).toEqual<ExcludeRule[]>([
        { type: "t", value: "trash" },
        { type: "g", value: "Recycle Bin" }
      ])
    })

    test("trims extra whitespace around commas and values", () => {
      const input = '  g:"Recycle Bin"  ,   t:Trash   '
      expect(parseExcludeRules(input)).toEqual<ExcludeRule[]>([
        { type: "g", value: "Recycle Bin" },
        { type: "t", value: "Trash" }
      ])
    })
  })

  describe("isEntryExcluded", () => {
    const mockEntry: FlattenedEntry = {
      entry: {} as kdbxweb.KdbxEntry,
      title: "Test Entry",
      userName: "user@test.com",
      url: "https://example.com",
      tags: ["Work", "Finance"],
      notes: "some notes",
      group: "Root / Personal / Accounts",
      groupName: "Accounts"
    }

    test("returns false when rules array is empty", () => {
      expect(isEntryExcluded(mockEntry, [])).toBe(false)
    })

    test("excludes entry when tag matches (case-insensitive)", () => {
      const rules: ExcludeRule[] = [{ type: "t", value: "finance" }]
      expect(isEntryExcluded(mockEntry, rules)).toBe(true)

      const nonMatchingRules: ExcludeRule[] = [{ type: "t", value: "Trash" }]
      expect(isEntryExcluded(mockEntry, nonMatchingRules)).toBe(false)
    })

    test("excludes entry when group or group path matches (case-insensitive)", () => {
      const groupMatch: ExcludeRule[] = [{ type: "g", value: "Accounts" }]
      expect(isEntryExcluded(mockEntry, groupMatch)).toBe(true)

      const pathMatch: ExcludeRule[] = [{ type: "g", value: "Personal" }]
      expect(isEntryExcluded(mockEntry, pathMatch)).toBe(true)

      const nonMatchingGroup: ExcludeRule[] = [{ type: "g", value: "Recycle Bin" }]
      expect(isEntryExcluded(mockEntry, nonMatchingGroup)).toBe(false)
    })

    test("excludes entry if any of multiple rules match", () => {
      const mixedRules: ExcludeRule[] = [
        { type: "t", value: "Trash" },
        { type: "g", value: "Personal" }
      ]
      expect(isEntryExcluded(mockEntry, mixedRules)).toBe(true)
    })
  })

  describe("searchEntries with exclusion rules", () => {
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
    })

    test("filters out entries matching excludeRules setting string", () => {
      const unfilteredResults = searchEntries(db, "游戏账号")
      expect(unfilteredResults.length).toBeGreaterThan(0)

      const filteredByTag = searchEntries(db, "游戏账号", undefined, {
        excludeRules: 't:"游戏"'
      })
      expect(filteredByTag.length).toBe(0)

      // Test with an actual group or tag
      const all = getAllEntries(db)
      const target = all.find(e => e.title.includes("游戏账号"))!
      expect(target).toBeDefined()
      const groupToExclude = target.groupName

      const filteredByGroup = searchEntries(db, "游戏账号", undefined, {
        excludeRules: `g:"${groupToExclude}"`
      })
      expect(filteredByGroup.length).toBe(0)
    })
  })
})
