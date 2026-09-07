import * as kdbxweb from "kdbxweb"
import { argon2d, argon2id } from "hash-wasm"

let isArgon2Configured = false

export function setupArgon2(): void {
  if (isArgon2Configured) {
    return
  }

  kdbxweb.CryptoEngine.setArgon2Impl(
    async (password: ArrayBuffer, salt: ArrayBuffer, memory: number, iterations: number, length: number, parallelism: number, type: number, _version: number): Promise<ArrayBuffer> => {
      const options = {
        password: new Uint8Array(password),
        salt: new Uint8Array(salt),
        memorySize: memory,
        iterations,
        parallelism,
        hashLength: length,
        outputType: "binary" as const
      }

      const hash = type === kdbxweb.CryptoEngine.Argon2TypeArgon2d ? await argon2d(options) : await argon2id(options)

      const buffer = new ArrayBuffer(hash.byteLength)
      new Uint8Array(buffer).set(hash)
      return buffer
    }
  )

  isArgon2Configured = true
}
