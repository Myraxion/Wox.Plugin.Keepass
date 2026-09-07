import { Context, Plugin, PluginInitParams, PublicAPI, Query, QueryReturn } from "@wox-launcher/wox-plugin"
import { setupArgon2 } from "./crypto"
import * as session from "./session"
import { searchEntries } from "./search"

interface PluginConfig {
  kdbxFilePath: string
  keyFilePath: string
  autoLockTimeout: number
  excludeRules: string
}

let api: PublicAPI

const config: PluginConfig = {
  kdbxFilePath: "",
  keyFilePath: "",
  autoLockTimeout: 900,
  excludeRules: ""
}

function getUnconfiguredMarkdown(): string {
  return [
    "# ⚙️ KeePass 数据库未配置",
    "",
    "当前尚未配置 KeePass 数据库文件路径。",
    "",
    "### 配置步骤：",
    "1. 打开 Wox 设置 -> 插件 -> KeePass",
    "2. 在 **KeePass 数据库路径** (`kdbxFilePath`) 中填入数据库文件的绝对路径",
    "3. （可选）若使用了密钥文件，在 **密钥文件路径** (`keyFilePath`) 中填入密钥文件的绝对路径",
    "4. （可选）调整 **自动锁定超时** (`autoLockTimeout`) 与 **排除规则** (`excludeRules`)",
    "5. 保存设置后，在搜索框中重新输入 `kp` 即可开始使用"
  ].join("\n")
}

export const plugin: Plugin = {
  init: async (ctx: Context, initParams: PluginInitParams) => {
    api = initParams.API
    setupArgon2()

    const [kdbxFilePath, keyFilePath, autoLockTimeout, excludeRules] = await Promise.all([
      api.GetSetting(ctx, "kdbxFilePath"),
      api.GetSetting(ctx, "keyFilePath"),
      api.GetSetting(ctx, "autoLockTimeout"),
      api.GetSetting(ctx, "excludeRules")
    ])

    config.kdbxFilePath = kdbxFilePath || ""
    config.keyFilePath = keyFilePath || ""
    const parsedTimeout = parseInt(autoLockTimeout, 10)
    config.autoLockTimeout = isNaN(parsedTimeout) ? 900 : Math.max(0, parsedTimeout)
    config.excludeRules = excludeRules || ""

    await api.OnSettingChanged(ctx, (_ctx: Context, key: string, value: string) => {
      switch (key) {
        case "kdbxFilePath":
          config.kdbxFilePath = value || ""
          session.lock()
          break
        case "keyFilePath":
          config.keyFilePath = value || ""
          session.lock()
          break
        case "autoLockTimeout": {
          const parsed = parseInt(value, 10)
          config.autoLockTimeout = isNaN(parsed) ? 900 : Math.max(0, parsed)
          session.setAutoLockTimeout(config.autoLockTimeout)
          break
        }
        case "excludeRules":
          config.excludeRules = value || ""
          break
      }
    })

    await api.Log(ctx, "Info", "KeePass plugin initialized")
  },

  query: async (_ctx: Context, query: Query): Promise<QueryReturn> => {
    if (!config.kdbxFilePath || config.kdbxFilePath.trim() === "") {
      return {
        Results: [
          {
            Title: "⚙️ 请先配置 KeePass 数据库路径",
            SubTitle: "请在插件设置中指定数据库文件的绝对路径",
            Icon: {
              ImageType: "relative",
              ImageData: "icons/app.svg"
            },
            Preview: {
              PreviewType: "markdown",
              PreviewData: getUnconfiguredMarkdown()
            }
          }
        ]
      }
    }

    if (session.isUnlocked()) {
      await session.checkMtime()
    }

    const performUnlock = async (actionCtx: Context) => {
      const password = query.Search.trim()
      if (!password) {
        await api.Notify(actionCtx, "请输入主密码")
        return
      }
      const toolbarMsgId = "keepass-unlock"
      if (api.ShowToolbarMsg) {
        await api.ShowToolbarMsg(actionCtx, {
          Id: toolbarMsgId,
          Title: "正在解锁 KeePass 数据库...",
          Icon: {
            ImageType: "relative",
            ImageData: "icons/app.svg"
          },
          Indeterminate: true
        })
      }
      try {
        await session.unlock(config.kdbxFilePath, config.keyFilePath, password, config.autoLockTimeout)
        await api.ChangeQuery(actionCtx, {
          QueryType: "input",
          QueryText: "kp "
        })
        await api.Log(actionCtx, "Info", "KeePass database unlocked successfully")
      } catch {
        await api.Notify(actionCtx, "解锁失败：主密码错误或密钥文件无效")
      } finally {
        if (api.ClearToolbarMsg) {
          await api.ClearToolbarMsg(actionCtx, toolbarMsgId)
        }
      }
    }

    const searchTrimmed = query.Search.trim()
    if (searchTrimmed.toLowerCase() === "lock") {
      session.lock()
      return {
        Results: [
          {
            Title: "🔒 数据库已锁定",
            SubTitle: "输入主密码后按 Enter 解锁",
            Icon: {
              ImageType: "relative",
              ImageData: "icons/app.svg"
            },
            Actions: [
              {
                Name: "解锁",
                IsDefault: true,
                PreventHideAfterAction: true,
                Action: performUnlock
              }
            ]
          }
        ]
      }
    }

    if (!session.isUnlocked()) {
      return {
        Results: [
          {
            Title: "🔒 数据库已锁定",
            SubTitle: "输入主密码后按 Enter 解锁",
            Icon: {
              ImageType: "relative",
              ImageData: "icons/app.svg"
            },
            Actions: [
              {
                Name: "解锁",
                IsDefault: true,
                PreventHideAfterAction: true,
                Action: performUnlock
              }
            ]
          }
        ]
      }
    }

    session.touchActivity()

    const db = session.getDatabase()
    if (!db || !query.Search || query.Search.trim() === "") {
      return {
        Results: []
      }
    }

    return {
      Results: searchEntries(db, query.Search, api, { excludeRules: config.excludeRules })
    }
  }
}
