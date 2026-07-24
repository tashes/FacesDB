import { spawn } from 'child_process'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { join, resolve } from 'path'
import os from 'os'
import { pathToFileURL } from 'url'
import { afterEach, describe, expect, test } from 'vitest'

const roots = []
const documentId = "0123456789abcdef01234567"
const moduleUrl = pathToFileURL(resolve("lib/putDocument.js")).href

function runUpdates(root, count) {
  const script = `
    process.env.FS = ${JSON.stringify(root)}
    const { updateDocument } = await import(${JSON.stringify(moduleUrl)})
    for (let index = 0; index < ${count}; index += 1) {
      await updateDocument("articles", ${JSON.stringify(documentId)}, current => ({
        ...current,
        count: current.count + 1,
      }))
    }
  `
  return new Promise((resolveChild, reject) => {
    const child = spawn(process.execPath, ["--input-type=module", "--eval", script], {
      stdio: ["ignore", "ignore", "pipe"],
    })
    let stderr = ""
    child.stderr.on("data", (chunk) => { stderr += chunk })
    child.on("error", reject)
    child.on("close", (code) => code === 0 ? resolveChild() : reject(new Error(stderr)))
  })
}

afterEach(() => {
  while (roots.length > 0) rmSync(roots.pop(), { recursive: true, force: true })
})

describe("resource concurrency", () => {
  test("updateDocument prevents cross-process lost updates", async () => {
    const root = mkdtempSync(join(os.tmpdir(), "facesdb-document-lock-"))
    roots.push(root)
    mkdirSync(join(root, "articles", "bucket"), { recursive: true })
    writeFileSync(join(root, "articles", `${documentId}.json`), JSON.stringify({
      _id: documentId,
      count: 0,
    }))
    await Promise.all([runUpdates(root, 10), runUpdates(root, 10)])
    expect(JSON.parse(readFileSync(
      join(root, "articles", `${documentId}.json`),
      "utf8",
    )).count).toBe(20)
  })
})
