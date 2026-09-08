import { WoxPreview, WoxPreviewTag } from "@wox-launcher/wox-plugin"
import { FlattenedEntry, getFieldText } from "./search"
import { getEntryTotp } from "./totp"
import { t } from "./i18n"

export function formatPreviewDate(date?: Date): string {
  if (!date || !(date instanceof Date) || isNaN(date.getTime())) {
    return ""
  }
  const pad = (n: number) => (n < 10 ? `0${n}` : `${n}`)
  const year = date.getFullYear()
  const month = pad(date.getMonth() + 1)
  const day = pad(date.getDate())
  const hours = pad(date.getHours())
  const minutes = pad(date.getMinutes())
  const seconds = pad(date.getSeconds())
  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`
}

export function buildEntryPreview(entry: FlattenedEntry, timestamp?: number): WoxPreview {
  const lines: string[] = []

  // Title
  lines.push(`# ${entry.title || t("preview_untitled")}`)
  lines.push("")

  // Username
  lines.push(`- **${t("preview_username")}**: ${entry.userName || t("preview_none")}`)

  // Masked Password (12 bullets per security invariant & acceptance criteria)
  const passwordText = getFieldText(entry.entry.fields.get("Password"))
  const maskedPassword = passwordText.length > 0 ? "••••••••••••" : t("preview_none")
  lines.push(`- **${t("preview_password")}**: ${maskedPassword}`)

  // TOTP (if available)
  const otpFieldText = getFieldText(entry.entry.fields.get("otp"))
  const totpInfo = getEntryTotp(otpFieldText, timestamp)
  if (totpInfo) {
    lines.push(`- **${t("preview_totp")}**: \`${totpInfo.formattedToken}\` (${totpInfo.remainingSeconds}s)`)
  }

  // Clickable URL (if available)
  const rawUrl = entry.url ? entry.url.trim() : ""
  if (rawUrl) {
    const clickableHref = /^https?:\/\//i.test(rawUrl) ? rawUrl : `https://${rawUrl}`
    lines.push(`- **${t("preview_url")}**: [${rawUrl}](${clickableHref})`)
  }

  // Tags (if available)
  if (entry.tags && entry.tags.length > 0) {
    lines.push(`- **${t("preview_tags")}**: ${entry.tags.join(", ")}`)
  }

  // Notes
  if (entry.notes && entry.notes.trim().length > 0) {
    lines.push("")
    lines.push(`### ${t("preview_notes")}`)
    lines.push("")
    lines.push(entry.notes)
  }

  // PreviewTags
  const previewTags: WoxPreviewTag[] = [
    {
      Label: entry.group || t("preview_root_group"),
      Tooltip: t("preview_group_tooltip")
    }
  ]

  const modDateStr = formatPreviewDate(entry.entry.times?.lastModTime)
  if (modDateStr) {
    previewTags.push({
      Label: modDateStr,
      Tooltip: t("preview_mod_time_tooltip")
    })
  }

  return {
    PreviewType: "markdown",
    PreviewData: lines.join("\n"),
    PreviewTags: previewTags
  }
}
