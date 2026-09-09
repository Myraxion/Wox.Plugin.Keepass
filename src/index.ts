import { Context, Plugin, PluginInitParams, PublicAPI, Query, QueryReturn, Result } from "@wox-launcher/wox-plugin"
import { setupArgon2 } from "./crypto"
import * as session from "./session"
import { searchEntriesWithDetails } from "./search"
import { startTotpTicker, stopTotpTicker } from "./ticker"
import { extractUrlHostname } from "./url"
import { initI18n, t } from "./i18n"

let currentQueryId = 0

interface PluginConfig {
  kdbxFilePath: string
  keyFilePath: string
  autoLockTimeout: number
  excludeRules: string
  outputMode: "clipboard" | "type"
}

let api: PublicAPI

const config: PluginConfig = {
  kdbxFilePath: "",
  keyFilePath: "",
  autoLockTimeout: 900,
  excludeRules: "",
  outputMode: "clipboard"
}

function getUnconfiguredMarkdown(): string {
  return t("unconfigured_markdown")
}

let toolbarClearTimer: NodeJS.Timeout | null = null

async function showTransientToolbarMsg(actionCtx: Context, msgId: string, title: string, durationMs: number = 2500): Promise<void> {
  if (toolbarClearTimer) {
    clearTimeout(toolbarClearTimer)
    toolbarClearTimer = null
  }

  await api.Notify(actionCtx, title)

  if (api.ShowToolbarMsg) {
    await api.ShowToolbarMsg(actionCtx, {
      Id: msgId,
      Title: title,
      Icon: {
        ImageType: "relative",
        ImageData: "icons/app.svg"
      }
    })
  }

  if (api.ClearToolbarMsg) {
    toolbarClearTimer = setTimeout(async () => {
      try {
        if (api.ClearToolbarMsg) {
          await api.ClearToolbarMsg(actionCtx, msgId)
        }
      } catch {
        // ignore
      }
      toolbarClearTimer = null
    }, durationMs)
    if (toolbarClearTimer.unref) {
      toolbarClearTimer.unref()
    }
  }
}

