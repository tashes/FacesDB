import {
  appendFileSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'fs'
import { spawn } from 'child_process'
import { fileURLToPath, pathToFileURL } from 'url'
import { dirname, join, resolve } from 'path'
import os from 'os'

import { afterEach, describe, expect, test } from 'vitest'

import { KVCachePersistence } from '../../lib/kvPersistence.js'

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..")
const storeModule = pathToFileURL(join(projectRoot, "lib/keyValueStore.js")).href
const roots = []

function temporaryRoot() {
  const root = mkdtempSync(join(os.tmpdir(), "facesdb-cache-"))
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
      stdio: ["ignore", "ignore", "pipe"],
    })
    let stderr = ""
    child.stderr.on("data", (chunk) => { stderr += chunk })
    child.on("error", reject)
    child.on("close", (code) => code === 0 ? resolveChild() : reject(new Error(stderr)))
  })
}

function samePartition(persistence) {
  const groups = new Map()
  for (let index = 0; index < 10_000; index += 1) {
    const key = `key-${index}`
    const code = persistence.partition(key)
    if (groups.has(code)) return [groups.get(code), key, code]
    groups.set(code, key)
  }
  throw new Error("Unable to find partition collision")
}

afterEach(() => {
  while (roots.length > 0) rmSync(roots.pop(), { recursive: true, force: true })
})

describe("KVCachePersistence", () => {
  test("appends checksummed records and reads them incrementally", async () => {
    const root = temporaryRoot()
    const persistence = new KVCachePersistence(root)
    await persistence.initialize()
    await persistence.append([{
      key: "one",
      revision: 1,
      operation: "set",
      value: { count: 1 },
    }])
    expect((await persistence.read(["one"])).get("one").value).toEqual({ count: 1 })
    await persistence.append([{ key: "one", revision: 2, operation: "delete" }])
    expect((await persistence.read(["one"])).get("one").operation).toBe("delete")
  })

  test("ignores an incomplete final cache record", async () => {
    const root = temporaryRoot()
    const persistence = new KVCachePersistence(root)
    await persistence.initialize()
    await persistence.append([{ key: "safe", revision: 1, operation: "set", value: true }])
    const code = persistence.partition("safe")
    const writers = join(root, ".kvstore-cache", "partitions", code, "writers")
    const log = join(writers, readdirSync(writers)[0])
    appendFileSync(log, '{"incomplete":')

    const reader = new KVCachePersistence(root)
    await reader.initialize()
    expect((await reader.read(["safe"])).get("safe").value).toBe(true)
  })

  test("migrates the legacy object and retains a backup", async () => {
    const root = temporaryRoot()
    writeFileSync(join(root, ".kvstore"), JSON.stringify({ legacy: { okay: true } }))
    const persistence = new KVCachePersistence(root)
    await persistence.initialize()

    expect((await persistence.read(["legacy"])).get("legacy").value).toEqual({ okay: true })
    expect(existsSync(join(root, ".kvstore"))).toBe(false)
    expect(existsSync(join(root, ".kvstore.legacy"))).toBe(true)
  })

  test("rotates and compacts one partition without blocking active logs", async () => {
    const root = temporaryRoot()
    const persistence = new KVCachePersistence(root, { rotateRecords: 2 })
    await persistence.initialize()
    const [first, second, code] = samePartition(persistence)
    await persistence.append([
      { key: first, revision: 1, operation: "set", value: 1 },
      { key: second, revision: 1, operation: "set", value: 2 },
    ])
    await persistence.compactions.get(code)

    expect(existsSync(join(root, ".kvstore-cache", "partitions", code, "CURRENT"))).toBe(true)
    const reader = new KVCachePersistence(root)
    await reader.initialize()
    const records = await reader.read([first, second])
    expect(records.get(first).value).toBe(1)
    expect(records.get(second).value).toBe(2)
  })

  test("preserves writes made while a sealed log is compacted", async () => {
    const root = temporaryRoot()
    const persistence = new KVCachePersistence(root, { rotateRecords: 1 })
    await persistence.initialize()
    await persistence.append([{ key: "before", revision: 1, operation: "set", value: true }])
    await persistence.append([{ key: "during", revision: 1, operation: "set", value: true }])
    await Promise.all([...persistence.compactions.values()])

    const reader = new KVCachePersistence(root)
    await reader.initialize()
    expect((await reader.read(["before", "during"])).get("before").value).toBe(true)
    expect((await reader.read(["before", "during"])).get("during").value).toBe(true)
  })

  test("keeps separate process writer lanes visible", async () => {
    const root = temporaryRoot()
    await Promise.all([
      runChild(root, "alpha", { writer: 1 }),
      runChild(root, "beta", { writer: 2 }),
      runChild(root, "gamma", { writer: 3 }),
    ])
    const persistence = new KVCachePersistence(root)
    await persistence.initialize()
    const records = await persistence.read(["alpha", "beta", "gamma"])
    expect(records.get("alpha").value).toEqual({ writer: 1 })
    expect(records.get("beta").value).toEqual({ writer: 2 })
    expect(records.get("gamma").value).toEqual({ writer: 3 })
  })

  test("refreshes an existing reader after another process appends", async () => {
    const root = temporaryRoot()
    const persistence = new KVCachePersistence(root)
    await persistence.initialize()
    expect((await persistence.read(["remote"])).get("remote")).toBeUndefined()
    await runChild(root, "remote", { visible: true })
    expect((await persistence.read(["remote"])).get("remote").value).toEqual({ visible: true })
  })

  test("stores cache data outside collection directories", async () => {
    const root = temporaryRoot()
    const persistence = new KVCachePersistence(root)
    await persistence.initialize()
    await persistence.append([{ key: "where", revision: 1, operation: "set", value: true }])
    const manifest = JSON.parse(readFileSync(join(root, ".kvstore-cache", "manifest.json")))
    expect(manifest).toMatchObject({ version: 2, partitions: 256 })
  })
})
