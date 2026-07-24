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
  vi.restoreAllMocks()
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

  test("setManyKV commits values together and returns isolated input-aligned copies", async () => {
    const { setManyKV, getKV } = await loadStore()
    const first = { position: 1, tags: ["first"] }
    const last = { position: 2, tags: ["last"] }

    const stored = await setManyKV([
      ["duplicate", first],
      ["other", { enabled: true }],
      ["duplicate", last],
    ])

    expect(stored).toEqual([first, { enabled: true }, last])
    stored[2].tags.push("changed")
    last.position = 3
    expect(await getKV("duplicate")).toEqual({ position: 2, tags: ["last"] })
    expect(await getKV("other")).toEqual({ enabled: true })
  })

  test("uses a constant number of tickets for a large multi-key batch", async () => {
    const { observeKVLocks, setManyKV } = await import('../../main.js')
    const events = []
    const unsubscribe = observeKVLocks((event) => events.push(event))

    await setManyKV(Array.from({ length: 100 }, (_, index) => [
      `batch-ticket-${index}`,
      index,
    ]))
    unsubscribe()

    const queued = events.filter((event) => (
      event.type === "queued" && event.operation === "setManyKV"
    ))
    expect(queued).toHaveLength(2)
    expect(queued[0].keyCount).toBe(100)
  })

  test("deleteManyKV reports each input result and handles duplicate keys", async () => {
    const { setManyKV, deleteManyKV, hasKV } = await loadStore()
    await setManyKV([
      ["first", 1],
      ["second", 2],
    ])

    const deleted = await deleteManyKV(["first", "missing", "first", "second"])

    expect(deleted).toEqual([true, false, false, true])
    expect(await hasKV("first")).toBe(false)
    expect(await hasKV("second")).toBe(false)
  })

  test("validates and clones the full set batch before committing", async () => {
    const { setKV, setManyKV, getKV } = await loadStore()
    await setKV("existing", { value: "original" })
    const cyclic = {}
    cyclic.self = cyclic

    await expect(setManyKV([
      ["existing", { value: "changed" }],
      ["invalid", cyclic],
      ["later", true],
    ])).rejects.toThrow("Cannot start setManyKV")

    expect(await getKV("existing")).toEqual({ value: "original" })
    expect(await getKV("later")).toBeUndefined()
  })

  test("validates the full delete batch before committing", async () => {
    const { setManyKV, deleteManyKV, hasKV } = await loadStore()
    await setManyKV([["keep", true]])

    await expect(deleteManyKV(["keep", ""])).rejects.toThrow(
      "Cannot start deleteManyKV",
    )

    expect(await hasKV("keep")).toBe(true)
  })

  test("empty batches are successful no-ops", async () => {
    const { setManyKV, deleteManyKV } = await loadStore()

    expect(await setManyKV([], { priority: "background" })).toEqual([])
    expect(await deleteManyKV([], { namespace: "cache-rebuild" })).toEqual([])
  })

  test("validates options even when a batch is empty", async () => {
    const { setManyKV, deleteManyKV } = await loadStore()

    await expect(setManyKV([], { priority: "urgent" }))
      .rejects.toThrow("Cannot start setManyKV")
    await expect(deleteManyKV([], { timeoutMs: -1 }))
      .rejects.toThrow("Cannot start deleteManyKV")
  })

  test("persists a non-empty batch exactly once", async () => {
    const { readWal } = await import('../../lib/kvPersistence.js')
    const { setManyKV } = await loadStore()
    await setManyKV(Array.from({ length: 50 }, (_, index) => [
      `key-${index}`,
      { index },
    ]))

    const records = readWal(join(testRoot, ".kvstore.wal"))
    expect(records).toHaveLength(1)
    expect(records[0].operations).toHaveLength(50)
  })

  test("persists an all-missing delete batch as one atomic WAL record", async () => {
    const { readWal } = await import('../../lib/kvPersistence.js')
    const { deleteManyKV } = await loadStore()

    expect(await deleteManyKV(["missing-one", "missing-two"])).toEqual([false, false])
    const records = readWal(join(testRoot, ".kvstore.wal"))
    expect(records).toHaveLength(1)
    expect(records[0].operations).toEqual([])
  })

  test("keeps memory and disk unchanged when persistence fails", async () => {
    const { KVWalPersistence } = await import('../../lib/kvPersistence.js')
    let store = await loadStore()
    await store.setKV("existing", "original")
    const commit = vi.spyOn(KVWalPersistence.prototype, "commit")
      .mockRejectedValueOnce(new Error("injected write failure"))
    await expect(store.setManyKV([
      ["existing", "changed"],
      ["new", true],
    ])).rejects.toThrow("injected write failure")
    commit.mockRestore()

    expect(await store.getKV("existing")).toBe("original")
    expect(await store.getKV("new")).toBeUndefined()

    await store.setManyKV([["after-failure", true]])
    vi.resetModules()
    store = await loadStore()
    expect(await store.getKV("existing")).toBe("original")
    expect(await store.getKV("new")).toBeUndefined()
    expect(await store.getKV("after-failure")).toBe(true)
  })

  test("serializes concurrent batches without losing updates", async () => {
    const { setManyKV, getKV } = await loadStore()
    const batches = Array.from({ length: 10 }, (_, batch) => {
      return Array.from({ length: 10 }, (_, item) => [
        `batch-${batch}-item-${item}`,
        { batch, item },
      ])
    })

    await Promise.all(batches.map((entries) => setManyKV(entries)))

    for (let batch = 0; batch < 10; batch += 1) {
      for (let item = 0; item < 10; item += 1) {
        expect(await getKV(`batch-${batch}-item-${item}`)).toEqual({ batch, item })
      }
    }
  })

  test("migrates streaming KV imports to disk-backed segmented mode", async () => {
    const { readWal } = await import('../../lib/kvPersistence.js')
    const { deleteKV, getKV, importManyKV, setKV } = await loadStore()
    await setKV("existing", { before: true })
    async function* entries() {
      for (let index = 0; index < 25; index += 1) {
        yield [`stream-${index}`, { index }]
      }
    }

    expect(await importManyKV(entries())).toEqual({
      count: 25,
      batches: 1,
    })
    expect(readWal(join(testRoot, ".kvstore.wal"))).toHaveLength(1)
    expect(await getKV("existing")).toEqual({ before: true })
    expect(await getKV("stream-24")).toEqual({ index: 24 })
    await setKV("stream-24", { updated: true })
    expect(await getKV("stream-24")).toEqual({ updated: true })
    expect(await deleteKV("stream-24")).toBe(true)
    expect(await getKV("stream-24")).toBeUndefined()

    vi.resetModules()
    const reloaded = await loadStore()
    expect(await reloaded.getKV("existing")).toEqual({ before: true })
    expect(await reloaded.getKV("stream-24")).toBeUndefined()
  })
})
