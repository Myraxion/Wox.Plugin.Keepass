import { Context, PublicAPI, UpdatableResult } from "@wox-launcher/wox-plugin"
import { ActiveTotpItem, getFieldText } from "./search"
import { getEntryTotp } from "./totp"
import { buildEntryPreview } from "./preview"

let activeTimeout: NodeJS.Timeout | null = null
let activeInterval: NodeJS.Timeout | null = null
let activeQueryId: number = 0
const activeItems: Map<string, ActiveTotpItem> = new Map()
let isTicking = false

export function isTickerActive(): boolean {
  return activeTimeout !== null || activeInterval !== null
}

export function getActiveTrackerCount(): number {
  return activeItems.size
}

export function stopTotpTicker(): void {
  if (activeTimeout) {
    clearTimeout(activeTimeout)
    activeTimeout = null
  }
  if (activeInterval) {
    clearInterval(activeInterval)
    activeInterval = null
  }
  activeItems.clear()
  isTicking = false
}

export function startTotpTicker(ctx: Context, api: PublicAPI, queryId: number, items: ActiveTotpItem[]): void {
  stopTotpTicker()

  if (!items || items.length === 0) {
    return
  }

  activeQueryId = queryId
  for (const item of items) {
    activeItems.set(item.id, { ...item })
  }

  const now = Date.now()
  const delay = 1000 - (now % 1000)

  const tick = async () => {
    if (isTicking) {
      return
    }

    if (activeQueryId !== queryId) {
      return
    }

    if (api.IsVisible) {
      try {
        const visible = await api.IsVisible(ctx)
        if (!visible) {
          stopTotpTicker()
          return
        }
      } catch {
        // ignore
      }
    }

    if (activeItems.size === 0) {
      stopTotpTicker()
      return
    }

    isTicking = true
    try {
      const currentNow = Date.now()

      for (const [id, item] of Array.from(activeItems.entries())) {
        if (activeQueryId !== queryId) {
          return
        }

        const otpField = getFieldText(item.entry.entry.fields.get("otp"))
        const totpInfo = getEntryTotp(otpField, currentNow)
        if (!totpInfo) {
          activeItems.delete(id)
          continue
        }

        const currentCategory = totpInfo.category
        const tokenChanged = totpInfo.token !== item.lastToken
        const categoryChanged = currentCategory !== item.lastCategory

        const updatedPreview = buildEntryPreview(item.entry, currentNow)
        const updatePayload: UpdatableResult = {
          Id: id,
          Preview: updatedPreview
        }

        if (tokenChanged || categoryChanged) {
          updatePayload.Tails = [
            {
              Type: "text",
              Text: totpInfo.formattedToken,
              TextCategory: currentCategory
            }
          ]
        }

        let updateSucceeded = true
        if (api.UpdateResult) {
          try {
            const success = await api.UpdateResult(ctx, updatePayload)
            if (success === false) {
              activeItems.delete(id)
              updateSucceeded = false
            }
          } catch {
            updateSucceeded = false
          }
        }

        if (updateSucceeded) {
          if (tokenChanged) {
            item.lastToken = totpInfo.token
          }
          if (categoryChanged) {
            item.lastCategory = currentCategory
          }
        }
      }

      if (activeItems.size === 0) {
        stopTotpTicker()
      }
    } finally {
      isTicking = false
    }
  }

  activeTimeout = setTimeout(async () => {
    activeTimeout = null
    await tick()
    if (activeQueryId === queryId && activeItems.size > 0 && !activeInterval) {
      activeInterval = setInterval(() => {
        void tick()
      }, 1000)
      if (activeInterval.unref) {
        activeInterval.unref()
      }
    }
  }, delay)

  if (activeTimeout.unref) {
    activeTimeout.unref()
  }
}
