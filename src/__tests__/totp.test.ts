import { parseKeePassTotp, getEntryTotp, formatTotpToken } from "../totp"

describe("TOTP Generator & Parser", () => {
  const valid6DigitUri = "otpauth://totp/Example:user@test.com?secret=JBSWY3DPEHPK3PXP&issuer=Example&digits=6&period=30"
  const valid8DigitUri = "otpauth://totp/Example8:user@test.com?secret=JBSWY3DPEHPK3PXP&issuer=Example8&digits=8&period=30"
  const fixtureGameUri =
    "otpauth://totp/%E6%B8%B8%E6%88%8F%E8%B4%A6%E5%8F%B711:tiboooo%40gmaill.com?secret=5WIZY3YLM77SH3TPVJYCYRCI6TB6C2ZG&period=30&digits=6&issuer=%E6%B8%B8%E6%88%8F%E8%B4%A6%E5%8F%B711"
  const fixtureGithubUri = "otpauth://totp/Github:user111?secret=O6DOIDYMC6HNVTXYFQKYMHVHPZKUEJZN&period=30&digits=6&issuer=Github"

  describe("Token Formatting", () => {
    test("formats 6-digit token with a space in the middle", () => {
      expect(formatTotpToken("123456")).toBe("123 456")
    })

    test("formats 8-digit token with a space in the middle", () => {
      expect(formatTotpToken("12345678")).toBe("1234 5678")
    })

    test("leaves tokens of other lengths unchanged", () => {
      expect(formatTotpToken("12345")).toBe("12345")
      expect(formatTotpToken("1234567")).toBe("1234567")
    })
  })

  describe("Strict KeePassXC standard parsing", () => {
    test("parses valid otpauth://totp URI", () => {
      const totp = parseKeePassTotp(valid6DigitUri)
      expect(totp).not.toBeNull()
      expect(totp?.digits).toBe(6)
      expect(totp?.period).toBe(30)
    })

    test("rejects legacy or non-otpauth URI formats", () => {
      expect(parseKeePassTotp("JBSWY3DPEHPK3PXP")).toBeNull()
      expect(parseKeePassTotp("TOTP Seed: 123456")).toBeNull()
      expect(parseKeePassTotp("key:12345")).toBeNull()
    })

    test("rejects HOTP URIs", () => {
      expect(parseKeePassTotp("otpauth://hotp/Example:alice?secret=JBSWY3DPEHPK3PXP&counter=1")).toBeNull()
    })

    test("returns null for empty or invalid values", () => {
      expect(parseKeePassTotp("")).toBeNull()
      expect(parseKeePassTotp("   ")).toBeNull()
      expect(parseKeePassTotp(undefined)).toBeNull()
      expect(parseKeePassTotp("otpauth://invalid-url")).toBeNull()
    })
  })

  describe("Dynamic TOTP calculation and countdown indicator", () => {
    test("calculates RFC 6238 token and countdown seconds deterministically", () => {
      // 1700000012000 ms -> 1700000012 seconds
      // 1700000012 % 30 = 2 seconds into period, so 28 seconds remaining
      const timestamp = 1700000012000
      const result = getEntryTotp(valid6DigitUri, timestamp)

      expect(result).not.toBeNull()
      expect(result?.token).toMatch(/^\d{6}$/)
      expect(result?.formattedToken).toBe(`${result?.token.slice(0, 3)} ${result?.token.slice(3)}`)
      expect(result?.remainingSeconds).toBe(28)
      expect(result?.badge).toBe(`${result?.formattedToken} (28s)`)
      expect(result?.period).toBe(30)
    })

    test("handles boundary countdown second when exactly at period start", () => {
      // Exactly at a 30-second boundary: 1700000010000 ms (1700000010 % 30 = 0)
      // Remaining should be 30 seconds
      const timestamp = 1700000010000
      const result = getEntryTotp(valid6DigitUri, timestamp)

      expect(result).not.toBeNull()
      expect(result?.remainingSeconds).toBe(30)
      expect(result?.badge).toBe(`${result?.formattedToken} (30s)`)
    })

    test("calculates 8-digit TOTP tokens correctly", () => {
      const timestamp = 1700000018000 // 8s into 30s period -> 22s remaining
      const result = getEntryTotp(valid8DigitUri, timestamp)

      expect(result).not.toBeNull()
      expect(result?.token).toMatch(/^\d{8}$/)
      expect(result?.formattedToken).toBe(`${result?.token.slice(0, 4)} ${result?.token.slice(4)}`)
      expect(result?.remainingSeconds).toBe(22)
      expect(result?.badge).toBe(`${result?.formattedToken} (22s)`)
    })

    test("generates valid TOTP for real fixture URIs", () => {
      const fixedTime = 1710000000000
      const gameTotp = getEntryTotp(fixtureGameUri, fixedTime)
      expect(gameTotp).not.toBeNull()
      expect(gameTotp?.token).toHaveLength(6)
      expect(gameTotp?.badge).toMatch(/^\d{3} \d{3} \(\d{1,2}s\)$/)

      const githubTotp = getEntryTotp(fixtureGithubUri, fixedTime)
      expect(githubTotp).not.toBeNull()
      expect(githubTotp?.token).toHaveLength(6)
      expect(githubTotp?.badge).toMatch(/^\d{3} \d{3} \(\d{1,2}s\)$/)
    })

    test("returns null when otp field text is empty or invalid", () => {
      expect(getEntryTotp("")).toBeNull()
      expect(getEntryTotp(undefined)).toBeNull()
      expect(getEntryTotp("invalid")).toBeNull()
    })
  })
})
