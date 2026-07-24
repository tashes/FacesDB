import { createHash } from 'crypto'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import os from 'os'
import { join } from 'path'
import { pathToFileURL } from 'url'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const originalFsRoot = process.env.FS
let testRoot = null

async function loadScheduler() {
  return await import('../../lib/kvLockScheduler.js')
}

function delay(duration) {
  return new Promise((resolve) => setTimeout(resolve, duration))
}

beforeEach(() => {
  testRoot = mkdtempSync(join(os.tmpdir(), "facesdb-scheduler-"))
  process.env.FS = testRoot
  vi.resetModules()
})

afterEach(() => {
  process.env.FS = originalFsRoot
  if (testRoot) rmSync(testRoot, { recursive: true, force: true })
})

describe("KV lock scheduler", () => {
  test("keeps FIFO order regardless of priority metadata", async () => {
    const { scheduleKVMutation } = await loadScheduler()
    const order = []

    const first = scheduleKVMutation(["shared"], { priority: "background" }, async () => {
      order.push("background")
      await delay(80)
    })
    await delay(10)
    const second = scheduleKVMutation(["shared"], { priority: "foreground" }, () => {
      order.push("foreground")
    })
    await delay(10)
    const third = scheduleKVMutation(["shared"], { priority: "normal" }, () => {
      order.push("normal")
    })

    await Promise.all([first, second, third])
    expect(order).toEqual(["background", "foreground", "normal"])
  })

  test("allows unrelated keys to run concurrently", async () => {
    const { scheduleKVMutation } = await loadScheduler()
    let releaseAlpha
    const alphaGate = new Promise((resolve) => {
      releaseAlpha = resolve
    })
    let betaFinished = false

    const alpha = scheduleKVMutation(["alpha"], {}, async () => alphaGate)
    await delay(10)
    await scheduleKVMutation(["beta"], {}, () => {
      betaFinished = true
    })

    expect(betaFinished).toBe(true)
    releaseAlpha()
    await alpha
  })

  test("emits privacy-safe diagnostics and isolates listeners", async () => {
    const { observeKVLocks, scheduleKVMutation } = await loadScheduler()
    const events = []
    const stopFailing = observeKVLocks(() => {
      throw new Error("observer failed")
    })
    const unsubscribe = observeKVLocks((event) => events.push(event))

    await scheduleKVMutation(
      ["secret:key"],
      { priority: "foreground", namespace: "sessions" },
      () => "done",
    )
    unsubscribe()
    stopFailing()

    expect(events.map((event) => event.type)).toEqual(["queued", "acquired", "released"])
    expect(events.every((event) => event.priority === "foreground")).toBe(true)
    expect(events.every((event) => event.namespace === "sessions")).toBe(true)
    expect(events.every((event) => event.keyHash.length === 64)).toBe(true)
    expect(JSON.stringify(events)).not.toContain("secret:key")
    expect(Object.isFrozen(events[0])).toBe(true)
  })

  test("unsubscribes observers", async () => {
    const { observeKVLocks, scheduleKVMutation } = await loadScheduler()
    const events = []
    const unsubscribe = observeKVLocks((event) => events.push(event))
    unsubscribe()

    await scheduleKVMutation(["key"], {}, () => undefined)
    expect(events).toEqual([])
  })

  test("times out with safe diagnostics and removes its waiter", async () => {
    const { observeKVLocks, scheduleKVMutation } = await loadScheduler()
    const events = []
    const unsubscribe = observeKVLocks((event) => events.push(event))
    const holder = scheduleKVMutation(["private"], {}, async () => delay(100))
    await delay(10)

    let error
    try {
      await scheduleKVMutation(
        ["private"],
        { timeoutMs: 20, priority: "foreground", namespace: "cache" },
        () => undefined,
      )
    } catch (err) {
      error = err
    }
    await holder
    unsubscribe()

    expect(error.code).toBe("KV_LOCK_TIMEOUT")
    expect(error.message).not.toContain("private")
    expect(error.namespace).toBe("cache")
    expect(events.some((event) => event.type === "timeout")).toBe(true)

    const hash = createHash("sha256").update("private").digest("hex")
    const queue = join(testRoot, ".kv-locks", hash, "queue")
    expect(readFileSync(join(testRoot, ".kv-locks", hash, "sequence"), "utf8")).toBe("2")
    expect((await import('fs')).readdirSync(queue)).toEqual([])
  })

  test("acquires multiple keys deterministically without deadlock", async () => {
    const { scheduleKVMutation } = await loadScheduler()
    const completed = []

    await Promise.all([
      scheduleKVMutation(["alpha", "beta"], {}, async () => {
        await delay(30)
        completed.push("forward")
      }),
      scheduleKVMutation(["beta", "alpha"], {}, () => completed.push("reverse")),
    ])

    expect(completed).toHaveLength(2)
  })

  test("recovers an abandoned waiter owned by a dead process", async () => {
    const { scheduleKVMutation } = await loadScheduler()
    const key = "recoverable"
    const hash = createHash("sha256").update(key).digest("hex")
    const queue = join(testRoot, ".kv-locks", hash, "queue")
    const { mkdirSync } = await import('fs')
    mkdirSync(queue, { recursive: true })
    writeFileSync(join(testRoot, ".kv-locks", hash, "sequence"), "1")
    writeFileSync(join(queue, "0000000000000000-abandoned.json"), JSON.stringify({
      pid: 999_999_999,
      ownerToken: "abandoned",
      state: "waiting",
      leaseUntil: null,
    }))

    expect(await scheduleKVMutation([key], {}, () => "recovered")).toBe("recovered")
  })

  test("validates options before creating lock state", async () => {
    const { scheduleKVMutation } = await loadScheduler()

    await expect(scheduleKVMutation(["key"], { priority: "urgent" }, () => undefined))
      .rejects.toThrow("Priority")
    await expect(scheduleKVMutation(["key"], { timeoutMs: -1 }, () => undefined))
      .rejects.toThrow("timeoutMs")
    await expect(scheduleKVMutation(["key"], { namespace: 42 }, () => undefined))
      .rejects.toThrow("namespace")
  })

  test("serializes lock ownership across Node.js processes", async () => {
    const { scheduleKVMutation } = await loadScheduler()
    const output = join(testRoot, "order.txt")
    const moduleUrl = pathToFileURL(
      join(process.cwd(), "lib", "kvLockScheduler.js"),
    ).href
    const childScript = `
      import { appendFileSync } from "fs"
      import { scheduleKVMutation } from ${JSON.stringify(moduleUrl)}
      await scheduleKVMutation(["shared"], { priority: process.argv[3] }, async () => {
        appendFileSync(process.argv[1], process.argv[2] + "\\n")
        await new Promise((resolve) => setTimeout(resolve, 30))
      })
    `
    const { spawn } = await import('child_process')
    const children = []

    const holder = scheduleKVMutation(["shared"], {}, async () => delay(250))
    await delay(20)
    for (const [label, priority] of [
      ["one", "background"],
      ["two", "foreground"],
      ["three", "normal"],
    ]) {
      children.push(spawn(process.execPath, [
        "--input-type=module",
        "--eval",
        childScript,
        output,
        label,
        priority,
      ], { env: { ...process.env, FS: testRoot } }))
      await delay(50)
    }

    await holder
    await Promise.all(children.map((child) => new Promise((resolve, reject) => {
      child.on("error", reject)
      child.on("exit", (code) => code === 0 ? resolve() : reject(new Error(`exit ${code}`)))
    })))

    expect(readFileSync(output, "utf8").trim().split("\n"))
      .toEqual(["one", "two", "three"])
  })
})
