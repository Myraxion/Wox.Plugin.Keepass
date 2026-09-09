import fs from "fs"
import * as kdbxweb from "kdbxweb"

let currentDatabase: kdbxweb.Kdbx | null = null
let currentKdbxPath: string | null = null
let lastMtimeMs: number | null = null
let lastActiveTimestamp: number = 0
let autoLockTimeoutSeconds: number = 900
let autoLockTimer: NodeJS.Timeout | null = null
let fileWatcher: fs.FSWatcher | null = null
type LockListener = () => void
const lockListeners: Set<LockListener> = new Set()

export function onLock(listener: LockListener): () => void {
  lockListeners.add(listener)
  return () => {
    lockListeners.delete(listener)
  }
}

function resetAutoLockTimer(): void {
  if (autoLockTimer) {
    clearTimeout(autoLockTimer)
    autoLockTimer = null
  }
  if (autoLockTimeoutSeconds > 0 && currentDatabase !== null) {
    autoLockTimer = setTimeout(() => {
      lock()
    }, autoLockTimeoutSeconds * 1000)
    if (autoLockTimer.unref) {
      autoLockTimer.unref()
    }
  }
}

function startFileWatcher(filePath: string): void {
  if (fileWatcher) {
    try {
      fileWatcher.close()
    } catch {
      // ignore
    }
    fileWatcher = null
  }

  try {
    fileWatcher = fs.watch(filePath, async () => {
      await checkMtime()
    })
    if (fileWatcher.unref) {
      fileWatcher.unref()
    }
  } catch {
    // fs.watch might not be supported in some environments
  }
}

export async function unlock(kdbxFilePath: string, keyFilePath: string | undefined, password: string, timeoutSeconds: number = 900): Promise<kdbxweb.Kdbx> {
  const kdbxData = await fs.promises.readFile(kdbxFilePath)
  const kdbxBuffer = new Uint8Array(kdbxData).slice().buffer as ArrayBuffer

  const passwordProtected = kdbxweb.ProtectedValue.fromString(password)

  let keyData: Uint8Array | null = null
  if (keyFilePath && keyFilePath.trim() !== "") {
    const keyFileBuffer = await fs.promises.readFile(keyFilePath.trim())
    keyData = new Uint8Array(keyFileBuffer)
  }

  const credentials = new kdbxweb.Credentials(passwordProtected, keyData)
  const db = await kdbxweb.Kdbx.load(kdbxBuffer, credentials)

  currentDatabase = db
  currentKdbxPath = kdbxFilePath
  autoLockTimeoutSeconds = timeoutSeconds
  lastActiveTimestamp = Date.now()

  try {
    const stats = await fs.promises.stat(kdbxFilePath)
    lastMtimeMs = stats.mtimeMs
  } catch {
    lastMtimeMs = null
  }

  resetAutoLockTimer()
  startFileWatcher(kdbxFilePath)

  return db
}

export function lock(): void {
  currentDatabase = null
  currentKdbxPath = null
  lastMtimeMs = null
  if (autoLockTimer) {
    clearTimeout(autoLockTimer)
    autoLockTimer = null
  }
  if (fileWatcher) {
    try {
      fileWatcher.close()
    } catch {
      // ignore
    }
    fileWatcher = null
  }
  lockListeners.forEach(listener => {
    try {
      listener()
    } catch {
      // ignore
    }
  })
}

export function touchActivity(): void {
  if (currentDatabase !== null) {
    lastActiveTimestamp = Date.now()
    resetAutoLockTimer()
  }
}

export function setAutoLockTimeout(seconds: number): void {
  autoLockTimeoutSeconds = seconds
  if (currentDatabase !== null) {
    resetAutoLockTimer()
  }
}

export async function checkMtime(): Promise<boolean> {
  if (!currentDatabase || !currentKdbxPath || lastMtimeMs === null) {
    return false
  }
  try {
    const stats = await fs.promises.stat(currentKdbxPath)
    if (stats.mtimeMs !== lastMtimeMs) {
      lock()
      return true
    }
  } catch {
    lock()
    return true
  }
  return false
}

export function isUnlocked(): boolean {
  if (currentDatabase === null) {
    return false
  }
  if (autoLockTimeoutSeconds > 0) {
    const elapsed = Date.now() - lastActiveTimestamp
    if (elapsed >= autoLockTimeoutSeconds * 1000) {
      lock()
      return false
    }
  }
  return true
}

export function getDatabase(): kdbxweb.Kdbx | null {
  if (!isUnlocked()) {
    return null
  }
  return currentDatabase
}
