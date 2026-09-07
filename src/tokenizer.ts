export type FieldPrefix = "u" | "t" | "url" | "g"

export interface SearchToken {
  field?: FieldPrefix
  value: string
}

/**
 * Lightweight, zero-dependency tokenizer that extracts plain terms,
 * prefixed terms (u:, t:, url:, g:), and double-quoted values.
 */
export function tokenizeQuery(query: string): SearchToken[] {
  const tokens: SearchToken[] = []
  let i = 0
  const len = query.length

  while (i < len) {
    // Skip whitespace
    while (i < len && /\s/.test(query[i])) {
      i++
    }
    if (i >= len) break

    // Check for known field prefixes (case-insensitive)
    let field: FieldPrefix | undefined = undefined

    if (query.slice(i, i + 4).toLowerCase() === "url:") {
      field = "url"
      i += 4
    } else if (query.slice(i, i + 2).toLowerCase() === "u:" || query.slice(i, i + 2).toLowerCase() === "t:" || query.slice(i, i + 2).toLowerCase() === "g:") {
      field = query[i].toLowerCase() as FieldPrefix
      i += 2
    }

    let value = ""
    if (i < len && query[i] === '"') {
      i++ // Skip opening quote
      const start = i
      while (i < len && query[i] !== '"') {
        i++
      }
      value = query.slice(start, i)
      if (i < len && query[i] === '"') {
        i++ // Skip closing quote
      }
    } else {
      const start = i
      while (i < len && !/\s/.test(query[i])) {
        i++
      }
      value = query.slice(start, i)
    }

    if (value.length > 0) {
      tokens.push(field ? { field, value } : { value })
    }
  }

  return tokens
}

export interface ExcludeRule {
  type: "t" | "g"
  value: string
}

/**
 * Parses comma-separated exclusion rules with strict prefixes (t:, g:)
 * and support for double-quoted values.
 */
export function parseExcludeRules(settingValue: string): ExcludeRule[] {
  if (!settingValue || !settingValue.trim()) {
    return []
  }

  const rawRules: string[] = []
  let current = ""
  let inQuotes = false

  for (let i = 0; i < settingValue.length; i++) {
    const ch = settingValue[i]
    if (ch === '"') {
      inQuotes = !inQuotes
      current += ch
    } else if (ch === "," && !inQuotes) {
      if (current.trim().length > 0) {
        rawRules.push(current.trim())
      }
      current = ""
    } else {
      current += ch
    }
  }
  if (current.trim().length > 0) {
    rawRules.push(current.trim())
  }

  const rules: ExcludeRule[] = []

  for (const raw of rawRules) {
    const lower = raw.toLowerCase()
    let type: "t" | "g" | null = null
    let content = ""

    if (lower.startsWith("t:")) {
      type = "t"
      content = raw.slice(2).trim()
    } else if (lower.startsWith("g:")) {
      type = "g"
      content = raw.slice(2).trim()
    }

    if (!type || !content) {
      continue
    }

    let value = content
    if (value.startsWith('"') && value.endsWith('"') && value.length >= 2) {
      value = value.slice(1, -1).trim()
    } else {
      value = value.replace(/^"|"$/g, "").trim()
    }

    if (value.length > 0) {
      rules.push({ type, value })
    }
  }

  return rules
}
