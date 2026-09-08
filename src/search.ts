import { PublicAPI, Result } from "@wox-launcher/wox-plugin"
import * as kdbxweb from "kdbxweb"
import { SearchToken, tokenizeQuery, ExcludeRule, parseExcludeRules } from "./tokenizer"
import { resolveEntryIcon } from "./icons"
import { buildEntryPreview } from "./preview"
import { getEntryTotp, parseKeePassTotp } from "./totp"
import { buildEntryActions, BuildActionsOptions } from "./actions"

export interface SearchOptions extends BuildActionsOptions {
  excludeRules?: string | ExcludeRule[]
}

const fallbackApi: PublicAPI = {
  Copy: async () => {},
  Notify: async () => {},
  Log: async () => {}
} as unknown as PublicAPI

export interface FlattenedEntry {
  entry: kdbxweb.KdbxEntry
  title: string
  userName: string
  url: string
  tags: string[]
  notes: string
  group: string
  groupName: string
}

export function getFieldText(field: kdbxweb.KdbxEntryField | undefined): string {
  if (!field) return ""
  if (field instanceof kdbxweb.ProtectedValue) {
    return field.getText()
  }
  return typeof field === "string" ? field : ""
}

export function getAllEntries(db: kdbxweb.Kdbx): FlattenedEntry[] {
  const result: FlattenedEntry[] = []

  function walk(group: kdbxweb.KdbxGroup, groupPath: string[]) {
    const currentPath = [...groupPath, group.name || ""]
    for (let i = 0; i < group.entries.length; i++) {
      const entry = group.entries[i]
      const title = getFieldText(entry.fields.get("Title"))
      const userName = getFieldText(entry.fields.get("UserName"))
      const url = getFieldText(entry.fields.get("URL"))
      const notes = getFieldText(entry.fields.get("Notes"))
      result.push({
        entry,
        title,
        userName,
        url,
        tags: entry.tags || [],
        notes,
        group: currentPath.join(" / "),
        groupName: group.name || ""
      })
    }
    for (let i = 0; i < group.groups.length; i++) {
      walk(group.groups[i], currentPath)
    }
  }

  const defaultGroup = db.getDefaultGroup()
  if (defaultGroup) {
    walk(defaultGroup, [])
  }
  return result
}

export function matchToken(entry: FlattenedEntry, token: SearchToken): boolean {
  const val = token.value.toLowerCase()
  if (!val) return true

  switch (token.field) {
    case "u":
      return entry.userName.toLowerCase().includes(val)
    case "url":
      return entry.url.toLowerCase().includes(val)
    case "t":
      return entry.tags.some(tag => tag.toLowerCase().includes(val))
    case "g":
      return entry.group.toLowerCase().includes(val) || entry.groupName.toLowerCase().includes(val)
    default:
      return (
        entry.title.toLowerCase().includes(val) ||
        entry.userName.toLowerCase().includes(val) ||
        entry.url.toLowerCase().includes(val) ||
        entry.tags.some(tag => tag.toLowerCase().includes(val)) ||
        entry.notes.toLowerCase().includes(val)
      )
  }
}

export function matchAllTokens(entry: FlattenedEntry, tokens: SearchToken[]): boolean {
  for (let i = 0; i < tokens.length; i++) {
    if (!matchToken(entry, tokens[i])) {
      return false
    }
  }
  return true
}

export const FIELD_WEIGHTS = {
  Title: 10,
  URL: 8,
  Tags: 6,
  UserName: 5,
  Notes: 2
} as const

export const MAX_POSSIBLE_SCORE = 319

/**
 * 双向 4 阶梯字符串匹配度算法 (参考 KeeWeb Ranking.getStringRank)
 * @param s1 搜索词
 * @param s2 字段内容
 * @returns 10: 完全一致, 5: 前缀匹配, 3: 包含子串, 0: 未命中
 */
export function getStringRank(s1: string, s2: string): number {
  if (!s1 || !s2) {
    return 0
  }
  const s1Lower = s1.toLowerCase()
  const s2Lower = s2.toLowerCase()

  let ix = s1Lower.indexOf(s2Lower)
  if (ix === 0 && s1Lower.length === s2Lower.length) {
    return 10
  } else if (ix === 0) {
    return 5
  } else if (ix > 0) {
    return 3
  }

  ix = s2Lower.indexOf(s1Lower)
  if (ix === 0) {
    return 5
  } else if (ix > 0) {
    return 3
  }

  return 0
}

export function calculateFieldCompletenessScore(entry: FlattenedEntry): number {
  let bonus = 0
  const isNonEmpty = (s?: string) => Boolean(s && s.trim().length > 0)
  const rawFields = entry.entry?.fields

  // 1. password (非空, 凭据要素 +2)
  if (rawFields) {
    const password = getFieldText(rawFields.get("Password"))
    if (password.length > 0) {
      bonus += 2
    }
  }

  // 2. userName (非空, 凭据要素 +2)
  if (isNonEmpty(entry.userName)) {
    bonus += 2
  }

  // 3. otp (配置了有效 TOTP, 凭据要素 +2)
  if (rawFields) {
    const otpText = getFieldText(rawFields.get("otp"))
    if (parseKeePassTotp(otpText) !== null) {
      bonus += 2
    }
  }

  // 4. url (非空, 元数据 +1)
  if (isNonEmpty(entry.url)) {
    bonus += 1
  }

  // 5. notes (非空, 元数据 +1)
  if (isNonEmpty(entry.notes)) {
    bonus += 1
  }

  // 6. tags (非空数组, 元数据 +1)
  if (Array.isArray(entry.tags) && entry.tags.length > 0) {
    bonus += 1
  }

  return bonus
}

