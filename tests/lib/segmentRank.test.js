import { mkdirSync, mkdtempSync, rmSync } from 'fs'
import os from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'

import { createRankedIndex, viewRankedIndex } from '../../lib/segmentRank.js'
import {
  deleteSegmentDocuments,
  importDocuments,
} from '../../lib/segmentStore.js'

const originalRoot = process.env.FS
let root

function id(value) {
  return value.toString(16).padStart(24, "0")
}

beforeEach(() => {
  root = mkdtempSync(join(os.tmpdir(), "facesdb-segment-rank-"))
  process.env.FS = root
  mkdirSync(join(root, "users", "bucket"), { recursive: true })
})

afterEach(() => {
  if (originalRoot === undefined) delete process.env.FS
  else process.env.FS = originalRoot
  rmSync(root, { recursive: true, force: true })
})

describe("segmentRank", () => {
  test("creates deterministic field rankings with exclusions", async () => {
    await importDocuments("users", [
      { _id: id(1), score: 10 },
      { _id: id(2), score: 30 },
      { _id: id(3), score: 20, disqualified: true },
    ])
    await createRankedIndex("scores", "users", {
      field: "score",
      order: "descending",
      exclude: { field: "disqualified", equals: true },
    })

    expect(await viewRankedIndex("scores", "users", { limit: 10 })).toEqual([
      { _id: id(2), score: 30 },
      { _id: id(1), score: 10 },
    ])
  })

  test("adds new sorted runs and ignores superseded revisions", async () => {
    await importDocuments("users", [
      { _id: id(1), score: 10 },
      { _id: id(2), score: 20 },
    ])
    await createRankedIndex("scores", "users", { field: "score" })
    await importDocuments("users", [{ _id: id(1), score: 50 }])

    expect(await viewRankedIndex("scores", "users")).toEqual([
      { _id: id(1), score: 50 },
      { _id: id(2), score: 20 },
    ])
  })

  test("removes tombstoned documents from ranked results", async () => {
    await importDocuments("users", [
      { _id: id(1), score: 10 },
      { _id: id(2), score: 20 },
    ])
    await createRankedIndex("scores", "users", { field: "score" })
    await deleteSegmentDocuments("users", [id(2)])

    expect(await viewRankedIndex("scores", "users")).toEqual([
      { _id: id(1), score: 10 },
    ])
  })

  test("validates specifications and result limits", async () => {
    await expect(createRankedIndex("scores", "users", { field: "" }))
      .rejects.toThrow("Rank field")
    await expect(viewRankedIndex("missing", "users", { limit: 1001 }))
      .rejects.toThrow("Rank limit")
  })
})
