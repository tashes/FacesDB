import { beforeEach, afterEach, describe, expect, test, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import os from 'os'
import { spawn } from 'child_process'
import { fileURLToPath } from 'url'

const originalFsRoot = process.env.FS
let testRoot = null

async function loadStore() {
  return await import('../../lib/keyValueStore.js')
}

const worker = fileURLToPath(new URL('../fixtures/kv-worker.js', import.meta.url))

function setInWorker(root, key, value) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [worker, "set", root, key, JSON.stringify(value)],
      { stdio: ["ignore", "ignore", "pipe"] },
    )
    let stderr = ""
    child.stderr.on("data", (chunk) => {
      stderr += chunk
    })
    child.on("error", reject)
    child.on("exit", (code) => {
      if (code === 0) resolve()
      else reject(new Error(`Worker exited ${code}: ${stderr}`))
    })
  })
}

beforeEach(() => {
  testRoot = mkdtempSync(join(os.tmpdir(), "facesdb-kv-"))
  process.env.FS = testRoot
  vi.resetModules()
})

afterEach(() => {
  process.env.FS = originalFsRoot
  if (testRoot) {
    rmSync(testRoot, { recursive: true, force: true })
    testRoot = null
  }
})

describe("keyValueStore", () => {
  test("set/get/has keep isolated copies", async () => {
    const { setKV, getKV, hasKV } = await loadStore()
    const payload = { userId: 42, flags: ["beta"] }
    const stored = await setKV("session", payload)

    stored.flags.push("gamma")
    payload.userId = 100

    expect(await hasKV("session")).toBe(true)

    const fetched = await getKV("session")
    expect(fetched).toEqual({ userId: 42, flags: ["beta"] })
  })

  test("deleteKV removes entries and reports status", async () => {
    const { setKV, deleteKV, hasKV } = await loadStore()

    expect(await deleteKV("missing")).toBe(false)

    await setKV("token", "abc")
    expect(await deleteKV("token")).toBe(true)
    expect(await hasKV("token")).toBe(false)
  })

  test("persists across module reloads", async () => {
    let store = await loadStore()
    await store.setKV("cache", { value: "abc123" })

    vi.resetModules()
    store = await loadStore()

    const value = await store.getKV("cache")
    expect(value).toEqual({ value: "abc123" })
  })

  test("does not lose simultaneous writes from separate processes", async () => {
    await Promise.all(Array.from({ length: 8 }, (_, index) => (
      setInWorker(testRoot, `worker-${index}`, { index })
    )))

    const { getKV } = await loadStore()
    for (let index = 0; index < 8; index++) {
      expect(await getKV(`worker-${index}`)).toEqual({ index })
    }
  })

  test("refreshes reads after another process commits", async () => {
    const { getKV } = await loadStore()
    expect(await getKV("external")).toBeUndefined()

    await setInWorker(testRoot, "external", "visible")
    expect(await getKV("external")).toBe("visible")
  })

  test("accepts a key matching the internal commit lock label", async () => {
    const { setKV, getKV } = await loadStore()
    await setKV("facesdb:kv:commit", "safe", { timeoutMs: 100 })
    expect(await getKV("facesdb:kv:commit")).toBe("safe")
  })
})
