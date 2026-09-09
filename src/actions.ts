import { Context, PublicAPI, ResultAction } from "@wox-launcher/wox-plugin"
import { spawn } from "child_process"
import { FlattenedEntry, getFieldText } from "./search"
import { getEntryTotp } from "./totp"
import { t } from "./i18n"

export type UrlOpener = (url: string) => Promise<void> | void
export type KeystrokeTyper = (text: string) => Promise<void> | void
export type OutputMode = "clipboard" | "type"

export function getPlatformModifier(platform: string = process.platform): "cmd" | "ctrl" {
  return platform === "darwin" ? "cmd" : "ctrl"
}

export function escapeSendKeys(text: string): string {
  return text.replace(/([+^%~{}[\]()])/g, "{$1}")
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

export function defaultKeystrokeTyper(text: string, platform: string = process.platform, spawnFn: typeof spawn = spawn): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    let cmd: string
    let args: string[]
    let payload: string

    if (platform === "win32") {
      cmd = "powershell.exe"
      args = ["-NoProfile", "-NonInteractive", "-Command", "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait([Console]::In.ReadToEnd())"]
      payload = escapeSendKeys(text)
    } else if (platform === "darwin") {
      cmd = "osascript"
      args = [
        "-l",
        "JavaScript",
        "-e",
        "ObjC.import('Foundation'); var data = $.NSFileHandle.fileHandleWithStandardInput.readDataToEndOfFile; var str = $.NSString.alloc.initWithDataEncoding(data, $.NSUTF8StringEncoding).js; Application('System Events').keystroke(str);"
      ]
      payload = text
    } else {
      cmd = "xdotool"
      args = ["type", "--clearmodifiers", "--file", "-"]
      payload = text
    }

    const child = spawnFn(cmd, args, {
      stdio: ["pipe", "ignore", "ignore"],
      windowsHide: true
    })

    child.on("error", reject)
    child.on("close", code => {
      if (code === 0) {
        resolve()
      } else {
        reject(new Error(`Typing process exited with code ${code}`))
      }
    })

    child.stdin?.write(payload)
    child.stdin?.end()
  })
}

export interface BuildActionsOptions {
  platform?: string
  urlOpener?: UrlOpener
  typer?: KeystrokeTyper
  timestamp?: number
  outputMode?: OutputMode
  typingDelayMs?: number
}

