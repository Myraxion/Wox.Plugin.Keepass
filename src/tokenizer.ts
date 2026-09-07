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
