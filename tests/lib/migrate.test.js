import { beforeEach, afterEach, describe, test, expect } from "vitest"
import { mkdirSync, readFileSync, readdirSync, rmSync } from "fs"
import { join } from "path"
import os from "os"

import { migrate } from "../../lib/migrate.js"
import { createCollection } from "../../lib/createCollection.js"
import { createDocument } from "../../lib/createDocument.js"
import { createIndex } from "../../lib/createIndex.js"
import { viewDocument } from "../../lib/viewDocument.js"
import { path as resolveFs } from "../../utils/fs.js"

const originalFsRoot = process.env.FS
let testRoot = null

const LETTERS = "abcdefghijklmnopqrstuvwxyz"

function makeCollectionName(prefix) {
  const suffixLength = Math.max(1, 16 - prefix.length)
  let suffix = ""
  for (let i = 0; i < suffixLength; i++) {
    const index = Math.floor(Math.random() * LETTERS.length)
    suffix += LETTERS[index]
  }
  return `${prefix}${suffix}`.slice(0, 16)
}

beforeEach(() => {
  testRoot = join(
    os.tmpdir(),
    `facesdb-migrate-${Date.now()}-${Math.random().toString(16).slice(2)}`,
  )
  mkdirSync(testRoot, { recursive: true })
  process.env.FS = testRoot
})

afterEach(() => {
  process.env.FS = originalFsRoot
  if (testRoot) {
    rmSync(testRoot, { recursive: true, force: true })
    testRoot = null
  }
})

describe("migrate", () => {
  test("applies transformations and rebuilds indexes", async () => {
    const collection = makeCollectionName("users")
    await createCollection(collection)

    const created = []
    for (let i = 0; i < 3; i++) {
      const doc = await createDocument(collection, { a: i, label: `user-${i}` })
      created.push(doc._id)
    }

    await createIndex("byA", { a: true }, collection)

    const result = await migrate(collection, (doc) => ({
      ...doc,
      a: doc.a + 100,
      active: true,
    }))

    expect(result.migrated).toBe(3)
    expect(result.changed).toBe(3)

    for (let i = 0; i < created.length; i++) {
      const fresh = await viewDocument(collection, created[i])
      expect(fresh.a).toBe(i + 100)
      expect(fresh.active).toBe(true)
    }

    const indexPath = resolveFs(collection, "byA.jsonl")
    const lines = readFileSync(indexPath, "utf8")
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line))
    expect(lines).toHaveLength(3)
    for (const entry of lines) {
      expect(entry.a).toBeGreaterThanOrEqual(100)
    }
  })

  test("skips filesystem work when objects are unchanged", async () => {
    const collection = makeCollectionName("nochange")
    await createCollection(collection)
    const original = await createDocument(collection, { flag: true })

    const result = await migrate(collection, (doc) => ({ ...doc }))

    expect(result.changed).toBe(0)
    const stored = await viewDocument(collection, original._id)
    expect(stored.flag).toBe(true)

    const collectionPath = resolveFs(collection)
    const entries = readdirSync(collectionPath)
    const tmpDirs = entries.filter((entry) => entry.startsWith(".tmp-migrate-"))
    expect(tmpDirs).toHaveLength(0)
  })

  test("throws and rolls back when _id changes", async () => {
    const collection = makeCollectionName("mismatch")
    await createCollection(collection)
    const original = await createDocument(collection, { count: 1 })

    await expect(
      migrate(collection, (doc) => ({ ...doc, _id: `${doc._id.slice(0, -1)}0` })),
    ).rejects.toThrow()

    const stored = await viewDocument(collection, original._id)
    expect(stored.count).toBe(1)
  })

  test("throws and restores when callback errors", async () => {
    const collection = makeCollectionName("throw")
    await createCollection(collection)
    const original = await createDocument(collection, { name: "entry" })

    await expect(
      migrate(collection, () => {
        throw new Error("boom")
      }),
    ).rejects.toThrow("boom")

    const stored = await viewDocument(collection, original._id)
    expect(stored.name).toBe("entry")
  })

  test("handles large collections with parallel work", async () => {
    const collection = makeCollectionName("bulk")
    await createCollection(collection)

    const total = 1005
    const ids = []
    for (let i = 0; i < total; i++) {
      const doc = await createDocument(collection, { idx: i })
      ids.push(doc._id)
    }

    const result = await migrate(collection, (doc) => ({ ...doc, migrated: true }))

    expect(result.migrated).toBe(total)
    expect(result.changed).toBe(total)

    const sample = await viewDocument(collection, ids[0])
    expect(sample.migrated).toBe(true)
  })
})
