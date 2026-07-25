import { mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import os from 'os'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'

import { scheduleResourceAccess } from '../../lib/resourceLockScheduler.js'

let root
const delay = (duration) => new Promise((resolve) => setTimeout(resolve, duration))

beforeEach(() => {
  root = mkdtempSync(join(os.tmpdir(), "facesdb-resource-lock-"))
})

afterEach(() => rmSync(root, { recursive: true, force: true }))

describe("resource lock scheduler", () => {
  test("allows concurrent readers but queues a later reader behind a writer", async () => {
    const events = []
    let releaseReaders
    const readerGate = new Promise((resolve) => { releaseReaders = resolve })
    const first = scheduleResourceAccess(
      [{ resource: "document:people:one", mode: "shared" }],
      {},
      async () => {
        events.push("reader-one")
        await readerGate
      },
      { root },
    )
    const second = scheduleResourceAccess(
      [{ resource: "document:people:one", mode: "shared" }],
      {},
      async () => {
        events.push("reader-two")
        await readerGate
      },
      { root },
    )
    await delay(20)
    const writer = scheduleResourceAccess(
      [{ resource: "document:people:one", mode: "exclusive" }],
      {},
      () => events.push("writer"),
      { root },
    )
    await delay(10)
    const third = scheduleResourceAccess(
      [{ resource: "document:people:one", mode: "shared" }],
      {},
      () => events.push("reader-three"),
      { root },
    )
    await delay(20)
    expect(events).toEqual(["reader-one", "reader-two"])
    releaseReaders()
    await Promise.all([first, second, writer, third])
    expect(events).toEqual(["reader-one", "reader-two", "writer", "reader-three"])
  })

  test("acquires mixed resource sets in deterministic order", async () => {
    const results = await Promise.all([
      scheduleResourceAccess([
        { resource: "index:people:names", mode: "exclusive" },
        { resource: "document:people:one", mode: "exclusive" },
      ], {}, () => "forward", { root }),
      scheduleResourceAccess([
        { resource: "document:people:one", mode: "exclusive" },
        { resource: "index:people:names", mode: "exclusive" },
      ], {}, () => "reverse", { root }),
    ])
    expect(results.sort()).toEqual(["forward", "reverse"])
  })
})
