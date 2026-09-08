import { Context, PublicAPI, ResultAction } from "@wox-launcher/wox-plugin"
import { spawn } from "child_process"
import { FlattenedEntry, getFieldText } from "./search"
import { getEntryTotp } from "./totp"
import { t } from "./i18n"

export type UrlOpener = (url: string) => Promise<void> | void

export function getPlatformModifier(platform: string = process.platform): "cmd" | "ctrl" {
  return platform === "darwin" ? "cmd" : "ctrl"
}

export function defaultUrlOpener(url: string, platform: string = process.platform, spawnFn: typeof spawn = spawn): void {
  if (platform === "darwin") {
    spawnFn("open", [url], { detached: true, stdio: "ignore" }).unref()
  } else if (platform === "win32") {
    spawnFn("rundll32.exe", ["url.dll,FileProtocolHandler", url], { detached: true, stdio: "ignore" }).unref()
  } else {
    spawnFn("xdg-open", [url], { detached: true, stdio: "ignore" }).unref()
  }
}

export interface BuildActionsOptions {
  platform?: string
  urlOpener?: UrlOpener
  timestamp?: number
}

export function buildEntryActions(entry: FlattenedEntry, api: PublicAPI, options?: BuildActionsOptions): ResultAction[] {
  const mod = getPlatformModifier(options?.platform)
  const opener = options?.urlOpener || defaultUrlOpener

  return [
    {
      Name: t("action_copy_password"),
      IsDefault: true,
      PreventHideAfterAction: false,
      Icon: {
        ImageType: "relative",
        ImageData: "icons/database/C00_Password.svg"
      },
      Action: async (ctx: Context) => {
        const password = getFieldText(entry.entry.fields.get("Password"))
        await api.Copy(ctx, {
          type: "text",
          text: password
        })
      }
    },
    {
      Name: t("action_copy_username"),
      Hotkey: `${mod}+u`,
      PreventHideAfterAction: false,
      Icon: {
        ImageType: "relative",
        ImageData: "icons/database/C09_Identity.svg"
      },
      Action: async (ctx: Context) => {
        await api.Copy(ctx, {
          type: "text",
          text: entry.userName
        })
      }
    },
    {
      Name: t("action_copy_totp"),
      Hotkey: `${mod}+t`,
      PreventHideAfterAction: false,
      Icon: {
        ImageType: "relative",
        ImageData: "icons/database/C39_History.svg"
      },
      Action: async (ctx: Context) => {
        const otpField = getFieldText(entry.entry.fields.get("otp"))
        const totpInfo = getEntryTotp(otpField, options?.timestamp)
        if (totpInfo) {
          await api.Copy(ctx, {
            type: "text",
            text: totpInfo.token
          })
        } else {
          await api.Notify(ctx, t("msg_no_totp"))
        }
      }
    },
    {
      Name: t("action_open_url"),
      Hotkey: `${mod}+o`,
      PreventHideAfterAction: false,
      Icon: {
        ImageType: "relative",
        ImageData: "icons/database/C16_Mozilla_Firebird.svg"
      },
      Action: async (ctx: Context) => {
        const rawUrl = entry.url ? entry.url.trim() : ""
        if (rawUrl) {
          const targetUrl = /^https?:\/\//i.test(rawUrl) ? rawUrl : `https://${rawUrl}`
          await opener(targetUrl)
        } else {
          await api.Notify(ctx, t("msg_no_url"))
        }
      }
    }
  ]
}