function getFieldRank(fieldValue: string, freeText: string, applicableTokens: SearchToken[]): number {
  if (!fieldValue) return 0
  let maxRank = 0
  if (freeText) {
    maxRank = Math.max(maxRank, getStringRank(freeText, fieldValue))
  }
  for (let i = 0; i < applicableTokens.length; i++) {
    maxRank = Math.max(maxRank, getStringRank(applicableTokens[i].value, fieldValue))
    if (maxRank === 10) break
  }
  return maxRank
}

function getTagsRank(tags: string[], freeText: string, applicableTokens: SearchToken[]): number {
  if (!Array.isArray(tags) || tags.length === 0) return 0
  let maxRank = 0
  for (let i = 0; i < tags.length; i++) {
    const tag = tags[i]
    if (!tag) continue
    if (freeText) {
      maxRank = Math.max(maxRank, getStringRank(freeText, tag))
    }
    for (let j = 0; j < applicableTokens.length; j++) {
      maxRank = Math.max(maxRank, getStringRank(applicableTokens[j].value, tag))
      if (maxRank === 10) return 10
    }
  }
  return maxRank
}

export function calculateRelevanceScore(entry: FlattenedEntry, rawSearch: string, tokens: SearchToken[]): number {
  const nonFieldTokens = tokens.filter(t => !t.field)
  const freeText = nonFieldTokens.length === tokens.length ? rawSearch.trim() : nonFieldTokens.map(t => t.value).join(" ")

  const titleTokens = nonFieldTokens
  const urlTokens = tokens.filter(t => !t.field || t.field === "url")
  const tagsTokens = tokens.filter(t => !t.field || t.field === "t")
  const userTokens = tokens.filter(t => !t.field || t.field === "u")
  const notesTokens = nonFieldTokens

  const titleRank = getFieldRank(entry.title, freeText, titleTokens)
  const urlRank = getFieldRank(entry.url, freeText, urlTokens)
  const tagsRank = getTagsRank(entry.tags, freeText, tagsTokens)
  const userNameRank = getFieldRank(entry.userName, freeText, userTokens)
  const notesRank = getFieldRank(entry.notes, freeText, notesTokens)

  const weightedScore = FIELD_WEIGHTS.Title * titleRank + FIELD_WEIGHTS.URL * urlRank + FIELD_WEIGHTS.Tags * tagsRank + FIELD_WEIGHTS.UserName * userNameRank + FIELD_WEIGHTS.Notes * notesRank

  const completenessBonus = calculateFieldCompletenessScore(entry)
  const totalScore = weightedScore + completenessBonus

  return Math.min(100, Math.max(0, Math.round((totalScore / MAX_POSSIBLE_SCORE) * 100)))
}

export function isEntryExcluded(entry: FlattenedEntry, rules: ExcludeRule[]): boolean {
  if (!rules || rules.length === 0) return false

  for (const rule of rules) {
    const target = rule.value.toLowerCase()
    if (!target) continue

    if (rule.type === "t") {
      if (entry.tags.some(tag => tag.toLowerCase().includes(target))) {
        return true
      }
    } else if (rule.type === "g") {
      if (entry.group.toLowerCase().includes(target) || entry.groupName.toLowerCase().includes(target)) {
        return true
      }
    }
  }

  return false
}

export function searchEntries(db: kdbxweb.Kdbx, search: string, apiOrTimestamp?: PublicAPI | number, options?: SearchOptions): Result[] {
  let activeApi: PublicAPI = fallbackApi
  let activeOptions: SearchOptions = options || {}

  if (typeof apiOrTimestamp === "number") {
    activeOptions = { ...activeOptions, timestamp: apiOrTimestamp }
  } else if (apiOrTimestamp) {
    activeApi = apiOrTimestamp
  }

  const trimmed = search.trim()
  if (!trimmed) {
    return []
  }

  const tokens = tokenizeQuery(trimmed)
  if (tokens.length === 0) {
    return []
  }

  const excludeRules = typeof activeOptions.excludeRules === "string" ? parseExcludeRules(activeOptions.excludeRules) : activeOptions.excludeRules || []

  const allEntries = getAllEntries(db)
  const matched: { entry: FlattenedEntry; score: number }[] = []

  for (let i = 0; i < allEntries.length; i++) {
    const item = allEntries[i]
    if (isEntryExcluded(item, excludeRules)) {
      continue
    }
    if (matchAllTokens(item, tokens)) {
      const score = calculateRelevanceScore(item, trimmed, tokens)
      matched.push({ entry: item, score })
    }
  }

  matched.sort((a, b) => {
    if (b.score !== a.score) {
      return b.score - a.score
    }
    const titleCmp = a.entry.title.localeCompare(b.entry.title)
    if (titleCmp !== 0) {
      return titleCmp
    }
    return a.entry.userName.localeCompare(b.entry.userName)
  })

  return matched.map(m => {
    const otpField = getFieldText(m.entry.entry.fields.get("otp"))
    const totpInfo = getEntryTotp(otpField, activeOptions.timestamp)
    const entryUuid = m.entry.entry?.uuid?.id || `${m.entry.title}:${m.entry.userName}`
    const result: Result = {
      Id: entryUuid,
      Title: m.entry.title,
      SubTitle: m.entry.userName,
      Icon: resolveEntryIcon(m.entry.entry, db),
      Score: m.score,
      Preview: buildEntryPreview(m.entry, activeOptions.timestamp),
      Actions: buildEntryActions(m.entry, activeApi, activeOptions)
    }
    if (totpInfo) {
      result.Tails = [
        {
          Type: "text",
          Text: totpInfo.badge
        }
      ]
    }
    return result
  })
}
