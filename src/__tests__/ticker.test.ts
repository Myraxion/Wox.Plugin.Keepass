import * as kdbxweb from "kdbxweb"
import { Context, PublicAPI, UpdatableResult, WoxPreviewListData } from "@wox-launcher/wox-plugin"
import { startTotpTicker, stopTotpTicker, isTickerActive, getActiveTrackerCount } from "../ticker"
import { ActiveTotpItem, FlattenedEntry } from "../search"
import { getEntryTotp } from "../totp"
import * as session from "../session"

describe("Shared Wall-Clock TOTP Ticker", () => {
  const sampleUri30s = "otpauth://totp/Test30:user?secret=JBSWY3DPEHPK3PXP&period=30&digits=6"
  const sampleUriSteam = "otpauth://totp/steamcommunity.com:steamuser?secret=STFHPQRSNRRF5FNYFTI5WKLYLBBBPWLG&period=30&digits=5&issuer=steamcommunity.com&encoder=steam"

  let mockApi: PublicAPI
  let ctx: Context

  async function advanceAndFlush(ms: number) {
    jest.advanceTimersByTime(ms)
    for (let i = 0; i < 5; i++) {
      await Promise.resolve()
    }
  }

  function createMockEntry(title: string, userName: string, otpUri: string): FlattenedEntry {
    const rawEntry = {
      fields: new Map([
        ["Title", title],
        ["UserName", userName],
        ["Password", "sample-pass"],
        ["otp", otpUri]
      ]),
      times: {}
    } as unknown as kdbxweb.KdbxEntry

    return {
      title,
      userName,
      url: "",
      notes: "",
      tags: [],
      group: "Root",
      groupName: "Root",
      entry: rawEntry
    }
  }

  beforeEach(() => {
    jest.useFakeTimers()
    ctx = {} as Context
    mockApi = {
      UpdateResult: jest.fn().mockResolvedValue(true),
      IsVisible: jest.fn().mockResolvedValue(true),
      Log: jest.fn().mockResolvedValue(undefined)
    } as unknown as PublicAPI
  })

  afterEach(() => {
    stopTotpTicker()
    jest.useRealTimers()
  })

  test("does not start ticker when items array is empty", () => {
    startTotpTicker(ctx, mockApi, 1, [])
    expect(isTickerActive()).toBe(false)
    expect(getActiveTrackerCount()).toBe(0)
  })

  test("aligns initial tick to wall-clock second boundary then ticks at 1000ms intervals", async () => {
    // Set time to 1700000000250 ms (250ms past the natural second)
    // Next natural second is at 1700000001000 ms -> delay should be 750ms
    const baseTime = 1700000000250
    jest.setSystemTime(baseTime)

    const entry = createMockEntry("Entry1", "user1", sampleUri30s)
    const totpInfo = getEntryTotp(sampleUri30s, baseTime)!
    const items: ActiveTotpItem[] = [
      {
        id: "entry-1",
        entry,
        lastToken: totpInfo.token,
        lastCategory: undefined
      }
    ]

    startTotpTicker(ctx, mockApi, 1, items)
    expect(isTickerActive()).toBe(true)
    expect(getActiveTrackerCount()).toBe(1)

    // Advance by 749ms: timer should not have ticked yet
    await advanceAndFlush(749)
    expect(mockApi.UpdateResult).not.toHaveBeenCalled()

    // Advance 1ms more (total 750ms) -> exactly reaches 1700000001000 ms -> first tick fires
    await advanceAndFlush(1)
    expect(mockApi.UpdateResult).toHaveBeenCalledTimes(1)

    // Advance another 1000ms -> second tick fires
    await advanceAndFlush(1000)
    expect(mockApi.UpdateResult).toHaveBeenCalledTimes(2)

    // Advance another 1000ms -> third tick fires
    await advanceAndFlush(1000)
    expect(mockApi.UpdateResult).toHaveBeenCalledTimes(3)
  })

  test("dispatches updated Preview with decrementing countdown and keeps Tails untouched during normal ticks", async () => {
    // 1700000012000 ms -> 1700000012 % 30 = 2s into period -> 28s remaining (> 5s)
    const baseTime = 1700000012000
    jest.setSystemTime(baseTime)

    const entry = createMockEntry("Entry1", "user1", sampleUri30s)
    const totpInfo = getEntryTotp(sampleUri30s, baseTime)!
    expect(totpInfo.remainingSeconds).toBe(28)

    const items: ActiveTotpItem[] = [
      {
        id: "entry-1",
        entry,
        lastToken: totpInfo.token,
        lastCategory: undefined
      }
    ]

    startTotpTicker(ctx, mockApi, 1, items)

    // Advance by 1000ms to 1700000013000 ms (27s remaining)
    await advanceAndFlush(1000)

    expect(mockApi.UpdateResult).toHaveBeenCalledTimes(1)
    const updateCall = (mockApi.UpdateResult as jest.Mock).mock.calls[0]
    expect(updateCall[0]).toBe(ctx)

    const updatePayload: UpdatableResult = updateCall[1]
    expect(updatePayload.Id).toBe("entry-1")
    expect(updatePayload.Preview).toBeDefined()
    expect(updatePayload.Tails).toBeUndefined() // Tails unchanged because token & category did not change

    const previewData = JSON.parse(updatePayload.Preview?.PreviewData || "{}") as WoxPreviewListData
    const totpRow = previewData.items?.find(i => i.subtitle === "TOTP")
    expect(totpRow).toBeDefined()
    expect(totpRow?.tails?.[0]?.Text).toBe("27s")
    expect(totpRow?.tails?.[0]?.TextCategory).toBeUndefined()
  })

  test("switches both Tails and Preview to warning category when remaining seconds <= 5s", async () => {
    // 1700000034000 ms: 1700000034 % 30 = 24s into period -> 6s remaining
    const baseTime = 1700000034000
    jest.setSystemTime(baseTime)

    const entry = createMockEntry("Entry1", "user1", sampleUri30s)
    const totpInfo = getEntryTotp(sampleUri30s, baseTime)!
    expect(totpInfo.remainingSeconds).toBe(6)

    const items: ActiveTotpItem[] = [
      {
        id: "entry-1",
        entry,
        lastToken: totpInfo.token,
        lastCategory: undefined
      }
    ]

    startTotpTicker(ctx, mockApi, 1, items)

    // Advance 1s to 1700000035000 ms -> 5s remaining
    await advanceAndFlush(1000)

    expect(mockApi.UpdateResult).toHaveBeenCalledTimes(1)
    const updatePayload: UpdatableResult = (mockApi.UpdateResult as jest.Mock).mock.calls[0][1]

    // Tails must be updated with warning category
    expect(updatePayload.Tails).toBeDefined()
    expect(updatePayload.Tails?.[0]?.Text).toBe(totpInfo.formattedToken)
    expect(updatePayload.Tails?.[0]?.TextCategory).toBe("warning")

    // Preview must also show 5s and warning category
    const previewData = JSON.parse(updatePayload.Preview?.PreviewData || "{}") as WoxPreviewListData
    const totpRow = previewData.items?.find(i => i.subtitle === "TOTP")
    expect(totpRow?.tails?.[0]?.Text).toBe("5s")
    expect(totpRow?.tails?.[0]?.TextCategory).toBe("warning")
  })

  test("rotates token and resets warning category when 30s period boundary is crossed", async () => {
    // 1700000039000 ms: 1700000039 % 30 = 29s into period -> 1s remaining (warning)
    const baseTime = 1700000039000
    jest.setSystemTime(baseTime)

    const entry = createMockEntry("Entry1", "user1", sampleUri30s)
    const oldTotp = getEntryTotp(sampleUri30s, baseTime)!
    expect(oldTotp.remainingSeconds).toBe(1)

    const items: ActiveTotpItem[] = [
      {
        id: "entry-1",
        entry,
        lastToken: oldTotp.token,
        lastCategory: "warning"
      }
    ]

    startTotpTicker(ctx, mockApi, 1, items)

    // Advance 1s to 1700000040000 ms -> exactly start of new period -> 30s remaining
    await advanceAndFlush(1000)

    expect(mockApi.UpdateResult).toHaveBeenCalledTimes(1)
    const updatePayload: UpdatableResult = (mockApi.UpdateResult as jest.Mock).mock.calls[0][1]

    const newTotp = getEntryTotp(sampleUri30s, 1700000040000)!
    expect(newTotp.token).not.toBe(oldTotp.token)
    expect(newTotp.remainingSeconds).toBe(30)

    // Tails updated with new token and cleared warning category
    expect(updatePayload.Tails).toBeDefined()
    expect(updatePayload.Tails?.[0]?.Text).toBe(newTotp.formattedToken)
    expect(updatePayload.Tails?.[0]?.TextCategory).toBeUndefined()

    // Preview updated with 30s and cleared warning category
    const previewData = JSON.parse(updatePayload.Preview?.PreviewData || "{}") as WoxPreviewListData
    const totpRow = previewData.items?.find(i => i.subtitle === "TOTP")
    expect(totpRow?.title).toBe(newTotp.formattedToken)
    expect(totpRow?.tails?.[0]?.Text).toBe("30s")
    expect(totpRow?.tails?.[0]?.TextCategory).toBeUndefined()
  })

  test("supports Steam Guard alphanumeric TOTP and updates under single ticker", async () => {
    // 1700000030000 ms: 1700000030 % 30 = 20s into period -> 10s remaining
    const baseTime = 1700000030000
    jest.setSystemTime(baseTime)

    const entry = createMockEntry("SteamEntry", "steamuser", sampleUriSteam)
    const steamInfo = getEntryTotp(sampleUriSteam, baseTime)!
    expect(steamInfo.remainingSeconds).toBe(10)
    expect(steamInfo.formattedToken).toHaveLength(5)

    const items: ActiveTotpItem[] = [
      {
        id: "steam-1",
        entry,
        lastToken: steamInfo.token,
        lastCategory: undefined
      }
    ]

    startTotpTicker(ctx, mockApi, 1, items)

    // Advance 5 times 1s to 1700000035000 ms -> 5s remaining (warning)
    for (let i = 0; i < 5; i++) {
      await advanceAndFlush(1000)
    }

    const lastCall = (mockApi.UpdateResult as jest.Mock).mock.calls.pop()
    const updatePayload: UpdatableResult = lastCall[1]
    expect(updatePayload.Tails?.[0]?.Text).toBe(steamInfo.formattedToken)
    expect(updatePayload.Tails?.[0]?.TextCategory).toBe("warning")

    const previewData = JSON.parse(updatePayload.Preview?.PreviewData || "{}") as WoxPreviewListData
    const totpRow = previewData.items?.find(i => i.subtitle === "TOTP")
    expect(totpRow?.title).toBe(steamInfo.formattedToken)
    expect(totpRow?.tails?.[0]?.Text).toBe("5s")
  })

  test("monotonic queryId guard prevents stale ticks from updating results after new query arrives", async () => {
    const baseTime = 1700000000000
    jest.setSystemTime(baseTime)

    const entry = createMockEntry("Entry1", "user1", sampleUri30s)
    const totpInfo = getEntryTotp(sampleUri30s, baseTime)!
    const items: ActiveTotpItem[] = [
      {
        id: "entry-1",
        entry,
        lastToken: totpInfo.token,
        lastCategory: undefined
      }
    ]

    // Start query 1
    startTotpTicker(ctx, mockApi, 1, items)

    // New query 2 arrives before first tick
    startTotpTicker(ctx, mockApi, 2, [])

    // Advance timers
    await advanceAndFlush(2000)

    // No updates should have been dispatched for query 1
    expect(mockApi.UpdateResult).not.toHaveBeenCalled()
    expect(isTickerActive()).toBe(false)
  })

  test("stops ticker immediately and clears tracking when api.IsVisible returns false", async () => {
    const baseTime = 1700000000000
    jest.setSystemTime(baseTime)

    const entry = createMockEntry("Entry1", "user1", sampleUri30s)
    const totpInfo = getEntryTotp(sampleUri30s, baseTime)!
    const items: ActiveTotpItem[] = [
      {
        id: "entry-1",
        entry,
        lastToken: totpInfo.token,
        lastCategory: undefined
      }
    ]

    // Mock window visibility to false
    mockApi.IsVisible = jest.fn().mockResolvedValue(false)

    startTotpTicker(ctx, mockApi, 1, items)
    expect(isTickerActive()).toBe(true)

    // Advance by 1000ms -> tick runs, sees IsVisible=false, and tears down
    await advanceAndFlush(1000)

    expect(isTickerActive()).toBe(false)
    expect(getActiveTrackerCount()).toBe(0)
    expect(mockApi.UpdateResult).not.toHaveBeenCalled()
  })

  test("drops entry from active tracker when UpdateResult returns false, and stops ticker when all items dropped", async () => {
    const baseTime = 1700000000000
    jest.setSystemTime(baseTime)

    const entry1 = createMockEntry("Entry1", "user1", sampleUri30s)
    const entry2 = createMockEntry("Entry2", "user2", sampleUri30s)
    const totpInfo = getEntryTotp(sampleUri30s, baseTime)!

    const items: ActiveTotpItem[] = [
      {
        id: "entry-1",
        entry: entry1,
        lastToken: totpInfo.token,
        lastCategory: undefined
      },
      {
        id: "entry-2",
        entry: entry2,
        lastToken: totpInfo.token,
        lastCategory: undefined
      }
    ]

    // entry-1 returns false (no longer in UI), entry-2 returns true
    mockApi.UpdateResult = jest.fn().mockImplementation(async (_c: Context, payload: UpdatableResult) => {
      return payload.Id === "entry-2"
    })

    startTotpTicker(ctx, mockApi, 1, items)
    expect(getActiveTrackerCount()).toBe(2)

    // Tick 1: entry-1 dropped, entry-2 remains
    await advanceAndFlush(1000)

    expect(getActiveTrackerCount()).toBe(1)
    expect(isTickerActive()).toBe(true)

    // Now entry-2 also returns false
    mockApi.UpdateResult = jest.fn().mockResolvedValue(false)

    // Tick 2: entry-2 dropped -> all items gone -> ticker stops
    await advanceAndFlush(1000)

    expect(getActiveTrackerCount()).toBe(0)
    expect(isTickerActive()).toBe(false)
  })

  test("session.lock() notifies listeners and immediately terminates active ticker", () => {
    const baseTime = 1700000000000
    jest.setSystemTime(baseTime)

    const entry = createMockEntry("Entry1", "user1", sampleUri30s)
    const totpInfo = getEntryTotp(sampleUri30s, baseTime)!
    const items: ActiveTotpItem[] = [
      {
        id: "entry-1",
        entry,
        lastToken: totpInfo.token,
        lastCategory: undefined
      }
    ]

    // Wire session.onLock to stopTotpTicker as index.ts does
    const unregister = session.onLock(() => {
      stopTotpTicker()
    })

    try {
      startTotpTicker(ctx, mockApi, 1, items)
      expect(isTickerActive()).toBe(true)
      expect(getActiveTrackerCount()).toBe(1)

      // Explicit or timeout lock
      session.lock()

      expect(isTickerActive()).toBe(false)
      expect(getActiveTrackerCount()).toBe(0)
    } finally {
      unregister()
    }
  })
})
