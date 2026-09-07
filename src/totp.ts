import * as OTPAuth from "otpauth"

export interface TotpInfo {
  token: string
  formattedToken: string
  remainingSeconds: number
  badge: string
  period: number
}

/**
 * Formats a numeric TOTP token with a space in the middle for improved readability.
 * e.g., "123456" -> "123 456", "12345678" -> "1234 5678"
 */
export function formatTotpToken(token: string): string {
  if (token.length === 6) {
    return `${token.slice(0, 3)} ${token.slice(3)}`
  }
  if (token.length === 8) {
    return `${token.slice(0, 4)} ${token.slice(4)}`
  }
  return token
}

/**
 * Strictly parses KeePassXC standard `otp` string containing an `otpauth://` URI.
 * Rejects legacy or non-standard formats (e.g. raw secret seeds, HOTP).
 */
export function parseKeePassTotp(otpFieldText: string | undefined): OTPAuth.TOTP | null {
  if (!otpFieldText || typeof otpFieldText !== "string") {
    return null
  }
  const trimmed = otpFieldText.trim()
  if (!trimmed.toLowerCase().startsWith("otpauth://")) {
    return null
  }
  try {
    const parsed = OTPAuth.URI.parse(trimmed)
    if (parsed instanceof OTPAuth.TOTP) {
      return parsed
    }
    return null
  } catch {
    return null
  }
}

/**
 * Calculates current RFC 6238 TOTP token, remaining rotation seconds, and badge text.
 */
export function getEntryTotp(otpFieldText: string | undefined, timestamp?: number): TotpInfo | null {
  const totp = parseKeePassTotp(otpFieldText)
  if (!totp) {
    return null
  }
  try {
    const ts = timestamp ?? Date.now()
    const token = totp.generate({ timestamp: ts })
    const period = totp.period || 30
    const remainingMs = totp.remaining({ timestamp: ts })
    const remainingSeconds = Math.ceil(remainingMs / 1000)
    const formattedToken = formatTotpToken(token)
    const badge = `${formattedToken} (${remainingSeconds}s)`
    return {
      token,
      formattedToken,
      remainingSeconds,
      badge,
      period
    }
  } catch {
    return null
  }
}
