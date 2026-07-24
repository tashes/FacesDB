import { createHash, randomUUID } from 'crypto'
import {
  mkdirSync,
  linkSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'fs'
import { join } from 'path'

import { path } from '../utils/fs.js'

const DEFAULT_TIMEOUT_MS = 30_000
const LEASE_MS = 5_000
const POLL_MS = 10
const PRIORITIES = new Set(["foreground", "normal", "background"])
const listeners = new Set()

function sleep(duration) {
  return new Promise((resolve) => setTimeout(resolve, duration))
}

function hashKey(key) {
  return createHash("sha256").update(key).digest("hex")
}

export function validateKVMutationOptions(options = {}) {
  if (options === null || typeof options !== "object" || Array.isArray(options)) {
    throw new Error("Mutation options must be an object")
  }

  const priority = options.priority ?? "normal"
  if (PRIORITIES.has(priority) === false) {
    throw new Error("Priority must be foreground, normal, or background")
  }

  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  if (Number.isFinite(timeoutMs) === false || timeoutMs < 0) {
    throw new Error("timeoutMs must be a non-negative finite number")
  }

  const namespace = options.namespace
  if (namespace !== undefined && typeof namespace !== "string") {
    throw new Error("namespace must be a string")
  }

  return { priority, timeoutMs, namespace }
}

function emit(event) {
  const frozen = Object.freeze({ ...event })
  for (const listener of listeners) {
    try {
      listener(frozen)
    } catch (_) {
      // Diagnostic listeners must never affect database operations.
    }
  }
}

function processExists(pid) {
  if (pid === process.pid) return true
  try {
    process.kill(pid, 0)
    return true
  } catch (err) {
    return err.code === "EPERM"
  }
}

function readMetadata(file) {
  try {
    return JSON.parse(readFileSync(file, "utf8"))
  } catch (_) {
    return null
  }
}

function writeMetadata(file, metadata) {
  const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`
  writeFileSync(temporary, JSON.stringify(metadata))
  renameSync(temporary, file)
}

function isStale(file, now) {
  const metadata = readMetadata(file)
  if (metadata === null) return true
  if (processExists(metadata.pid) === false) return true
  return metadata.state === "held" && metadata.leaseUntil <= now
}

function cleanStaleTickets(queuePath, ownTicket) {
  for (const ticket of readdirSync(queuePath).filter((name) => name.endsWith(".json"))) {
    const file = join(queuePath, ticket)
    if (file !== ownTicket && isStale(file, Date.now())) {
      rmSync(file, { force: true })
    }
  }
}

async function allocateSequence(lockPath, counterPath, deadline, onAllocated) {
  while (true) {
    const claimPath = `${lockPath}.${process.pid}.${randomUUID()}`
    writeFileSync(claimPath, JSON.stringify({ pid: process.pid }))
    try {
      linkSync(claimPath, lockPath)
      rmSync(claimPath, { force: true })
      break
    } catch (err) {
      rmSync(claimPath, { force: true })
      if (err.code !== "EEXIST") throw err
      const owner = readMetadata(lockPath)
      if (owner !== null && processExists(owner.pid) === false) {
        rmSync(lockPath, { force: true })
        continue
      }
      if (Date.now() >= deadline) throw new Error("timeout")
      await sleep(POLL_MS)
    }
  }

  try {
    let sequence = 0
    try {
      sequence = Number.parseInt(readFileSync(counterPath, "utf8"), 10) || 0
    } catch (err) {
      if (err.code !== "ENOENT") throw err
    }
    writeMetadata(counterPath, sequence + 1)
    return onAllocated(sequence)
  } finally {
    rmSync(lockPath, { force: true })
  }
}

function diagnostic(type, request, startedAt, extra = {}) {
  const now = Date.now()
  return {
    type,
    keyHash: request.keyHash,
    requestId: request.requestId,
    priority: request.options.priority,
    namespace: request.options.namespace,
    operation: request.operation,
    keyCount: request.keyCount,
    queueDepth: request.queueDepth,
    timestamp: now,
    waitMs: request.acquiredAt === undefined
      ? now - startedAt
      : request.acquiredAt - startedAt,
    ...extra,
  }
}

async function acquireKey(key, options, deadline, requestId, context) {
  const keyHash = hashKey(key)
  const startedAt = Date.now()
  const lockRoot = join(context.root, ".kv-locks", keyHash)
  const queuePath = join(lockRoot, "queue")
  mkdirSync(queuePath, { recursive: true })

  const request = {
    keyHash,
    requestId,
    options,
    operation: context.operation,
    keyCount: context.keyCount,
    queueDepth: readdirSync(queuePath).filter((name) => name.endsWith(".json")).length + 1,
    startedAt,
  }
  emit(diagnostic("queued", request, startedAt))

  let ticketName
  let ticketPath
  const metadata = {
    pid: process.pid,
    ownerToken: randomUUID(),
    state: "waiting",
    leaseUntil: null,
  }
  try {
    const ticket = await allocateSequence(
      join(lockRoot, "sequence.lock"),
      join(lockRoot, "sequence"),
      deadline,
      (sequence) => {
        const name = `${`${sequence}`.padStart(16, "0")}-${requestId}.json`
        const file = join(queuePath, name)
        writeFileSync(file, JSON.stringify(metadata), { flag: "wx" })
        return { name, file }
      },
    )
    ticketName = ticket.name
    ticketPath = ticket.file
  } catch (err) {
    if (err.message !== "timeout") throw err
    emit(diagnostic("timeout", request, startedAt))
    throw timeoutError(request)
  }

  while (true) {
    cleanStaleTickets(queuePath, ticketPath)
    const first = readdirSync(queuePath)
      .filter((name) => name.endsWith(".json"))
      .sort()[0]

    if (first === ticketName) {
      request.acquiredAt = Date.now()
      metadata.state = "held"
      metadata.leaseUntil = Date.now() + LEASE_MS
      writeMetadata(ticketPath, metadata)
      const heartbeat = setInterval(() => {
        metadata.leaseUntil = Date.now() + LEASE_MS
        try {
          writeMetadata(ticketPath, metadata)
        } catch (_) {
          // A failed renewal will allow another process to recover the lease.
        }
      }, LEASE_MS / 2)
      heartbeat.unref()
      emit(diagnostic("acquired", request, startedAt))
      return {
        release() {
          clearInterval(heartbeat)
          rmSync(ticketPath, { force: true })
          emit(diagnostic("released", request, startedAt, {
            holdMs: Date.now() - request.acquiredAt,
          }))
        },
      }
    }

    if (Date.now() >= deadline) {
      rmSync(ticketPath, { force: true })
      emit(diagnostic("timeout", request, startedAt))
      throw timeoutError(request)
    }
    await sleep(Math.min(POLL_MS, Math.max(0, deadline - Date.now())))
  }
}

function timeoutError(request) {
  const namespace = request.options.namespace === undefined
    ? ""
    : ` in namespace ${request.options.namespace}`
  const waitMs = Date.now() - request.startedAt
  const error = new Error(
    `KV lock request timed out after ${waitMs}ms/${request.options.timeoutMs}ms` +
    `${namespace} (${request.keyHash})`,
  )
  error.code = "KV_LOCK_TIMEOUT"
  error.keyHash = request.keyHash
  error.priority = request.options.priority
  error.namespace = request.options.namespace
  error.timeoutMs = request.options.timeoutMs
  error.waitMs = waitMs
  error.queueDepth = request.queueDepth
  return error
}

export function observeKVLocks(listener) {
  if (typeof listener !== "function") {
    throw new Error("KV lock observer must be a function")
  }
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export async function scheduleKVMutation(keys, options, task, context = {}) {
  const normalizedOptions = validateKVMutationOptions(options)
  if (Array.isArray(keys) === false || keys.some((key) => typeof key !== "string")) {
    throw new Error("Scheduled keys must be strings")
  }
  if (typeof task !== "function") throw new Error("Scheduled task must be a function")

  const uniqueKeys = [...new Set(keys)].sort((left, right) => {
    return hashKey(left).localeCompare(hashKey(right))
  })
  const deadline = Date.now() + normalizedOptions.timeoutMs
  const requestId = randomUUID()
  const releases = []
  const normalizedContext = {
    root: context.root ?? path(),
    operation: context.operation ?? "mutation",
    keyCount: context.keyCount ?? uniqueKeys.length,
  }

  try {
    for (const key of uniqueKeys) {
      releases.push(await acquireKey(
        key,
        normalizedOptions,
        deadline,
        requestId,
        normalizedContext,
      ))
    }
    return await task()
  } finally {
    for (const lock of releases.reverse()) lock.release()
  }
}