export function buildEntryActions(entry: FlattenedEntry, api: PublicAPI, options?: BuildActionsOptions): ResultAction[] {
  const platform = options?.platform || process.platform
  const mod = getPlatformModifier(platform)
  const opener = options?.urlOpener || defaultUrlOpener
  const typer: KeystrokeTyper = options?.typer || ((text: string) => defaultKeystrokeTyper(text, platform))
  const outputMode: OutputMode = options?.outputMode === "type" ? "type" : "clipboard"
  const typingDelayMs = options?.typingDelayMs ?? 150

  const rawPassword = getFieldText(entry.entry.fields.get("Password"))
  const rawUserName = entry.userName ? entry.userName.trim() : ""
  const otpField = getFieldText(entry.entry.fields.get("otp"))
  const totpInfo = getEntryTotp(otpField, options?.timestamp)
  const rawUrl = entry.url ? entry.url.trim() : ""

  const hasPassword = rawPassword.length > 0
  const hasUserName = rawUserName.length > 0
  const hasTotp = totpInfo !== null
  const hasUrl = rawUrl.length > 0

  const executeCopy = async (ctx: Context, text: string) => {
    await api.Copy(ctx, {
      type: "text",
      text
    })
  }

  const executeType = async (ctx: Context, text: string) => {
    if (api.HideApp) {
      await api.HideApp(ctx)
    }
    if (typingDelayMs > 0) {
      await new Promise(resolve => setTimeout(resolve, typingDelayMs))
    }
    await typer(text)
  }

  const actions: ResultAction[] = []

  if (outputMode === "clipboard") {
    if (hasPassword) {
      actions.push({
        Name: t("action_copy_password"),
        IsDefault: true,
        PreventHideAfterAction: false,
        Icon: {
          ImageType: "relative",
          ImageData: "icons/database/C00_Password.svg"
        },
        Action: async (ctx: Context) => {
          await executeCopy(ctx, rawPassword)
        }
      })
      actions.push({
        Name: t("action_type_password"),
        Hotkey: `${mod}+p`,
        PreventHideAfterAction: false,
        Icon: {
          ImageType: "relative",
          ImageData: "icons/database/C22_ASCII.svg"
        },
        Action: async (ctx: Context) => {
          await executeType(ctx, rawPassword)
        }
      })
    }

    if (hasUserName) {
      actions.push({
        Name: t("action_copy_username"),
        Hotkey: `${mod}+u`,
        PreventHideAfterAction: false,
        Icon: {
          ImageType: "relative",
          ImageData: "icons/database/C09_Identity.svg"
        },
        Action: async (ctx: Context) => {
          await executeCopy(ctx, entry.userName)
        }
      })
    }

    if (hasTotp) {
      actions.push({
        Name: t("action_copy_totp"),
        Hotkey: `${mod}+t`,
        PreventHideAfterAction: false,
        Icon: {
          ImageType: "relative",
          ImageData: "icons/database/C39_History.svg"
        },
        Action: async (ctx: Context) => {
          const freshTotp = getEntryTotp(otpField, options?.timestamp)
          if (freshTotp) {
            await executeCopy(ctx, freshTotp.token)
          }
        }
      })
    }
  } else {
    if (hasPassword) {
      actions.push({
        Name: t("action_type_password"),
        IsDefault: true,
        PreventHideAfterAction: false,
        Icon: {
          ImageType: "relative",
          ImageData: "icons/database/C22_ASCII.svg"
        },
        Action: async (ctx: Context) => {
          await executeType(ctx, rawPassword)
        }
      })
      actions.push({
        Name: t("action_copy_password"),
        Hotkey: `${mod}+c`,
        PreventHideAfterAction: false,
        Icon: {
          ImageType: "relative",
          ImageData: "icons/database/C00_Password.svg"
        },
        Action: async (ctx: Context) => {
          await executeCopy(ctx, rawPassword)
        }
      })
    }

    if (hasUserName) {
      actions.push({
        Name: t("action_type_username"),
        Hotkey: `${mod}+u`,
        PreventHideAfterAction: false,
        Icon: {
          ImageType: "relative",
          ImageData: "icons/database/C09_Identity.svg"
        },
        Action: async (ctx: Context) => {
          await executeType(ctx, entry.userName)
        }
      })
    }

    if (hasTotp) {
      actions.push({
        Name: t("action_type_totp"),
        Hotkey: `${mod}+t`,
        PreventHideAfterAction: false,
        Icon: {
          ImageType: "relative",
          ImageData: "icons/database/C39_History.svg"
        },
        Action: async (ctx: Context) => {
          const freshTotp = getEntryTotp(otpField, options?.timestamp)
          if (freshTotp) {
            await executeType(ctx, freshTotp.token)
          }
        }
      })
    }
  }

  if (hasUrl) {
    actions.push({
      Name: t("action_open_url"),
      Hotkey: `${mod}+o`,
      PreventHideAfterAction: false,
      Icon: {
        ImageType: "relative",
        ImageData: "icons/database/C16_Mozilla_Firebird.svg"
      },
      Action: async () => {
        const targetUrl = /^https?:\/\//i.test(rawUrl) ? rawUrl : `https://${rawUrl}`
        await opener(targetUrl)
      }
    })
  }

  if (actions.length > 0) {
    actions[0].IsDefault = true
    delete actions[0].Hotkey
    for (let i = 1; i < actions.length; i++) {
      delete actions[i].IsDefault
    }
  }

  return actions
}
