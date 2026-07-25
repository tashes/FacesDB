import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import os from 'os'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'

import { createIndex } from '../../lib/createIndex.js'
import { findIndexEntry } from '../../lib/indexSidecar.js'
import { putDocument, updateDocument } from '../../lib/putDocument.js'

const originalRoot = process.env.FS
const document = "0123456789abcdef01234567"
let root
let collection

beforeEach(async () => {
  root = mkdtempSync(join(os.tmpdir(), "facesdb-put-document-"))
  process.env.FS = root
  collection = join(root, "people")
  mkdirSync(join(collection, "bucket"), { recursive: true })
  writeFileSync(join(collection, `${document}.json`), JSON.stringify({
    _id: document,
    name: "old",
    score: 1,
  }))
  await createIndex("scores", { score: true }, "people")
})

afterEach(() => {
  if (originalRoot === undefined) delete process.env.FS
  else process.env.FS = originalRoot
  rmSync(root, { recursive: true, force: true })
})

describe("putDocument", () => {
  test("appends an index revision without rewriting the base", async () => {
    const before = readFileSync(join(collection, "scores.jsonl"), "utf8")
    await putDocument("people", document, { name: "new", score: 99 })
    expect(readFileSync(join(collection, "scores.jsonl"), "utf8")).toBe(before)
    expect(await findIndexEntry("scores", "people", document))
      .toEqual({ _id: document, score: 99 })
  })

  test("appends a tombstone when the replacement no longer qualifies", async () => {
    await putDocument("people", document, { name: "unscored" })
    expect(await findIndexEntry("scores", "people", document)).toBeUndefined()
  })

  test("updateDocument reads and changes the locked latest document", async () => {
    await updateDocument("people", document, (current) => ({
      ...current,
      score: current.score + 1,
    }))
    expect(JSON.parse(readFileSync(join(collection, `${document}.json`))).score).toBe(2)
  })

  test("rejects missing documents and asynchronous update callbacks", async () => {
    await expect(putDocument("people", "ffffffffffffffffffffffff", { score: 1 }))
      .rejects.toThrow("Document does not exist")
    await expect(updateDocument("people", document, async (current) => current))
      .rejects.toThrow("must be synchronous")
  })
})
