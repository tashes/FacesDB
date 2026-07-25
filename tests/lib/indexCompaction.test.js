import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'fs'
import { join } from 'path'
import os from 'os'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'

import { createIndex } from '../../lib/createIndex.js'
import { compactIndex } from '../../lib/indexCompaction.js'
import { findIndexEntry } from '../../lib/indexSidecar.js'
import { hasIndexUpdates } from '../../lib/indexUpdates.js'
import { putDocument } from '../../lib/putDocument.js'
import { searchIndex } from '../../lib/searchIndex.js'
import { viewIndex } from '../../lib/viewIndex.js'

const originalRoot = process.env.FS
const originalMaintenance = process.env.FACESDB_MAINTENANCE
const id = (index) => index.toString(16).padStart(24, "0")
let root
let collection

beforeEach(() => {
  root = mkdtempSync(join(os.tmpdir(), "facesdb-index-compact-"))
  process.env.FS = root
  process.env.FACESDB_MAINTENANCE = "off"
  collection = join(root, "people")
  mkdirSync(join(collection, "bucket"), { recursive: true })
  writeFileSync(join(collection, `${id(1)}.json`), JSON.stringify({
    _id: id(1),
    score: 1,
  }))
})

afterEach(async () => {
  const { stopMaintenance } = await import('../../lib/maintenance.js')
  await stopMaintenance()
  if (originalRoot === undefined) delete process.env.FS
  else process.env.FS = originalRoot
  if (originalMaintenance === undefined) delete process.env.FACESDB_MAINTENANCE
  else process.env.FACESDB_MAINTENANCE = originalMaintenance
  rmSync(root, { recursive: true, force: true })
})

describe("index compaction", () => {
  test("overlays updates for lookup, paging, and search before compaction", async () => {
    await createIndex("scores", { score: true }, "people")
    const base = readFileSync(join(collection, "scores.jsonl"), "utf8")
    await putDocument("people", id(1), { score: 99 })

    expect(readFileSync(join(collection, "scores.jsonl"), "utf8")).toBe(base)
    expect(await findIndexEntry("scores", "people", id(1)))
      .toEqual({ _id: id(1), score: 99 })
    expect(await viewIndex("scores", "people", 0))
      .toEqual([{ _id: id(1), score: 99 }])
    expect(await searchIndex("scores", "people", (entry) => entry.score === 99, 0))
      .toEqual([{ _id: id(1), score: 99 }])
  })

  test("publishes a compact base and removes rotated journals", async () => {
    await createIndex("scores", { score: true }, "people")
    await putDocument("people", id(1), { score: 99 })
    expect(await compactIndex("scores", "people")).toBe(true)

    expect(hasIndexUpdates("scores", "people")).toBe(false)
    expect(readFileSync(join(collection, "scores.jsonl"), "utf8"))
      .toContain('"score":99')
    expect(await findIndexEntry("scores", "people", id(1)))
      .toEqual({ _id: id(1), score: 99 })
  })

  test("preserves writes that arrive after journal rotation", async () => {
    for (let index = 2; index < 5_000; index += 1) {
      writeFileSync(join(collection, `${id(index)}.json`), JSON.stringify({
        _id: id(index),
        score: index,
      }))
    }
    await createIndex("scores", { score: true }, "people")
    await putDocument("people", id(1), { score: 2 })
    const compacting = compactIndex("scores", "people")
    while (existsSync(join(collection, ".scores.updates.rotated.jsonl")) === false) {
      await new Promise((resolve) => setTimeout(resolve, 1))
    }
    await putDocument("people", id(1), { score: 3 })
    await compacting
    expect(await findIndexEntry("scores", "people", id(1)))
      .toEqual({ _id: id(1), score: 3 })
  }, 10_000)

  test("starts an internal worker and compacts after configured thresholds", async () => {
    await createIndex("scores", { score: true }, "people")
    process.env.FACESDB_MAINTENANCE = "on"
    const maintenance = await import('../../lib/maintenance.js')
    maintenance.configureMaintenance({
      intervalMs: 50,
      minimumUpdateRecords: 1,
      staleRatio: 0,
    })
    await putDocument("people", id(1), { score: 77 })
    maintenance.ensureMaintenanceWorker()

    const deadline = Date.now() + 5_000
    while (hasIndexUpdates("scores", "people") && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 25))
    }
    expect(hasIndexUpdates("scores", "people")).toBe(false)
    expect(await findIndexEntry("scores", "people", id(1)))
      .toEqual({ _id: id(1), score: 77 })
  }, 10_000)
})
