import { createHash, randomUUID } from 'crypto'
import {
  closeSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmdirSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'fs'
import { join } from 'path'

const DEFAULT_TIMEOUT_MS = 30_000
const DEFAULT_LEASE_MS = 10_000
const DEFAULT_RETRY_MS = 10

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

export function hashLockKey(key) {
  return createHash("sha256").update(key).digest("hex")
}

function atomicWriteOwner(lockPath, owner) {
  const temporary = join(lockPath, `.owner-${owner.token}.tmp`)
  writeFileSync(temporary, JSON.stringify(owner))
  renameSync(temporary, join(lockPath, `${owner.token}.owner.json`))
}

function readOwner(lockPath) {
  try {
    const ownerFile = readdirSync(lockPath).find((name) => name.endsWith(".owner.json"))
    if (ownerFile === undefined) return null
    return JSON.parse(readFileSync(join(lockPath, ownerFile), "utf8"))
  } catch (_) {
    return null
  }
}

function removeStaleLock(lockPath, owner, now, leaseMs) {
  if (owner !== null && Number(owner.expiresAt) > now) return false
  if (owner === null) {
    try {
      if (statSync(lockPath).mtimeMs + leaseMs > now) return false
    } catch (_) {
      return true
    }
  }

  const stalePath = `${lockPath}.stale-${process.pid}-${randomUUID()}`
  try {
    renameSync(lockPath, stalePath)
  } catch (err) {
    if (err.code === "ENOENT") return true
    return false
  }

  rmSync(stalePath, { recursive: true, force: true })
  return true
}

function timeoutError(keyHash, timeoutMs, namespace) {
  const err = new Error(`Timed out acquiring KV lock ${keyHash} after ${timeoutMs}ms`)
  err.code = "KV_LOCK_TIMEOUT"
  err.keyHash = keyHash
  err.timeoutMs = timeoutMs
  if (namespace !== undefined) err.namespace = namespace
  return err
}

/**
 * Creates a process-safe filesystem lock manager for KV keys.
 *
 * Lock identifiers are always SHA-256 hashes so raw keys never reach disk or
 * diagnostics. `acquire` sorts and de-duplicates keys to make multi-key use
 * deadlock-safe. The returned release callback is idempotent.
 */
export function createKVLockManager({
  rootPath,
  directoryName = ".kvstore-locks",
  leaseMs = DEFAULT_LEASE_MS,
  retryMs = DEFAULT_RETRY_MS,
  now = Date.now,
} = {}) {
  if (typeof rootPath !== "string" || rootPath.length === 0) {
    throw new Error("A lock root path is required")
  }
  if (typeof directoryName !== "string" || directoryName.length === 0) {
    throw new Error("A lock directory name is required")
  }
  if (Number.isFinite(leaseMs) === false || leaseMs <= 0) {
    throw new Error("Lock lease must be a positive number")
  }
  if (Number.isFinite(retryMs) === false || retryMs <= 0) {
    throw new Error("Lock retry interval must be a positive number")
  }

  const locksPath = join(rootPath, directoryName)

  function ensureRoot() {
    mkdirSync(locksPath, { recursive: true })
  }

  async function acquireOne(keyHash, options) {
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
    const namespace = options.namespace
    const startedAt = now()
    const lockPath = join(locksPath, `${keyHash}.lock`)
    const token = randomUUID()

    while (true) {
      try {
        mkdirSync(lockPath)
        const owner = {
          token,
          pid: process.pid,
          acquiredAt: now(),
          expiresAt: now() + leaseMs,
        }
        atomicWriteOwner(lockPath, owner)

        const heartbeat = setInterval(() => {
          const current = readOwner(lockPath)
          if (current?.token !== token) return
          owner.expiresAt = now() + leaseMs
          try {
            atomicWriteOwner(lockPath, owner)
          } catch (_) {
            // Ownership is checked again on release. A missing directory means
            // the lease was already recovered or explicitly removed.
          }
        }, Math.max(1, Math.floor(leaseMs / 3)))
        heartbeat.unref?.()

        let released = false
        return () => {
          if (released) return
          released = true
          clearInterval(heartbeat)
          try {
            unlinkSync(join(lockPath, `${token}.owner.json`))
            rmdirSync(lockPath)
          } catch (_) {
            // A recovered lease may already belong to a successor. Removing
            // only our token-named file makes release safe in that race.
          }
        }
      } catch (err) {
        if (err.code !== "EEXIST") throw err
      }

      removeStaleLock(lockPath, readOwner(lockPath), now(), leaseMs)

      if (now() - startedAt >= timeoutMs) {
        throw timeoutError(keyHash, timeoutMs, namespace)
      }
      await sleep(Math.min(retryMs, Math.max(1, timeoutMs - (now() - startedAt))))
    }
  }

  async function acquire(keys, options = {}) {
    ensureRoot()
    if (Array.isArray(keys) === false) throw new Error("Lock keys must be an array")
    if (options === null || typeof options !== "object") {
      throw new Error("Lock options must be an object")
    }
    if (
      options.timeoutMs !== undefined &&
      (Number.isFinite(options.timeoutMs) === false || options.timeoutMs < 0)
    ) {
      throw new Error("Lock timeout must be a non-negative number")
    }
    if (options.namespace !== undefined && typeof options.namespace !== "string") {
      throw new Error("Lock namespace must be a string")
    }

    const keyHashes = [...new Set(keys.map((key) => hashLockKey(`${key}`)))].sort()
    const releases = []
    try {
      for (const keyHash of keyHashes) {
        releases.push(await acquireOne(keyHash, options))
      }
    } catch (err) {
      releases.reverse().forEach((release) => release())
      throw err
    }

    let released = false
    return () => {
      if (released) return
      released = true
      releases.reverse().forEach((release) => release())
    }
  }

  return { acquire, locksPath }
}

export function syncDirectory(directoryPath) {
  let descriptor
  try {
    descriptor = openSync(directoryPath, "r")
    fsyncSync(descriptor)
  } finally {
    if (descriptor !== undefined) closeSync(descriptor)
  }
}
