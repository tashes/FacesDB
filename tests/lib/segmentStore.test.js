import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
} from 'fs'
import os from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'

import {
  deleteSegmentDocuments,
  importDocuments,
  refreshCollectionIndex,
  viewSegmentDocument,
} from '../../lib/segmentStore.js'
import { viewDocument } from '../../lib/viewDocument.js'

const originalRoot = process.env.FS
let root

function documentId(value) {
  return value.toString(16).padStart(24, "0")
}

beforeEach(() => {
  root = mkdtempSync(join(os.tmpdir(), "facesdb-segments-"))
  process.env.FS = root
  mkdirSync(join(root, "users", "bucket"), { recursive: true })
})

afterEach(() => {
  if (originalRoot === undefined) delete process.env.FS
  else process.env.FS = originalRoot
  rmSync(root, { recursive: true, force: true })
})

describe("segmentStore", () => {
  test("imports immutable JSONL segments and resolves documents by byte offset", async () => {
    const first = documentId(1)
    const second = documentId(2)

    const result = await importDocuments("users", [
      { _id: first, name: "Ada" },
      { _id: second, name: "Grace" },
    ], { nodeId: "node-a" })

    expect(result.count).toBe(2)
    expect(result.segment).toMatch(/node-a.*\.jsonl$/)
    expect(readdirSync(join(root, "users", "segments"))).toEqual([result.segment])
    expect(await viewSegmentDocument("users", first)).toEqual({
      _id: first,
      name: "Ada",
    })
    expect(await viewDocument("users", second)).toEqual({
      _id: second,
      name: "Grace",
    })
  })

  test("streams async iterables without returning all imported documents", async () => {
    async function* documents() {
      for (let index = 0; index < 5_000; index += 1) {
        yield { _id: documentId(index), value: index }
      }
    }

    const result = await importDocuments("users", documents())

    expect(result.count).toBe(5_000)
    expect(await viewSegmentDocument("users", documentId(4_999)))
      .toEqual({ _id: documentId(4_999), value: 4_999 })
  })

  test("uses deterministic newest-segment wins updates and tombstones", async () => {
    const id = documentId(7)
    await importDocuments("users", [{ _id: id, value: "old" }], { nodeId: "a" })
    await new Promise((resolve) => setTimeout(resolve, 2))
    await importDocuments("users", [{ _id: id, value: "new" }], { nodeId: "b" })
    expect(await viewSegmentDocument("users", id)).toEqual({ _id: id, value: "new" })

    await new Promise((resolve) => setTimeout(resolve, 2))
    await deleteSegmentDocuments("users", [id], { nodeId: "b" })
    expect(await viewSegmentDocument("users", id)).toBeUndefined()
  })

  test("rebuilds derived indexes after a clone or pull", async () => {
    const id = documentId(9)
    await importDocuments("users", [{ _id: id, active: true }])
    rmSync(join(root, "users", ".facesdb"), { recursive: true, force: true })

    expect(await refreshCollectionIndex("users")).toEqual({ segments: 1 })
    expect(existsSync(join(root, "users", ".facesdb", "manifest.json"))).toBe(true)
    expect(await viewSegmentDocument("users", id)).toEqual({ _id: id, active: true })
  })

  test("does not publish a partial segment when validation fails", async () => {
    await expect(importDocuments("users", [
      { _id: documentId(1), okay: true },
      { _id: "invalid", okay: false },
    ])).rejects.toThrow("Cannot run importDocuments")

    expect(readdirSync(join(root, "users", "segments"))).toEqual([])
  })
})
