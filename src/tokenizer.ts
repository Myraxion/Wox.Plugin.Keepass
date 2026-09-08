export type FieldPrefix = "u" | "t" | "url" | "g"

export interface SearchToken {
  field?: FieldPrefix
  value: string
}

function isQuote(ch: string | undefined): boolean {
  return ch === '"' || ch === "“" || ch === "”"
}

/**
 * Lightweight, zero-dependency tokenizer that extracts plain terms,
 * prefixed terms (u:, t:, url:, g: / u：, t：, url：, g：), and quoted values.
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

    // Check for known field prefixes (case-insensitive, supports full-width colon)
    let field: FieldPrefix | undefined = undefined

    if (query.slice(i, i + 3).toLowerCase() === "url" && (query[i + 3] === ":" || query[i + 3] === "：")) {
      field = "url"
      i += 4
    } else {
      const prefixChar = query[i]?.toLowerCase()
      if ((prefixChar === "u" || prefixChar === "t" || prefixChar === "g") && (query[i + 1] === ":" || query[i + 1] === "：")) {
        field = prefixChar as FieldPrefix
        i += 2
      }
    }

    let value = ""
    if (i < len && isQuote(query[i])) {
      i++ // Skip opening quote
      const start = i
      while (i < len && !isQuote(query[i])) {
        i++
      }
      value = query.slice(start, i)
      if (i < len && isQuote(query[i])) {
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
 * Parses comma-separated exclusion rules with strict prefixes (t:, g: / t：, g：)
 * and support for double-quoted values (half-width or full-width).
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
    if (isQuote(ch)) {
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

    if (lower.startsWith("t:") || lower.startsWith("t：")) {
      type = "t"
      content = raw.slice(2).trim()
    } else if (lower.startsWith("g:") || lower.startsWith("g：")) {
      type = "g"
      content = raw.slice(2).trim()
    }

    if (!type || !content) {
      continue
    }

    let value = content
    if (value.length >= 2 && isQuote(value[0]) && isQuote(value[value.length - 1])) {
      value = value.slice(1, -1).trim()
    } else {
      value = value.replace(/^["“”]|["“”]$/g, "").trim()
    }

    if (value.length > 0) {
      rules.push({ type, value })
    }
  }

  return rules
}
