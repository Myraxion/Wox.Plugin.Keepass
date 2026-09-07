import { WoxPreview, WoxPreviewTag } from "@wox-launcher/wox-plugin"
import { FlattenedEntry, getFieldText } from "./search"
import { getEntryTotp } from "./totp"

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
  lines.push(`# ${entry.title || "未命名"}`)
  lines.push("")

  // Username
  lines.push(`- **用户名**: ${entry.userName || "*(无)*"}`)

  // Masked Password (12 bullets per security invariant & acceptance criteria)
  const passwordText = getFieldText(entry.entry.fields.get("Password"))
  const maskedPassword = passwordText.length > 0 ? "••••••••••••" : "*(无)*"
  lines.push(`- **密码**: ${maskedPassword}`)

  // TOTP (if available)
  const otpFieldText = getFieldText(entry.entry.fields.get("otp"))
  const totpInfo = getEntryTotp(otpFieldText, timestamp)
  if (totpInfo) {
    lines.push(`- **TOTP**: \`${totpInfo.formattedToken}\` (${totpInfo.remainingSeconds}s)`)
  }

  // Clickable URL (if available)
  const rawUrl = entry.url ? entry.url.trim() : ""
  if (rawUrl) {
    const clickableHref = /^https?:\/\//i.test(rawUrl) ? rawUrl : `https://${rawUrl}`
    lines.push(`- **网址**: [${rawUrl}](${clickableHref})`)
  }

  // Tags (if available)
  if (entry.tags && entry.tags.length > 0) {
    lines.push(`- **标签**: ${entry.tags.join(", ")}`)
  }

  // Notes
  if (entry.notes && entry.notes.trim().length > 0) {
    lines.push("")
    lines.push("### 备注")
    lines.push("")
    lines.push(entry.notes)
  }

  // PreviewTags
  const previewTags: WoxPreviewTag[] = [
    {
      Label: entry.group || "根群组",
      Tooltip: "分组"
    }
  ]

  const modDateStr = formatPreviewDate(entry.entry.times?.lastModTime)
  if (modDateStr) {
    previewTags.push({
      Label: modDateStr,
      Tooltip: "修改时间"
    })
  }

  return {
    PreviewType: "markdown",
    PreviewData: lines.join("\n"),
    PreviewTags: previewTags
  }
}
