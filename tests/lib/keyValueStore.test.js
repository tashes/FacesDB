import { beforeEach, afterEach, describe, expect, test, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import os from 'os'

const originalFsRoot = process.env.FS
let testRoot = null

async function loadStore() {
  return await import('../../lib/keyValueStore.js')
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

  test("accepts mutation scheduling options", async () => {
    const { setKV, deleteKV } = await loadStore()

    expect(await setKV("scheduled", "value", {
      priority: "background",
      timeoutMs: 1_000,
      namespace: "test",
    })).toBe("value")
    expect(await deleteKV("scheduled", { priority: "foreground" })).toBe(true)
  })

  test("rejects invalid mutation scheduling options without changing data", async () => {
    const { setKV, getKV } = await loadStore()
    await setKV("safe", "original")

    await expect(setKV("safe", "changed", { priority: "urgent" }))
      .rejects.toThrow("Priority")
    expect(await getKV("safe")).toBe("original")
  })
})
