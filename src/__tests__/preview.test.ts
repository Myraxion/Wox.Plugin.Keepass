import path from "path"
import fs from "fs"
import * as kdbxweb from "kdbxweb"
import { WoxPreviewListData } from "@wox-launcher/wox-plugin"
import { setupArgon2 } from "../crypto"
import { getAllEntries, FlattenedEntry } from "../search"
import { buildEntryPreview, formatPreviewDate } from "../preview"
import { setLocale, getLocale } from "../i18n"

describe("Preview List Pane Generator", () => {
  jest.setTimeout(30000)

  const sampleKdbxPath = path.resolve(__dirname, "../../tests/fixtures/sample-auth.kdbx")
  const sampleKeyxPath = path.resolve(__dirname, "../../tests/fixtures/sample-auth.keyx")
  const password = "9VA%9hfe2MzzaHQp"

  let db: kdbxweb.Kdbx
  let allEntries: FlattenedEntry[]
  const initialLocale = getLocale()

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

  afterEach(() => {
    setLocale(initialLocale)
  })

  describe("Date formatting helper", () => {
    test("formats date correctly", () => {
      const date = new Date(2026, 8, 7, 12, 34, 56) // Month 8 is September
      expect(formatPreviewDate(date)).toBe("2026-09-07 12:34:56")
    })

    test("returns empty string for invalid date", () => {
      expect(formatPreviewDate(undefined)).toBe("")
      expect(formatPreviewDate(new Date("invalid"))).toBe("")
    })
  })

  describe("Entry with TOTP and all fields (Github)", () => {
    test("renders complete native list preview and PreviewTags", () => {
      setLocale("zh_CN")
      const githubEntry = allEntries.find(e => e.title === "Github")
      expect(githubEntry).toBeDefined()

      const fixedTime = 1700000012000 // 28s remaining
      const preview = buildEntryPreview(githubEntry!, fixedTime)

      // Acceptance Criteria 1: PreviewType is "list" and PreviewData is valid JSON
      expect(preview.PreviewType).toBe("list")
      expect(typeof preview.PreviewData).toBe("string")

      const listData = JSON.parse(preview.PreviewData) as WoxPreviewListData
      expect(listData.items).toBeDefined()
      expect(Array.isArray(listData.items)).toBe(true)

      // 1. Username row
      const userItem = listData.items.find(i => i.subtitle === "用户名")
      expect(userItem).toBeDefined()
      expect(userItem?.title).toBe("user111")
      expect(userItem?.icon).toEqual({
        ImageType: "relative",
        ImageData: "icons/database/C09_Identity.svg"
      })

      // 2. Password row (12 bullets mask)
      const passItem = listData.items.find(i => i.subtitle === "密码")
      expect(passItem).toBeDefined()
      expect(passItem?.title).toBe("••••••••••••")
      expect(passItem?.icon).toEqual({
        ImageType: "relative",
        ImageData: "icons/database/C00_Password.svg"
      })

      // 3. TOTP row (dynamic token with remaining seconds in tails)
      const totpItem = listData.items.find(i => i.subtitle === "TOTP")
      expect(totpItem).toBeDefined()
      expect(totpItem?.title).toMatch(/^\d{3} \d{3}$/)
      expect(totpItem?.icon).toEqual({
        ImageType: "relative",
        ImageData: "icons/database/C39_History.svg"
      })
      expect(totpItem?.tails).toEqual([
        {
          Type: "text",
          Text: "28s"
        }
      ])

      // 4. URL row
      const urlItem = listData.items.find(i => i.subtitle === "网址")
      expect(urlItem).toBeDefined()
      expect(urlItem?.title).toBe("github.com")
      expect(urlItem?.icon).toEqual({
        ImageType: "relative",
        ImageData: "icons/database/C16_Mozilla_Firebird.svg"
      })

      // 5. Tags & Notes are correctly omitted when absent on Github entry
      expect(listData.items.find(i => i.subtitle === "标签")).toBeUndefined()
      expect(listData.items.find(i => i.subtitle === "备注")).toBeUndefined()

      // PreviewTags retention
      expect(preview.PreviewTags).toBeDefined()
      const groupTag = preview.PreviewTags?.find(t => t.Tooltip === "分组")
      expect(groupTag).toBeDefined()
      expect(groupTag?.Label).toBe("根群组 / 群组1")

      const modTag = preview.PreviewTags?.find(t => t.Tooltip === "修改时间")
      expect(modTag).toBeDefined()
      expect(modTag?.Label).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/)
    })
  })

  describe("Entry without password or TOTP (Dropbox（通行密钥）)", () => {
    test("handles empty password and absent TOTP cleanly", () => {
      setLocale("zh_CN")
      const dropboxEntry = allEntries.find(e => e.title === "Dropbox（通行密钥）")
      expect(dropboxEntry).toBeDefined()

      const preview = buildEntryPreview(dropboxEntry!)
      expect(preview.PreviewType).toBe("list")

      const listData = JSON.parse(preview.PreviewData) as WoxPreviewListData

      // Acceptance Criteria 2: Username & Password always present
      const userItem = listData.items.find(i => i.subtitle === "用户名")
      expect(userItem).toBeDefined()
      expect(userItem?.title).toBe("test.111@outlook.com")

      const passItem = listData.items.find(i => i.subtitle === "密码")
      expect(passItem).toBeDefined()
      expect(passItem?.title).toBe("(无)")

      // Acceptance Criteria 3: TOTP is hidden when absent
      const totpItem = listData.items.find(i => i.subtitle === "TOTP")
      expect(totpItem).toBeUndefined()

      // URL row is present
      const urlItem = listData.items.find(i => i.subtitle === "网址")
      expect(urlItem).toBeDefined()
      expect(urlItem?.title).toBe("https://www.dropbox.com")
    })
  })

  describe("Entry with absent username and empty optional fields", () => {
    test("shows placeholder for username and omits empty optional rows", () => {
      setLocale("zh_CN")
      // Create a mock entry with empty username, password, url, notes, tags
      const mockRawEntry = {
        fields: new Map([["Title", "Mock Bare Entry"]]),
        times: {}
      } as unknown as kdbxweb.KdbxEntry

      const bareEntry: FlattenedEntry = {
        title: "Mock Bare Entry",
        userName: "",
        url: "",
        notes: "",
        tags: [],
        group: "Mock Group",
        groupName: "Mock Group",
        entry: mockRawEntry
      }

      const preview = buildEntryPreview(bareEntry)
      const listData = JSON.parse(preview.PreviewData) as WoxPreviewListData

      // Username & Password are always present with placeholders
      expect(listData.items.length).toBe(2)
      expect(listData.items[0]).toEqual({
        icon: {
          ImageType: "relative",
          ImageData: "icons/database/C09_Identity.svg"
        },
        title: "(无)",
        subtitle: "用户名"
      })
      expect(listData.items[1]).toEqual({
        icon: {
          ImageType: "relative",
          ImageData: "icons/database/C00_Password.svg"
        },
        title: "(无)",
        subtitle: "密码"
      })
    })
  })

  describe("Entry with multiline notes (222)", () => {
    test("renders notes item with trimmed content and C44_KNotes icon", () => {
      setLocale("zh_CN")
      const notesEntry = allEntries.find(e => e.title === "222")
      expect(notesEntry).toBeDefined()

      const preview = buildEntryPreview(notesEntry!)
      const listData = JSON.parse(preview.PreviewData) as WoxPreviewListData

      const notesItem = listData.items.find(i => i.subtitle === "备注")
      expect(notesItem).toBeDefined()
      expect(notesItem?.title).toBe(notesEntry!.notes.trim())
      expect(notesItem?.icon).toEqual({
        ImageType: "relative",
        ImageData: "icons/database/C44_KNotes.svg"
      })
    })
  })

  describe("Entry with tags", () => {
    test("renders tags row when entry has tags", () => {
      setLocale("zh_CN")
      const taggedEntry = allEntries.find(e => e.tags && e.tags.length > 0)
      expect(taggedEntry).toBeDefined()

      const preview = buildEntryPreview(taggedEntry!)
      const listData = JSON.parse(preview.PreviewData) as WoxPreviewListData

      const tagsItem = listData.items.find(i => i.subtitle === "标签")
      expect(tagsItem).toBeDefined()
      expect(tagsItem?.title).toBe(taggedEntry!.tags.join(", "))
      expect(tagsItem?.icon).toEqual({
        ImageType: "relative",
        ImageData: "icons/database/C23_Icons.svg"
      })
    })

    test("does not render tags row when entry has no tags", () => {
      setLocale("zh_CN")
      const untaggedEntry = allEntries.find(e => !e.tags || e.tags.length === 0)
      expect(untaggedEntry).toBeDefined()

      const preview = buildEntryPreview(untaggedEntry!)
      const listData = JSON.parse(preview.PreviewData) as WoxPreviewListData

      const tagsItem = listData.items.find(i => i.subtitle === "标签")
      expect(tagsItem).toBeUndefined()
    })
  })

  describe("Bilingual localization support", () => {
    test("renders English subtitles and placeholders under en_US locale", () => {
      setLocale("en_US")
      // Test with entry containing all 6 fields
      const mockFullEntry: FlattenedEntry = {
        title: "Full Entry",
        userName: "user_test",
        url: "https://example.com",
        notes: "Some notes",
        tags: ["tag1", "tag2"],
        group: "Group 1",
        groupName: "Group 1",
        entry: {
          fields: new Map([
            ["Password", "mypass"],
            ["otp", "otpauth://totp/Test:user?secret=JBSWY3DPEHPK3PXP&period=30"]
          ]),
          times: {}
        } as unknown as kdbxweb.KdbxEntry
      }

      const fullPreview = buildEntryPreview(mockFullEntry)
      const fullListData = JSON.parse(fullPreview.PreviewData) as WoxPreviewListData

      const subtitles = fullListData.items.map(i => i.subtitle)
      expect(subtitles).toEqual(["Username", "Password", "TOTP", "URL", "Tags", "Notes"])

      // Empty field placeholder under en_US
      const mockBareEntry: FlattenedEntry = {
        title: "Bare",
        userName: "",
        url: "",
        notes: "",
        tags: [],
        group: "",
        groupName: "",
        entry: { fields: new Map(), times: {} } as unknown as kdbxweb.KdbxEntry
      }
      const barePreview = buildEntryPreview(mockBareEntry)
      const bareListData = JSON.parse(barePreview.PreviewData) as WoxPreviewListData
      expect(bareListData.items[0].title).toBe("(None)")
      expect(bareListData.items[0].subtitle).toBe("Username")
      expect(bareListData.items[1].title).toBe("(None)")
      expect(bareListData.items[1].subtitle).toBe("Password")
    })
  })
})