export const plugin: Plugin = {
  init: async (ctx: Context, initParams: PluginInitParams) => {
    api = initParams.API
    setupArgon2()
    await initI18n(api, ctx)

    const [kdbxFilePath, keyFilePath, autoLockTimeout, excludeRules, outputMode] = await Promise.all([
      api.GetSetting(ctx, "kdbxFilePath"),
      api.GetSetting(ctx, "keyFilePath"),
      api.GetSetting(ctx, "autoLockTimeout"),
      api.GetSetting(ctx, "excludeRules"),
      api.GetSetting(ctx, "outputMode")
    ])

    config.kdbxFilePath = kdbxFilePath || ""
    config.keyFilePath = keyFilePath || ""
    const parsedTimeout = parseInt(autoLockTimeout, 10)
    config.autoLockTimeout = isNaN(parsedTimeout) ? 900 : Math.max(0, parsedTimeout)
    config.excludeRules = excludeRules || ""
    config.outputMode = outputMode === "type" ? "type" : "clipboard"

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
        case "outputMode":
          config.outputMode = value === "type" ? "type" : "clipboard"
          break
      }
    })

    if (api.OnLeavePluginQuery) {
      await api.OnLeavePluginQuery(ctx, () => {
        stopTotpTicker()
      })
    }

    if (api.OnUnload) {
      await api.OnUnload(ctx, async () => {
        stopTotpTicker()
      })
    }

    session.onLock(() => {
      stopTotpTicker()
    })

    await api.Log(ctx, "Info", "KeePass plugin initialized")
  },

  query: async (_ctx: Context, query: Query): Promise<QueryReturn> => {
    currentQueryId++
    const queryId = currentQueryId
    stopTotpTicker()

    if (!config.kdbxFilePath || config.kdbxFilePath.trim() === "") {
      return {
        Results: [
          {
            Title: t("unconfigured_title"),
            SubTitle: t("unconfigured_subtitle"),
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

    if (query.Type === "selection") {
      const selectedText = query.Selection?.Type === "text" ? query.Selection.Text : ""
      const hostname = extractUrlHostname(selectedText)
      if (!hostname) {
        return { Results: [] }
      }

      if (!session.isUnlocked()) {
        return {
          Results: [
            {
              Title: t("db_locked_title"),
              SubTitle: t("selection_locked_subtitle"),
              Icon: {
                ImageType: "relative",
                ImageData: "icons/app.svg"
              }
            }
          ]
        }
      }

      session.touchActivity()
      const db = session.getDatabase()
      if (!db) {
        return { Results: [] }
      }

      const searchPattern = `url:"${hostname}"`
      const { results, totpEntries } = searchEntriesWithDetails(db, searchPattern, api, {
        excludeRules: config.excludeRules,
        outputMode: config.outputMode
      })
      if (totpEntries.length > 0) {
        startTotpTicker(_ctx, api, queryId, totpEntries)
      }
      const pluginAppIcon = {
        ImageType: "relative" as const,
        ImageData: "icons/app.svg"
      }
      return {
        Results: results.map(item => ({
          ...item,
          Icon: pluginAppIcon
        }))
      }
    }

    const triggerPrefix = query.TriggerKeyword ? `${query.TriggerKeyword} ` : "kp "

    const performUnlock = async (actionCtx: Context) => {
      const toolbarMsgId = "keepass-unlock"
      if (toolbarClearTimer) {
        clearTimeout(toolbarClearTimer)
        toolbarClearTimer = null
      }

      const password = query.Search.trim()
      if (!password) {
        await showTransientToolbarMsg(actionCtx, toolbarMsgId, t("msg_enter_password"))
        return
      }

      if (api.ShowToolbarMsg) {
        await api.ShowToolbarMsg(actionCtx, {
          Id: toolbarMsgId,
          Title: t("msg_unlocking"),
          Icon: {
            ImageType: "relative",
            ImageData: "icons/app.svg"
          },
          Indeterminate: true
        })
      }
      try {
        await session.unlock(config.kdbxFilePath, config.keyFilePath, password, config.autoLockTimeout)
        await showTransientToolbarMsg(actionCtx, toolbarMsgId, t("msg_unlock_success"))
        await api.ChangeQuery(actionCtx, {
          QueryType: "input",
          QueryText: triggerPrefix
        })
        await api.Log(actionCtx, "Info", "KeePass database unlocked successfully")
      } catch {
        await showTransientToolbarMsg(actionCtx, toolbarMsgId, t("msg_unlock_failed"))
      }
    }

    if (!session.isUnlocked()) {
      return {
        Results: [
          {
            Title: t("db_locked_title"),
            SubTitle: t("db_locked_subtitle"),
            Icon: {
              ImageType: "relative",
              ImageData: "icons/app.svg"
            },
            Actions: [
              {
                Name: t("action_unlock"),
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

    const searchTrimmed = query.Search.trim()
    const { results: searchResults, totpEntries } = searchEntriesWithDetails(db, query.Search, api, {
      excludeRules: config.excludeRules,
      outputMode: config.outputMode
    })
    if (totpEntries.length > 0) {
      startTotpTicker(_ctx, api, queryId, totpEntries)
    }

    if (searchTrimmed.toLowerCase() === "lock") {
      const lockActionItem: Result = {
        Title: t("action_lock_title"),
        SubTitle: t("action_lock_subtitle"),
        Icon: {
          ImageType: "relative",
          ImageData: "icons/app.svg"
        },
        Score: 1000,
        Actions: [
          {
            Name: t("action_lock"),
            IsDefault: true,
            PreventHideAfterAction: true,
            Action: async (actionCtx: Context) => {
              session.lock()
              await showTransientToolbarMsg(actionCtx, "keepass-lock", t("msg_locked"))
              await api.ChangeQuery(actionCtx, {
                QueryType: "input",
                QueryText: triggerPrefix
              })
            }
          }
        ]
      }
      return {
        Results: [lockActionItem, ...searchResults]
      }
    }

    return {
      Results: searchResults
    }
  }
}
