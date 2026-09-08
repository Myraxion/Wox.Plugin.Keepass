import { extractUrlHostname } from "../url"

describe("extractUrlHostname", () => {
  describe("Protocol URLs", () => {
    test("extracts hostname from http and https URLs", () => {
      expect(extractUrlHostname("https://woxlauncher.com")).toBe("woxlauncher.com")
      expect(extractUrlHostname("http://woxlauncher.com/docs")).toBe("woxlauncher.com")
      expect(extractUrlHostname("https://github.com/Wox-launcher/Wox/issues?q=is%3Aopen")).toBe("github.com")
    })

    test("preserves non-standard ports in protocol URLs", () => {
      expect(extractUrlHostname("http://localhost:8080/app")).toBe("localhost:8080")
      expect(extractUrlHostname("https://192.168.1.1:8443/admin")).toBe("192.168.1.1:8443")
    })
  })

  describe("Protocol-less Domain URLs", () => {
    test("extracts hostname from standard domains without protocol", () => {
      expect(extractUrlHostname("woxlauncher.com")).toBe("woxlauncher.com")
      expect(extractUrlHostname("www.google.com")).toBe("www.google.com")
      expect(extractUrlHostname("api.github.com/repos")).toBe("api.github.com")
      expect(extractUrlHostname("sub.domain.co.uk/path?q=1")).toBe("sub.domain.co.uk")
    })

    test("trims surrounding whitespace from selection", () => {
      expect(extractUrlHostname("  woxlauncher.com  \n")).toBe("woxlauncher.com")
      expect(extractUrlHostname("\thttps://github.com/login  ")).toBe("github.com")
    })
  })

  describe("Localhost and IP without protocol", () => {
    test("extracts localhost with and without port", () => {
      expect(extractUrlHostname("localhost:8080")).toBe("localhost:8080")
      expect(extractUrlHostname("localhost")).toBe("localhost")
      expect(extractUrlHostname("localhost:3000/api/v1")).toBe("localhost:3000")
    })

    test("extracts IPv4 addresses with and without port", () => {
      expect(extractUrlHostname("127.0.0.1:3000")).toBe("127.0.0.1:3000")
      expect(extractUrlHostname("192.168.1.1")).toBe("192.168.1.1")
      expect(extractUrlHostname("10.0.0.1:8080/dashboard")).toBe("10.0.0.1:8080")
    })
  })

  describe("Non-URL text rejection", () => {
    test("returns null for empty or whitespace-only strings", () => {
      expect(extractUrlHostname("")).toBeNull()
      expect(extractUrlHostname("   ")).toBeNull()
      expect(extractUrlHostname("\t\n")).toBeNull()
    })

    test("returns null for text containing spaces or newlines", () => {
      expect(extractUrlHostname("hello world")).toBeNull()
      expect(extractUrlHostname("my password 123")).toBeNull()
      expect(extractUrlHostname("SELECT * FROM users")).toBeNull()
    })

    test("returns null for non-URL single words and Chinese sentences", () => {
      expect(extractUrlHostname("password")).toBeNull()
      expect(extractUrlHostname("admin")).toBeNull()
      expect(extractUrlHostname("这是一个测试文本")).toBeNull()
      expect(extractUrlHostname("foo.123")).toBeNull()
    })
  })
})
