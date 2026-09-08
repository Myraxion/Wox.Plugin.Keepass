/**
 * Intelligently identifies if a text snippet represents a URL and extracts its core host
 * (hostname with port if specified). Supports explicit protocol URLs (http/https),
 * protocol-less domains (e.g. woxlauncher.com), localhost, and IPv4 addresses.
 *
 * Returns null if the text is not a valid URL.
 */
export function extractUrlHostname(rawText: string): string | null {
  if (!rawText) return null
  const text = rawText.trim()
  if (!text || /\s/.test(text)) return null

  // 1. Explicit protocol URLs
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(text)) {
    try {
      const parsed = new URL(text)
      if (parsed.protocol === "http:" || parsed.protocol === "https:") {
        return parsed.host || null
      }
    } catch {
      return null
    }
  }

  // 2. Protocol-less URLs
  // Must match either:
  // - localhost (e.g. localhost, localhost:8080, localhost/path)
  // - IPv4 address (e.g. 127.0.0.1, 192.168.1.1:3000)
  // - Standard domain with valid alpha TLD (length >= 2, e.g. woxlauncher.com, sub.domain.co.uk)
  const isLocalhost = /^localhost(?::\d+)?(?:\/.*)?$/i.test(text)
  const isIpv4 = /^(\d{1,3}\.){3}\d{1,3}(?::\d+)?(?:\/.*)?$/.test(text)
  const isDomain = /^[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?)*\.[a-zA-Z]{2,}(?::\d+)?(?:\/.*)?$/.test(text)

  if (isLocalhost || isIpv4 || isDomain) {
    try {
      const parsed = new URL(`http://${text}`)
      return parsed.host || null
    } catch {
      return null
    }
  }

  return null
}
