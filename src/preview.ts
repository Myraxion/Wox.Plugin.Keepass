import { WoxPreview, WoxPreviewTag, WoxPreviewListData, WoxPreviewListItem } from "@wox-launcher/wox-plugin"
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
  const items: WoxPreviewListItem[] = []

  // 1. Username row (always present)
  items.push({
    icon: {
      ImageType: "relative",
      ImageData: "icons/database/C09_Identity.svg"
    },
    title: entry.userName || t("preview_none"),
    subtitle: t("preview_username")
  })

  // 2. Password row (always present, masked with 12 bullets if non-empty)
  const passwordText = getFieldText(entry.entry.fields.get("Password"))
  items.push({
    icon: {
      ImageType: "relative",
      ImageData: "icons/database/C00_Password.svg"
    },
    title: passwordText.length > 0 ? "••••••••••••" : t("preview_none"),
    subtitle: t("preview_password")
  })

  // 3. TOTP row (only if validly configured)
  const otpFieldText = getFieldText(entry.entry.fields.get("otp"))
  const totpInfo = getEntryTotp(otpFieldText, timestamp)
  if (totpInfo) {
    items.push({
      icon: {
        ImageType: "relative",
        ImageData: "icons/database/C39_History.svg"
      },
      title: totpInfo.formattedToken,
      subtitle: t("preview_totp"),
      tails: [
        {
          Type: "text",
          Text: `${totpInfo.remainingSeconds}s`
        }
      ]
    })
  }

  // 4. URL row (only if present)
  const rawUrl = entry.url ? entry.url.trim() : ""
  if (rawUrl) {
    items.push({
      icon: {
        ImageType: "relative",
        ImageData: "icons/database/C16_Mozilla_Firebird.svg"
      },
      title: rawUrl,
      subtitle: t("preview_url")
    })
  }

  // 5. Tags row (only if non-empty)
  if (entry.tags && entry.tags.length > 0) {
    items.push({
      icon: {
        ImageType: "relative",
        ImageData: "icons/database/C23_Icons.svg"
      },
      title: entry.tags.join(", "),
      subtitle: t("preview_tags")
    })
  }

  // 6. Notes row (only if non-empty)
  if (entry.notes && entry.notes.trim().length > 0) {
    items.push({
      icon: {
        ImageType: "relative",
        ImageData: "icons/database/C44_KNotes.svg"
      },
      title: entry.notes.trim(),
      subtitle: t("preview_notes")
    })
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

  const listData: WoxPreviewListData = {
    items
  }

  return {
    PreviewType: "list",
    PreviewData: JSON.stringify(listData),
    PreviewTags: previewTags
  }
}
