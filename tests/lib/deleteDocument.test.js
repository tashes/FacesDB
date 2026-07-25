import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import os from 'os'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'

import { createIndex } from '../../lib/createIndex.js'
import { deleteDocument } from '../../lib/deleteDocument.js'
import { findIndexEntry } from '../../lib/indexSidecar.js'

const originalRoot = process.env.FS
const document = "0123456789abcdef01234567"
let root
let collection

beforeEach(async () => {
  root = mkdtempSync(join(os.tmpdir(), "facesdb-delete-document-"))
  process.env.FS = root
  collection = join(root, "people")
  mkdirSync(join(collection, "bucket"), { recursive: true })
  writeFileSync(join(collection, `${document}.json`), JSON.stringify({
    _id: document,
    score: 1,
  }))
  await createIndex("scores", { score: true }, "people")
})

afterEach(() => {
  if (originalRoot === undefined) delete process.env.FS
  else process.env.FS = originalRoot
  rmSync(root, { recursive: true, force: true })
})

describe("deleteDocument", () => {
  test("deletes the document and appends an index tombstone", async () => {
    await deleteDocument("people", document)
    expect(existsSync(join(collection, `${document}.json`))).toBe(false)
    expect(await findIndexEntry("scores", "people", document)).toBeUndefined()
  })

  test("rejects a missing document", async () => {
    await deleteDocument("people", document)
    await expect(deleteDocument("people", document)).rejects.toThrow("Document does not exist")
  })
})
