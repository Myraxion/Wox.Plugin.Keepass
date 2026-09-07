import fs from "fs"
import * as kdbxweb from "kdbxweb"

let currentDatabase: kdbxweb.Kdbx | null = null

export async function unlock(kdbxFilePath: string, keyFilePath: string | undefined, password: string): Promise<kdbxweb.Kdbx> {
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
  return db
}

export function lock(): void {
  currentDatabase = null
}

export function isUnlocked(): boolean {
  return currentDatabase !== null
}

export function getDatabase(): kdbxweb.Kdbx | null {
  return currentDatabase
}
