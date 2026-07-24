import { createHash, randomUUID } from 'crypto'
import {
  linkSync,
  mkdirSync,
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
const MODES = new Set(["shared", "exclusive"])
const listeners = new Set()

const sleep = (duration) => new Promise((resolve) => setTimeout(resolve, duration))
const hashResource = (resource) => createHash("sha256").update(resource).digest("hex")

export function validateLockOptions(options = {}) {
  if (options === null || typeof options !== "object" || Array.isArray(options)) {
    throw new Error("Lock options must be an object")
  }
  const priority = options.priority ?? "normal"
  if (PRIORITIES.has(priority) === false) {
    throw new Error("Priority must be foreground, normal, or background")
  }
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  if (Number.isFinite(timeoutMs) === false || timeoutMs < 0) {
    throw new Error("timeoutMs must be a non-negative finite number")
  }
  if (options.namespace !== undefined && typeof options.namespace !== "string") {
    throw new Error("namespace must be a string")
  }
  return { priority, timeoutMs, namespace: options.namespace }
}

function emit(event) {
  const frozen = Object.freeze({ ...event })
  for (const listener of listeners) {
    try {
      listener(frozen)
    } catch (_) {}
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

function stale(metadata, now) {
  if (metadata === null || processExists(metadata.pid) === false) return true
  return metadata.state === "held" && metadata.leaseUntil <= now
}

function cleanStaleTickets(queuePath, ownTicket) {
  for (const name of readdirSync(queuePath).filter((entry) => entry.endsWith(".json"))) {
    const file = join(queuePath, name)
    if (file !== ownTicket && stale(readMetadata(file), Date.now())) {
      rmSync(file, { force: true })
    }
  }
}

async function allocateSequence(lockPath, counterPath, deadline, callback) {
  while (true) {
    const claim = `${lockPath}.${process.pid}.${randomUUID()}`
    writeFileSync(claim, JSON.stringify({ pid: process.pid }))
    try {
      linkSync(claim, lockPath)
      rmSync(claim, { force: true })
      break
    } catch (err) {
      rmSync(claim, { force: true })
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
    return callback(sequence)
  } finally {
    rmSync(lockPath, { force: true })
  }
}

function diagnostic(type, request, extra = {}) {
  const now = Date.now()
  return {
    type,
    resourceHash: request.resourceHash,
    keyHash: request.resourceHash,
    requestId: request.requestId,
    mode: request.mode,
    priority: request.options.priority,
    namespace: request.options.namespace,
    operation: request.operation,
    resourceCount: request.resourceCount,
    keyCount: request.resourceCount,
    queueDepth: request.queueDepth,
    timestamp: now,
    waitMs: (request.acquiredAt ?? now) - request.startedAt,
    ...extra,
  }
}

function canAcquire(queuePath, ticketName, mode) {
  const names = readdirSync(queuePath)
    .filter((name) => name.endsWith(".json"))
    .sort()
  const position = names.indexOf(ticketName)
  if (position === -1) return false
  if (mode === "exclusive") return position === 0
  for (let index = 0; index < position; index += 1) {
    const metadata = readMetadata(join(queuePath, names[index]))
    if (metadata?.mode === "exclusive") return false
  }
  return true
}

function timeoutError(request) {
  const waitMs = Date.now() - request.startedAt
  const error = new Error(
    `Resource lock timed out after ${waitMs}ms/${request.options.timeoutMs}ms ` +
    `(${request.resourceHash})`,
  )
  Object.assign(error, {
    code: "RESOURCE_LOCK_TIMEOUT",
    resourceHash: request.resourceHash,
    keyHash: request.resourceHash,
    priority: request.options.priority,
    namespace: request.options.namespace,
    timeoutMs: request.options.timeoutMs,
    waitMs,
    queueDepth: request.queueDepth,
  })
  return error
}

async function acquireResource(resource, mode, options, deadline, requestId, context) {
  const resourceHash = hashResource(resource)
  const startedAt = Date.now()
  const lockRoot = join(context.root, ".locks", resourceHash)
  const queuePath = join(lockRoot, "queue")
  mkdirSync(queuePath, { recursive: true })
  const request = {
    resourceHash,
    requestId,
    mode,
    options,
    operation: context.operation,
    resourceCount: context.resourceCount,
    queueDepth: readdirSync(queuePath).filter((name) => name.endsWith(".json")).length + 1,
    startedAt,
  }
  emit(diagnostic("queued", request))

  const metadata = {
    pid: process.pid,
    ownerToken: randomUUID(),
    mode,
    state: "waiting",
    leaseUntil: null,
  }
  let ticketName
  let ticketPath
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
    emit(diagnostic("timeout", request))
    throw timeoutError(request)
  }

  while (true) {
    cleanStaleTickets(queuePath, ticketPath)
    if (canAcquire(queuePath, ticketName, mode)) {
      request.acquiredAt = Date.now()
      metadata.state = "held"
      metadata.leaseUntil = Date.now() + LEASE_MS
      writeMetadata(ticketPath, metadata)
      const heartbeat = setInterval(() => {
        metadata.leaseUntil = Date.now() + LEASE_MS
        try {
          writeMetadata(ticketPath, metadata)
        } catch (_) {}
      }, LEASE_MS / 2)
      heartbeat.unref()
      emit(diagnostic("acquired", request))
      return {
        release() {
          clearInterval(heartbeat)
          const current = readMetadata(ticketPath)
          if (current?.ownerToken === metadata.ownerToken) rmSync(ticketPath, { force: true })
          emit(diagnostic("released", request, {
            holdMs: Date.now() - request.acquiredAt,
          }))
        },
      }
    }
    if (Date.now() >= deadline) {
      rmSync(ticketPath, { force: true })
      emit(diagnostic("timeout", request))
      throw timeoutError(request)
    }
    await sleep(Math.min(POLL_MS, Math.max(0, deadline - Date.now())))
  }
}

export function observeResourceLocks(listener) {
  if (typeof listener !== "function") throw new Error("Lock observer must be a function")
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export async function scheduleResourceAccess(resources, options, task, context = {}) {
  const normalizedOptions = validateLockOptions(options)
  if (Array.isArray(resources) === false) throw new Error("Resources must be an array")
  if (typeof task !== "function") throw new Error("Scheduled task must be a function")
  const normalized = resources.map((entry) => {
    const resource = typeof entry === "string" ? entry : entry?.resource
    const mode = typeof entry === "string" ? "exclusive" : entry?.mode ?? "exclusive"
    if (typeof resource !== "string" || resource.length === 0) {
      throw new Error("Scheduled resources must be non-empty strings")
    }
    if (MODES.has(mode) === false) throw new Error("Lock mode must be shared or exclusive")
    return { resource, mode }
  })
  const strongest = new Map()
  for (const entry of normalized) {
    if (strongest.get(entry.resource) !== "exclusive") strongest.set(entry.resource, entry.mode)
  }
  const ordered = [...strongest].map(([resource, mode]) => ({ resource, mode }))
    .sort((left, right) => hashResource(left.resource).localeCompare(hashResource(right.resource)))
  const deadline = Date.now() + normalizedOptions.timeoutMs
  const requestId = randomUUID()
  const releases = []
  const normalizedContext = {
    root: context.root ?? path(),
    operation: context.operation ?? "operation",
    resourceCount: context.resourceCount ?? ordered.length,
  }
  try {
    for (const entry of ordered) {
      releases.push(await acquireResource(
        entry.resource,
        entry.mode,
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

export const RESOURCE_LOCK_DEFAULTS = {
  timeoutMs: DEFAULT_TIMEOUT_MS,
  leaseMs: LEASE_MS,
}
