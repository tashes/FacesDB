import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'fs'
import os from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'

import {
  appendIndexSidecars,
  buildIndexSidecars,
  findIndexEntry,
  readIndexRows,
  removeIndexSidecars,
} from '../../lib/indexSidecar.js'
import { appendjsonl } from '../../utils/fs.js'

const originalRoot = process.env.FS
let root
let collection

function id(value) {
  return value.toString(16).padStart(24, "0")
}

function writeIndex(entries) {
  writeFileSync(
    join(collection, "scores.jsonl"),
    entries.length === 0
      ? ""
      : `${entries.map((entry) => JSON.stringify(entry)).join("\n")}\n`,
  )
}

beforeEach(() => {
  root = mkdtempSync(join(os.tmpdir(), "facesdb-index-sidecar-"))
  process.env.FS = root
  collection = join(root, "people")
  mkdirSync(collection)
})

afterEach(() => {
  if (originalRoot === undefined) delete process.env.FS
  else process.env.FS = originalRoot
  rmSync(root, { recursive: true, force: true })
})

describe("indexSidecar", () => {
  test("calculates arbitrary JSONL rows from fixed-width offsets", async () => {
    const entries = Array.from({ length: 100 }, (_, index) => ({
      _id: id(index),
      score: index,
      variable: "x".repeat(index % 13),
    }))
    writeIndex(entries)
    expect(await buildIndexSidecars("scores", "people"))
      .toEqual({ rows: 100, documents: 100 })

    expect(await readIndexRows("scores", "people", 73, 5))
      .toEqual(entries.slice(73, 78))
    expect(readFileSync(join(collection, "scores.offsets")).length)
      .toBe(32 + 101 * 8)
  })

  test("finds documents with a fixed-record binary search", async () => {
    const entries = Array.from({ length: 1_000 }, (_, index) => ({
      _id: id(index),
      score: index,
    })).reverse()
    writeIndex(entries)
    await buildIndexSidecars("scores", "people")

    expect(await findIndexEntry("scores", "people", id(777)))
      .toEqual({ _id: id(777), score: 777 })
    expect(await findIndexEntry("scores", "people", id(1_001))).toBeUndefined()
  })

  test("updates offsets and the lookup delta after an append", async () => {
    writeIndex([{ _id: id(1), score: 1 }])
    await buildIndexSidecars("scores", "people")
    const appended = { _id: id(2), score: 2 }
    const location = appendjsonl(appended, "people", "scores.jsonl")

    expect(appendIndexSidecars("scores", "people", appended, location)).toBe(true)
    expect(await readIndexRows("scores", "people", 1, 1)).toEqual([appended])
    expect(await findIndexEntry("scores", "people", id(2))).toEqual(appended)
  })

  test("rebuilds stale derived files after the JSONL source changes", async () => {
    writeIndex([{ _id: id(1), score: 1 }])
    await buildIndexSidecars("scores", "people")
    writeIndex([{ _id: id(2), score: 2 }])

    expect(await findIndexEntry("scores", "people", id(1))).toBeUndefined()
    expect(await findIndexEntry("scores", "people", id(2)))
      .toEqual({ _id: id(2), score: 2 })
  })

  test("removes every derived sidecar", async () => {
    writeIndex([{ _id: id(1), score: 1 }])
    await buildIndexSidecars("scores", "people")
    removeIndexSidecars("scores", "people")

    for (const suffix of ["offsets", "lookup", "lookup.delta"]) {
      expect(existsSync(join(collection, `scores.${suffix}`))).toBe(false)
    }
  })
})
