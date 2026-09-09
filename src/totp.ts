import crypto from "crypto"
import * as OTPAuth from "otpauth"

export interface TotpInfo {
  token: string
  formattedToken: string
  remainingSeconds: number
  badge: string
  period: number
  category?: "warning"
}

const STEAM_CHARS = "23456789BCDFGHJKMNPQRTVWXY"

/**
 * Checks if the OTP URI specifies the KeePassXC Steam encoder (`encoder=steam`).
 */
export function isSteamEncoder(otpUri: string): boolean {
  try {
    const url = new URL(otpUri)
    return url.searchParams.get("encoder")?.toLowerCase() === "steam"
  } catch {
    return false
  }
}

/**
 * Generates a Steam-style 5-character alphanumeric TOTP code.
 */
export function generateSteamGuardCode(secretBytes: Uint8Array, timestamp = Date.now(), period = 30): string {
  const time = Math.floor(timestamp / 1000)
  const buffer = Buffer.allocUnsafe(8)
  buffer.writeUInt32BE(0, 0)
  buffer.writeUInt32BE(Math.floor(time / period), 4)

  const hmac = crypto.createHmac("sha1", Buffer.from(secretBytes))
  const digest = hmac.update(buffer).digest()

  const start = digest[19] & 0x0f
  const sliced = digest.slice(start, start + 4)
  let fullcode = sliced.readUInt32BE(0) & 0x7fffffff

  let code = ""
  for (let i = 0; i < 5; i++) {
    code += STEAM_CHARS.charAt(fullcode % STEAM_CHARS.length)
    fullcode = Math.floor(fullcode / STEAM_CHARS.length)
  }

  return code
}

/**
 * Formats a numeric TOTP token with a space in the middle for improved readability.
 * e.g., "123456" -> "123 456", "12345678" -> "1234 5678"
 * Tokens of length 5 (Steam Guard) or others are returned as-is.
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
 * Calculates current RFC 6238 or Steam® TOTP token, remaining rotation seconds, and badge text.
 */
export function getEntryTotp(otpFieldText: string | undefined, timestamp?: number): TotpInfo | null {
  const totp = parseKeePassTotp(otpFieldText)
  if (!totp) {
    return null
  }
  try {
    const ts = timestamp ?? Date.now()
    const period = totp.period || 30
    const remainingMs = totp.remaining({ timestamp: ts })
    const remainingSeconds = Math.ceil(remainingMs / 1000)

    let token: string
    if (otpFieldText && isSteamEncoder(otpFieldText)) {
      token = generateSteamGuardCode(totp.secret.bytes, ts, period)
    } else {
      token = totp.generate({ timestamp: ts })
    }

    const formattedToken = formatTotpToken(token)
    const badge = `${formattedToken} (${remainingSeconds}s)`
    const category = remainingSeconds <= 5 ? "warning" : undefined
    return {
      token,
      formattedToken,
      remainingSeconds,
      badge,
      period,
      category
    }
  } catch {
    return null
  }
}
