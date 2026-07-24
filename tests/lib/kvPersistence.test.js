import {
  appendFileSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'fs'
import { spawn } from 'child_process'
import { fileURLToPath, pathToFileURL } from 'url'
import { dirname, join, resolve } from 'path'
import os from 'os'

import { afterEach, describe, expect, test, vi } from 'vitest'

import { KVWalPersistence, readWal } from '../../lib/kvPersistence.js'

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..")
const storeModule = pathToFileURL(join(projectRoot, "lib/keyValueStore.js")).href
const roots = []

function temporaryRoot() {
  const root = mkdtempSync(join(os.tmpdir(), "facesdb-wal-"))
  roots.push(root)
  return root
}

function runChild(root, key, value) {
  const script = `
    process.env.FS = ${JSON.stringify(root)}
    const { setKV } = await import(${JSON.stringify(storeModule)})
    await setKV(${JSON.stringify(key)}, ${JSON.stringify(value)})
  `
  return new Promise((resolveChild, reject) => {
    const child = spawn(process.execPath, ["--input-type=module", "--eval", script], {
      cwd: projectRoot,
      stdio: ["ignore", "pipe", "pipe"],
    })
    let stderr = ""
    child.stderr.on("data", (chunk) => { stderr += chunk })
    child.on("error", reject)
    child.on("close", (code) => {
      if (code === 0) resolveChild()
      else reject(new Error(stderr))
    })
  })
}

afterEach(() => {
  while (roots.length > 0) rmSync(roots.pop(), { recursive: true, force: true })
})

describe("KVWalPersistence", () => {
  test("appends checksummed sequence records and reloads them", async () => {
    const root = temporaryRoot()
    const persistence = new KVWalPersistence(root)
    await persistence.initialize()
    await persistence.commit([{ type: "set", key: "one", value: { count: 1 } }])
    await persistence.commit([{ type: "delete", key: "one" }])

    const records = readWal(join(root, ".kvstore.wal"))
    expect(records.map(({ sequence }) => sequence)).toEqual([1, 2])
    expect((await new KVWalPersistence(root).read()).store.has("one")).toBe(false)
  })

  test("repairs an incomplete final frame without losing valid records", async () => {
    const root = temporaryRoot()
    const persistence = new KVWalPersistence(root)
    await persistence.initialize()
    await persistence.commit([{ type: "set", key: "safe", value: true }])
    const walPath = join(root, ".kvstore.wal")
    const validSize = statSync(walPath).size
    appendFileSync(walPath, Buffer.from([0, 0, 0]))

    const recovered = await new KVWalPersistence(root).read()
    expect(recovered.store.get("safe")).toBe(true)
    expect(statSync(walPath).size).toBe(validSize)
  })

  test("fails loudly on checksum corruption before the log tail", async () => {
    const root = temporaryRoot()
    const persistence = new KVWalPersistence(root)
    await persistence.initialize()
    await persistence.commit([{ type: "set", key: "one", value: 1 }])
    await persistence.commit([{ type: "set", key: "two", value: 2 }])
    const walPath = join(root, ".kvstore.wal")
    const wal = readFileSync(walPath)
    wal[8] ^= 1
    writeFileSync(walPath, wal)

    expect(() => persistence.loadState(true)).toThrow(/Corrupt WAL checksum/)
  })

  test("migrates the legacy object and retains a backup", async () => {
    const root = temporaryRoot()
    writeFileSync(join(root, ".kvstore"), JSON.stringify({ legacy: { okay: true } }))
    const persistence = new KVWalPersistence(root)
    await persistence.initialize()

    expect((await persistence.read()).store.get("legacy")).toEqual({ okay: true })
    expect(existsSync(join(root, ".kvstore"))).toBe(false)
    expect(existsSync(join(root, ".kvstore.legacy"))).toBe(true)
  })

  test("compacts via rotation and preserves later reloads", async () => {
    const root = temporaryRoot()
    const persistence = new KVWalPersistence(root, { compactRecords: 2 })
    await persistence.initialize()
    await persistence.commit([{ type: "set", key: "one", value: 1 }])
    await persistence.commit([{ type: "set", key: "two", value: 2 }])
    await persistence.compaction

    expect(readWal(join(root, ".kvstore.wal"))).toEqual([])
    expect(existsSync(join(root, ".kvstore.wal.rotating"))).toBe(false)
    expect(Object.fromEntries((await new KVWalPersistence(root).read()).store)).toEqual({
      one: 1,
      two: 2,
    })
  })

  test("keeps cached state hot after its own background compaction", async () => {
    const root = temporaryRoot()
    const persistence = new KVWalPersistence(root, { compactRecords: 2 })
    await persistence.initialize()
    const loadState = vi.spyOn(persistence, "loadState")
    await persistence.commit([{ type: "set", key: "one", value: 1 }])
    await persistence.commit([{ type: "set", key: "two", value: 2 }])
    await persistence.compaction

    expect((await persistence.read()).store.get("two")).toBe(2)
    expect(loadState).not.toHaveBeenCalled()
  })

  test("preserves commits racing background compaction", async () => {
    const root = temporaryRoot()
    const persistence = new KVWalPersistence(root)
    await persistence.initialize()
    await persistence.commit([{ type: "set", key: "before", value: true }])

    await Promise.all([
      persistence.compact(),
      persistence.commit([{ type: "set", key: "during", value: true }]),
    ])

    const reloaded = await new KVWalPersistence(root).read()
    expect(Object.fromEntries(reloaded.store)).toEqual({ before: true, during: true })
  })

  test("finishes a compaction interrupted after WAL rotation", async () => {
    const root = temporaryRoot()
    const persistence = new KVWalPersistence(root)
    await persistence.initialize()
    await persistence.commit([{ type: "set", key: "durable", value: "yes" }])
    renameSync(join(root, ".kvstore.wal"), join(root, ".kvstore.wal.rotating"))
    writeFileSync(join(root, ".kvstore.wal"), "")

    const recovered = new KVWalPersistence(root)
    await recovered.initialize()
    expect((await recovered.read()).store.get("durable")).toBe("yes")
    expect(existsSync(join(root, ".kvstore.wal.rotating"))).toBe(false)
  })

  test("serializes concurrent writers in separate processes", async () => {
    const root = temporaryRoot()
    await Promise.all([
      runChild(root, "alpha", { writer: 1 }),
      runChild(root, "beta", { writer: 2 }),
      runChild(root, "gamma", { writer: 3 }),
    ])

    const persistence = new KVWalPersistence(root)
    await persistence.initialize()
    expect(Object.fromEntries((await persistence.read()).store)).toEqual({
      alpha: { writer: 1 },
      beta: { writer: 2 },
      gamma: { writer: 3 },
    })
    expect(readWal(join(root, ".kvstore.wal")).map((record) => record.sequence)).toEqual([
      1,
      2,
      3,
    ])
  })

  test("refreshes an existing reader after another process commits", async () => {
    const root = temporaryRoot()
    const persistence = new KVWalPersistence(root)
    await persistence.initialize()
    expect((await persistence.read()).store.has("remote")).toBe(false)

    await runChild(root, "remote", { visible: true })

    expect((await persistence.read()).store.get("remote")).toEqual({ visible: true })
  })

  test("tails new WAL frames without rebuilding the cached snapshot state", async () => {
    const root = temporaryRoot()
    const reader = new KVWalPersistence(root)
    await reader.initialize()
    const loadState = vi.spyOn(reader, "loadState")

    const writer = new KVWalPersistence(root)
    await writer.initialize()
    await writer.commit([{ type: "set", key: "incremental", value: true }])

    expect((await reader.read()).store.get("incremental")).toBe(true)
    expect(loadState).not.toHaveBeenCalled()
  })
})
