import path from "path"
import fs from "fs"
import * as kdbxweb from "kdbxweb"
import { setupArgon2 } from "../crypto"
import { getAllEntries, FlattenedEntry } from "../search"
import { buildEntryPreview, formatPreviewDate } from "../preview"

describe("Preview Card Generator", () => {
  jest.setTimeout(30000)

  const sampleKdbxPath = path.resolve(__dirname, "../../tests/fixtures/sample-auth.kdbx")
  const sampleKeyxPath = path.resolve(__dirname, "../../tests/fixtures/sample-auth.keyx")
  const password = "9VA%9hfe2MzzaHQp"

  let db: kdbxweb.Kdbx
  let allEntries: FlattenedEntry[]

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
    test("renders complete markdown card and PreviewTags", () => {
      const githubEntry = allEntries.find(e => e.title === "Github")
      expect(githubEntry).toBeDefined()

      const fixedTime = 1700000012000 // 28s remaining
      const preview = buildEntryPreview(githubEntry!, fixedTime)

      expect(preview.PreviewType).toBe("markdown")
      // Check Title
      expect(preview.PreviewData).toContain("# Github")
      // Check Username
      expect(preview.PreviewData).toContain("- **用户名**: user111")
      // Check Masked Password (12 bullets)
      expect(preview.PreviewData).toContain("- **密码**: ••••••••••••")
      // Check TOTP token with countdown
      expect(preview.PreviewData).toContain("- **TOTP**: `")
      expect(preview.PreviewData).toContain("(28s)")
      // Check Clickable URL
      expect(preview.PreviewData).toContain("- **网址**: [github.com](https://github.com)")

      // Check PreviewTags
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
      const dropboxEntry = allEntries.find(e => e.title === "Dropbox（通行密钥）")
      expect(dropboxEntry).toBeDefined()

      const preview = buildEntryPreview(dropboxEntry!)

      expect(preview.PreviewType).toBe("markdown")
      expect(preview.PreviewData).toContain("# Dropbox（通行密钥）")
      expect(preview.PreviewData).toContain("- **用户名**: test.111@outlook.com")
      expect(preview.PreviewData).toContain("- **密码**: *(无)*")
      // No TOTP field
      expect(preview.PreviewData).not.toContain("- **TOTP**")
      // URL should be clickable
      expect(preview.PreviewData).toContain("- **网址**: [https://www.dropbox.com](https://www.dropbox.com)")
    })
  })

  describe("Entry with multiline notes (222)", () => {
    test("renders multiline notes under ### 备注 header", () => {
      const notesEntry = allEntries.find(e => e.title === "222")
      expect(notesEntry).toBeDefined()

      const preview = buildEntryPreview(notesEntry!)

      expect(preview.PreviewData).toContain("# 222")
      expect(preview.PreviewData).toContain("### 备注")
      expect(preview.PreviewData).toContain(notesEntry!.notes)
    })
  })
})
