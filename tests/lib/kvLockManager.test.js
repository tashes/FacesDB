import { spawn } from 'child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import os from 'os'
import { join } from 'path'
import { setTimeout as delay } from 'timers/promises'
import { fileURLToPath } from 'url'

import { afterEach, beforeEach, describe, expect, test } from 'vitest'

import {
  createKVLockManager,
  hashLockKey,
} from '../../lib/kvLockManager.js'

let testRoot
const worker = fileURLToPath(new URL('../fixtures/kv-worker.js', import.meta.url))

function runWorker(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [worker, ...args], {
      stdio: ["ignore", "pipe", "pipe"],
    })
    let stdout = ""
    let stderr = ""
    child.stdout.on("data", (chunk) => {
      stdout += chunk
    })
    child.stderr.on("data", (chunk) => {
      stderr += chunk
    })
    child.on("error", reject)
    child.on("exit", (code) => {
      if (code === 0) resolve(stdout)
      else reject(new Error(`Worker exited ${code}: ${stderr}`))
    })
  })
}

beforeEach(() => {
  testRoot = mkdtempSync(join(os.tmpdir(), "facesdb-lock-"))
})

afterEach(() => {
  rmSync(testRoot, { recursive: true, force: true })
})

describe("KV lock manager", () => {
  test("hashes keys without leaking raw key material", () => {
    const hashed = hashLockKey("private:user:42")
    expect(hashed).toMatch(/^[a-f0-9]{64}$/)
    expect(hashed).not.toContain("private")
  })

  test("serializes a key while allowing an unrelated key", async () => {
    const locks = createKVLockManager({ rootPath: testRoot, retryMs: 2 })
    const releaseFirst = await locks.acquire(["one"])

    let sameAcquired = false
    const same = locks.acquire(["one"], { timeoutMs: 500 }).then((release) => {
      sameAcquired = true
      return release
    })
    const releaseOther = await locks.acquire(["two"], { timeoutMs: 50 })

    await delay(25)
    expect(sameAcquired).toBe(false)
    releaseOther()
    releaseFirst()
    const releaseSame = await same
    releaseSame()
  })

  test("keeps live leases fresh and reports bounded timeouts safely", async () => {
    const owner = createKVLockManager({ rootPath: testRoot, leaseMs: 30, retryMs: 2 })
    const waiter = createKVLockManager({ rootPath: testRoot, leaseMs: 30, retryMs: 2 })
    const release = await owner.acquire(["secret-key"])
    await delay(60)

    let error
    try {
      await waiter.acquire(["secret-key"], {
        timeoutMs: 20,
        namespace: "cache",
      })
    } catch (err) {
      error = err
    }

    expect(error.code).toBe("KV_LOCK_TIMEOUT")
    expect(error.keyHash).toBe(hashLockKey("secret-key"))
    expect(error.namespace).toBe("cache")
    expect(error.message).not.toContain("secret-key")
    release()
  })

  test("recovers an expired owner", async () => {
    const locksPath = join(testRoot, ".kvstore-locks")
    const lockPath = join(locksPath, `${hashLockKey("stale")}.lock`)
    mkdirSync(lockPath, { recursive: true })
    writeFileSync(join(lockPath, "abandoned.owner.json"), JSON.stringify({
      token: "abandoned",
      expiresAt: Date.now() - 1,
    }))

    const locks = createKVLockManager({ rootPath: testRoot, retryMs: 2 })
    const release = await locks.acquire(["stale"], { timeoutMs: 100 })
    release()
  })

  test("sorts multi-key acquisition to prevent deadlocks", async () => {
    const first = createKVLockManager({ rootPath: testRoot, retryMs: 2 })
    const second = createKVLockManager({ rootPath: testRoot, retryMs: 2 })

    const useLocks = async (manager, keys) => {
      const release = await manager.acquire(keys, { timeoutMs: 500 })
      await delay(15)
      release()
    }

    await Promise.all([
      useLocks(first, ["a", "b"]),
      useLocks(second, ["b", "a"]),
    ])
  })

  test("coordinates lock ownership across Node processes", async () => {
    const locks = createKVLockManager({ rootPath: testRoot, retryMs: 2 })
    const release = await locks.acquire(["shared"])
    const started = Date.now()
    const child = runWorker(["lock", testRoot, "shared", "0"])

    await delay(75)
    release()
    await child
    expect(Date.now() - started).toBeGreaterThanOrEqual(50)
  })
})
