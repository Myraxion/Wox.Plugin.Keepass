import { PublicAPI, Result } from "@wox-launcher/wox-plugin"
import * as kdbxweb from "kdbxweb"
import { SearchToken, tokenizeQuery, ExcludeRule, parseExcludeRules } from "./tokenizer"
import { resolveEntryIcon } from "./icons"
import { buildEntryPreview } from "./preview"
import { getEntryTotp } from "./totp"
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

export function calculateRelevanceScore(entry: FlattenedEntry, rawSearch: string, tokens: SearchToken[]): number {
  const titleLower = entry.title.toLowerCase()
  const searchTrimmed = rawSearch.trim().toLowerCase()

  // 1. Title exact match (100)
  if (titleLower === searchTrimmed) {
    return 100
  }
  for (let i = 0; i < tokens.length; i++) {
    const tokenVal = tokens[i].value.toLowerCase()
    if (!tokens[i].field && titleLower === tokenVal) {
      return 100
    }
  }

  // 2. Title prefix match (90)
  if (titleLower.startsWith(searchTrimmed)) {
    return 90
  }
  for (let i = 0; i < tokens.length; i++) {
    const tokenVal = tokens[i].value.toLowerCase()
    if (!tokens[i].field && titleLower.startsWith(tokenVal)) {
      return 90
    }
  }

  // 3. Title substring match (80)
  if (titleLower.includes(searchTrimmed)) {
    return 80
  }
  for (let i = 0; i < tokens.length; i++) {
    const tokenVal = tokens[i].value.toLowerCase()
    if (!tokens[i].field && titleLower.includes(tokenVal)) {
      return 80
    }
  }

  // 4. UserName / URL match (60)
  const userNameLower = entry.userName.toLowerCase()
  const urlLower = entry.url.toLowerCase()
  if (userNameLower.includes(searchTrimmed) || urlLower.includes(searchTrimmed)) {
    return 60
  }
  for (let i = 0; i < tokens.length; i++) {
    const tokenVal = tokens[i].value.toLowerCase()
    if (tokens[i].field === "u" || tokens[i].field === "url" || !tokens[i].field) {
      if (userNameLower.includes(tokenVal) || urlLower.includes(tokenVal)) {
        return 60
      }
    }
  }

  // 5. Tags / Notes match (40)
  const notesLower = entry.notes.toLowerCase()
  if (notesLower.includes(searchTrimmed) || entry.tags.some(t => t.toLowerCase().includes(searchTrimmed))) {
    return 40
  }
  for (let i = 0; i < tokens.length; i++) {
    const tokenVal = tokens[i].value.toLowerCase()
    if (tokens[i].field === "t" || !tokens[i].field) {
      if (entry.tags.some(t => t.toLowerCase().includes(tokenVal)) || notesLower.includes(tokenVal)) {
        return 40
      }
    }
  }

  return 40
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
    const result: Result = {
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
