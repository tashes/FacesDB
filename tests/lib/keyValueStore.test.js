import { beforeEach, afterEach, describe, expect, test, vi } from 'vitest'
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'fs'
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

function incrementInWorker(root, key, count) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [worker, "increment", root, key, `${count}`], {
      stdio: ["ignore", "ignore", "pipe"],
    })
    let stderr = ""
    child.stderr.on("data", (chunk) => { stderr += chunk })
    child.on("error", reject)
    child.on("exit", (code) => code === 0
      ? resolve()
      : reject(new Error(`Worker exited ${code}: ${stderr}`)))
  })
}

function cacheRecordCount(root) {
  const partitions = join(root, ".kvstore-cache", "partitions")
  try {
    return readdirSync(partitions).reduce((total, partition) => {
      const writers = join(partitions, partition, "writers")
      return total + readdirSync(writers).reduce((count, file) => {
        if (file.endsWith(".jsonl") === false) return count
        return count + readFileSync(join(writers, file), "utf8")
          .split("\n").filter(Boolean).length
      }, 0)
    }, 0)
  } catch (_) {
    return 0
  }
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

  test("getManyKV and hasManyKV preserve input order and duplicates", async () => {
    const { getManyKV, hasManyKV, setManyKV } = await loadStore()
    await setManyKV([["one", { value: 1 }], ["two", 2]])
    expect(await getManyKV(["two", "missing", "one", "two"]))
      .toEqual([2, undefined, { value: 1 }, 2])
    expect(await hasManyKV(["two", "missing", "one", "two"]))
      .toEqual([true, false, true, true])
  })

  test("updateKV prevents lost updates across processes", async () => {
    const { getKV, setKV } = await loadStore()
    await setKV("counter", 0)
    await Promise.all([
      incrementInWorker(testRoot, "counter", 10),
      incrementInWorker(testRoot, "counter", 10),
    ])
    expect(await getKV("counter")).toBe(20)
  })

  test("versioned compare-and-set rejects stale calculations", async () => {
    const { compareAndSetKV, getKV, getVersionedKV, setKV } = await loadStore()
    await setKV("article", { version: 1 })
    const observed = await getVersionedKV("article")
    await setKV("article", { version: 2 })
    expect(await compareAndSetKV("article", observed.revision, { version: 3 })).toBe(false)
    const current = await getVersionedKV("article")
    expect(await compareAndSetKV("article", current.revision, { version: 3 })).toBe(true)
    expect(await getKV("article")).toEqual({ version: 3 })
  })

  test("updateKV rejects asynchronous callbacks without changing the value", async () => {
    const { getKV, setKV, updateKV } = await loadStore()
    await setKV("quick", "original")
    await expect(updateKV("quick", async () => "late"))
      .rejects.toThrow("must be synchronous")
    expect(await getKV("quick")).toBe("original")
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

  test("uses one narrowly scoped ticket per unique batch key", async () => {
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
    expect(queued).toHaveLength(100)
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

  test("persists every non-empty batch entry", async () => {
    const { setManyKV } = await loadStore()
    await setManyKV(Array.from({ length: 50 }, (_, index) => [
      `key-${index}`,
      { index },
    ]))

    expect(cacheRecordCount(testRoot)).toBe(50)
  })

  test("does not persist tombstones for keys that never existed", async () => {
    const { deleteManyKV } = await loadStore()

    expect(await deleteManyKV(["missing-one", "missing-two"])).toEqual([false, false])
    expect(cacheRecordCount(testRoot)).toBe(0)
  })

  test("keeps memory and disk unchanged when persistence fails", async () => {
    const { KVCachePersistence } = await import('../../lib/kvPersistence.js')
    let store = await loadStore()
    await store.setKV("existing", "original")
    const commit = vi.spyOn(KVCachePersistence.prototype, "append")
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

  test("streams large KV imports in bounded atomic WAL batches", async () => {
    const { getKV, importManyKV } = await loadStore()
    async function* entries() {
      for (let index = 0; index < 25; index += 1) {
        yield [`stream-${index}`, { index }]
      }
    }

    expect(await importManyKV(entries(), { batchSize: 10 })).toEqual({
      count: 25,
      batches: 3,
    })
    expect(cacheRecordCount(testRoot)).toBe(25)
    expect(await getKV("stream-24")).toEqual({ index: 24 })
  })
})
