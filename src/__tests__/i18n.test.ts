import fs from "fs"
import path from "path"
import { Context, PublicAPI } from "@wox-launcher/wox-plugin"
import { t, tAsync, setLocale, getLocale, setApi, initI18n, formatString } from "../i18n"

describe("i18n Externalized Bilingual Localization", () => {
  const dummyCtx = {} as Context
  const initialLocale = getLocale()

  afterEach(() => {
    setLocale(initialLocale)
    setApi(null)
  })

  describe("Language Pack Structural Integrity", () => {
    const zhPath = path.resolve(__dirname, "../../lang/zh_CN.json")
    const enPath = path.resolve(__dirname, "../../lang/en_US.json")
    const manifestPath = path.resolve(__dirname, "../../plugin.json")

    test("both zh_CN.json and en_US.json exist and are valid JSON", () => {
      expect(fs.existsSync(zhPath)).toBe(true)
      expect(fs.existsSync(enPath)).toBe(true)

      const zh = JSON.parse(fs.readFileSync(zhPath, "utf-8"))
      const en = JSON.parse(fs.readFileSync(enPath, "utf-8"))

      expect(zh._locale).toBe("zh_CN")
      expect(en._locale).toBe("en_US")
    })

    test("zh_CN and en_US have identical sets of keys", () => {
      const zh = JSON.parse(fs.readFileSync(zhPath, "utf-8"))
      const en = JSON.parse(fs.readFileSync(enPath, "utf-8"))

      const zhKeys = Object.keys(zh).sort()
      const enKeys = Object.keys(en).sort()

      expect(zhKeys).toEqual(enKeys)
    })

    test("all i18n keys referenced in plugin.json are defined in language packs", () => {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"))
      const en = JSON.parse(fs.readFileSync(enPath, "utf-8"))

      const manifestStr = JSON.stringify(manifest)
      const i18nRegex = /i18n:([a-zA-Z0-9_-]+)/g
      let match: RegExpExecArray | null
      const matchedKeys: string[] = []

      while ((match = i18nRegex.exec(manifestStr)) !== null) {
        matchedKeys.push(match[1])
      }

      expect(matchedKeys.length).toBeGreaterThan(0)
      for (const key of matchedKeys) {
        expect(en[key]).toBeDefined()
        expect(typeof en[key]).toBe("string")
      }
    })
  })

  describe("Synchronous Translation t()", () => {
    test("returns Chinese translation under zh_CN locale", () => {
      setLocale("zh_CN")
      expect(t("db_locked_title")).toBe("🔒 数据库已锁定")
      expect(t("action_copy_password")).toBe("复制密码")
      expect(t("preview_username")).toBe("用户名")
    })

    test("returns English translation under en_US locale", () => {
      setLocale("en_US")
      expect(t("db_locked_title")).toBe("🔒 Database is locked")
      expect(t("action_copy_password")).toBe("Copy Password")
      expect(t("preview_username")).toBe("Username")
    })

    test("supports parameter substitution with {paramName}", () => {
      expect(formatString("Hello, {name}!", { name: "Alice" })).toBe("Hello, Alice!")
      expect(formatString("User {user} has {count} items", { user: "Bob", count: 3 })).toBe("User Bob has 3 items")
    })

    test("gracefully falls back to en_US when key is missing in active locale", () => {
      // 模拟一个未知或缺失特定键的 locale
      setLocale("fr_FR")
      // fr_FR 中没有该键，回退到 en_US
      expect(t("action_copy_password")).toBe("Copy Password")
      expect(t("db_locked_title")).toBe("🔒 Database is locked")
    })

    test("returns raw key if key is missing in both active locale and en_US fallback", () => {
      setLocale("zh_CN")
      expect(t("non_existent_key_12345")).toBe("non_existent_key_12345")
    })
  })

  describe("Dynamic Asynchronous Translation tAsync()", () => {
    test("uses host translation when api.GetTranslation returns valid text", async () => {
      const mockApi = {
        GetTranslation: jest.fn().mockResolvedValue("Host Translated Value")
      } as unknown as PublicAPI

      setApi(mockApi)
      const result = await tAsync("some_key", dummyCtx)
      expect(mockApi.GetTranslation).toHaveBeenCalledWith(dummyCtx, "some_key")
      expect(result).toBe("Host Translated Value")
    })

    test("falls back to local dictionary when api.GetTranslation returns empty or throws", async () => {
      setLocale("zh_CN")
      const mockApi = {
        GetTranslation: jest.fn().mockRejectedValue(new Error("RPC failed"))
      } as unknown as PublicAPI

      setApi(mockApi)
      const result = await tAsync("action_copy_password", dummyCtx)
      expect(result).toBe("复制密码")
    })

    test("falls back to local dictionary when host returns raw i18n prefix", async () => {
      setLocale("en_US")
      const mockApi = {
        GetTranslation: jest.fn().mockResolvedValue("i18n:action_copy_password")
      } as unknown as PublicAPI

      setApi(mockApi)
      const result = await tAsync("action_copy_password", dummyCtx)
      expect(result).toBe("Copy Password")
    })
  })

  describe("Host Locale Auto-Detection via initI18n()", () => {
    test("detects en_US from host GetTranslation(_locale)", async () => {
      setLocale("zh_CN")
      const mockApi = {
        GetTranslation: jest.fn().mockImplementation(async (_ctx: Context, key: string) => {
          if (key === "_locale") return "en_US"
          return ""
        })
      } as unknown as PublicAPI

      await initI18n(mockApi, dummyCtx)
      expect(getLocale()).toBe("en_US")
    })

    test("detects zh_CN from host GetTranslation(_locale)", async () => {
      setLocale("en_US")
      const mockApi = {
        GetTranslation: jest.fn().mockImplementation(async (_ctx: Context, key: string) => {
          if (key === "_locale") return "zh_CN"
          return ""
        })
      } as unknown as PublicAPI

      await initI18n(mockApi, dummyCtx)
      expect(getLocale()).toBe("zh_CN")
    })

    test("retains active locale if GetTranslation(_locale) fails", async () => {
      setLocale("zh_CN")
      const mockApi = {
        GetTranslation: jest.fn().mockRejectedValue(new Error("Network Error"))
      } as unknown as PublicAPI

      await initI18n(mockApi, dummyCtx)
      expect(getLocale()).toBe("zh_CN")
    })
  })
})
