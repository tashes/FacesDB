import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  renameSync,
  rmSync,
  statSync,
  truncateSync,
  writeFileSync,
  writeSync,
} from 'fs'
import { createHash, randomUUID } from 'crypto'
import { dirname, join } from 'path'

import { scheduleKVMutation } from './kvLockScheduler.js'

const WAL_VERSION = 1
const HEADER_SIZE = 4
const CHECKSUM_SIZE = 32
const COMPACT_BYTES = 1024 * 1024
const COMPACT_RECORDS = 1000
const COMMIT_LOCK_KEY = "facesdb:internal:wal-commit"

function syncDirectory(filePath) {
  const descriptor = openSync(dirname(filePath), "r")
  try {
    fsyncSync(descriptor)
  } finally {
    closeSync(descriptor)
  }
}

function atomicJSON(filePath, value) {
  const temporary = `${filePath}.${process.pid}.${randomUUID()}.tmp`
  const descriptor = openSync(temporary, "wx")
  try {
    writeAll(descriptor, Buffer.from(JSON.stringify(value)))
    fsyncSync(descriptor)
  } finally {
    closeSync(descriptor)
  }
  try {
    renameSync(temporary, filePath)
    syncDirectory(filePath)
  } catch (err) {
    rmSync(temporary, { force: true })
    throw err
  }
}

function writeAll(descriptor, buffer) {
  let offset = 0
  while (offset < buffer.length) {
    offset += writeSync(descriptor, buffer, offset, buffer.length - offset)
  }
}

function encodeRecord(record) {
  const payload = Buffer.from(JSON.stringify(record))
  const header = Buffer.alloc(HEADER_SIZE)
  header.writeUInt32BE(payload.length)
  const checksum = createHash("sha256").update(payload).digest()
  return Buffer.concat([header, payload, checksum])
}

function repairWalTail(filePath, size) {
  truncateSync(filePath, size)
  const descriptor = openSync(filePath, "r+")
  try {
    fsyncSync(descriptor)
  } finally {
    closeSync(descriptor)
  }
}

function decodeWal(contents, baseOffset = 0) {
  const records = []
  let offset = 0

  while (offset < contents.length) {
    const frameStart = offset
    if (contents.length - offset < HEADER_SIZE) {
      break
    }
    const length = contents.readUInt32BE(offset)
    offset += HEADER_SIZE
    const frameEnd = offset + length + CHECKSUM_SIZE
    if (frameEnd > contents.length) {
      offset = frameStart
      break
    }

    const payload = contents.subarray(offset, offset + length)
    const expected = contents.subarray(offset + length, frameEnd)
    const actual = createHash("sha256").update(payload).digest()
    if (actual.equals(expected) === false) {
      throw new Error(`Corrupt WAL checksum at byte ${baseOffset + frameStart}`)
    }

    let record
    try {
      record = JSON.parse(payload.toString())
    } catch (err) {
      throw new Error(
        `Corrupt WAL record at byte ${baseOffset + frameStart}: ${err.message}`,
      )
    }
    if (
      record.version !== WAL_VERSION ||
      Number.isSafeInteger(record.sequence) === false ||
      Array.isArray(record.operations) === false
    ) {
      throw new Error(`Invalid WAL record at byte ${baseOffset + frameStart}`)
    }
    records.push(record)
    offset = frameEnd
  }

  return { records, bytesRead: offset, complete: offset === contents.length }
}

export function readWal(filePath, { repairTail = false } = {}) {
  if (existsSync(filePath) === false) return []
  const contents = readFileSync(filePath)
  const decoded = decodeWal(contents)
  if (repairTail && decoded.complete === false) {
    repairWalTail(filePath, decoded.bytesRead)
  }
  return decoded.records
}

function readWalFrom(filePath, offset, { repairTail = false } = {}) {
  const size = statSync(filePath).size
  if (size <= offset) return { records: [], offset: size }
  const contents = Buffer.allocUnsafe(size - offset)
  const descriptor = openSync(filePath, "r")
  try {
    let bytesRead = 0
    while (bytesRead < contents.length) {
      const count = readSync(
        descriptor,
        contents,
        bytesRead,
        contents.length - bytesRead,
        offset + bytesRead,
      )
      if (count === 0) break
      bytesRead += count
    }
    const decoded = decodeWal(contents.subarray(0, bytesRead), offset)
    const nextOffset = offset + decoded.bytesRead
    if (repairTail && decoded.complete === false) repairWalTail(filePath, nextOffset)
    return { records: decoded.records, offset: nextOffset }
  } finally {
    closeSync(descriptor)
  }
}

function fileIdentity(filePath) {
  if (existsSync(filePath) === false) return null
  const stats = statSync(filePath, { bigint: true })
  return `${stats.dev}:${stats.ino}`
}

function applyOperations(store, operations) {
  for (const operation of operations) {
    if (operation.type === "set" && typeof operation.key === "string") {
      store.set(operation.key, operation.value)
    } else if (operation.type === "delete" && typeof operation.key === "string") {
      store.delete(operation.key)
    } else {
      throw new Error("Invalid WAL operation")
    }
  }
}

export class KVWalPersistence {
  constructor(root, options = {}) {
    this.root = root
    this.legacyPath = join(root, ".kvstore")
    this.legacyBackupPath = join(root, ".kvstore.legacy")
    this.snapshotPath = join(root, ".kvstore.snapshot")
    this.walPath = join(root, ".kvstore.wal")
    this.rotatingWalPath = join(root, ".kvstore.wal.rotating")
    this.compactBytes = options.compactBytes ?? COMPACT_BYTES
    this.compactRecords = options.compactRecords ?? COMPACT_RECORDS
    this.localQueue = Promise.resolve()
    this.compaction = null
    this.state = null
    this.snapshotIdentity = null
    this.walIdentity = null
    this.walOffset = 0
  }

  async initialize() {
    mkdirSync(this.root, { recursive: true })
    await this.withCommitLock(async () => {
      this.migrateLegacy()
      if (
        existsSync(this.legacyPath) &&
        existsSync(this.snapshotPath) &&
        existsSync(this.legacyBackupPath) === false
      ) {
        renameSync(this.legacyPath, this.legacyBackupPath)
        syncDirectory(this.legacyBackupPath)
      }
      if (existsSync(this.snapshotPath) === false) {
        atomicJSON(this.snapshotPath, { version: WAL_VERSION, sequence: 0, data: {} })
      }
      if (existsSync(this.walPath) === false) this.createEmptyWal()
      const state = this.loadState(true)
      if (existsSync(this.rotatingWalPath)) {
        atomicJSON(this.snapshotPath, {
          version: WAL_VERSION,
          sequence: state.sequence,
          data: Object.fromEntries(state.store),
        })
        rmSync(this.rotatingWalPath)
        syncDirectory(this.snapshotPath)
      }
      this.replaceState(this.loadState(true))
    })
  }

  migrateLegacy() {
    if (
      existsSync(this.legacyPath) === false ||
      existsSync(this.snapshotPath) ||
      existsSync(this.walPath) ||
      existsSync(this.rotatingWalPath)
    ) return

    const raw = readFileSync(this.legacyPath, "utf8")
    const data = raw.trim().length === 0 ? {} : JSON.parse(raw)
    if (data === null || Array.isArray(data) || typeof data !== "object") {
      throw new Error("Legacy key-value store must contain an object")
    }
    atomicJSON(this.snapshotPath, { version: WAL_VERSION, sequence: 0, data })
    renameSync(this.legacyPath, this.legacyBackupPath)
    syncDirectory(this.legacyBackupPath)
    this.createEmptyWal()
  }

  createEmptyWal() {
    const descriptor = openSync(this.walPath, "a")
    try {
      fsyncSync(descriptor)
    } finally {
      closeSync(descriptor)
    }
    syncDirectory(this.walPath)
  }

  loadState(repairTail = false) {
    let snapshot = { version: WAL_VERSION, sequence: 0, data: {} }
    if (existsSync(this.snapshotPath)) {
      snapshot = JSON.parse(readFileSync(this.snapshotPath, "utf8"))
    }
    if (
      snapshot.version !== WAL_VERSION ||
      Number.isSafeInteger(snapshot.sequence) === false ||
      snapshot.data === null ||
      Array.isArray(snapshot.data) ||
      typeof snapshot.data !== "object"
    ) {
      throw new Error("Invalid key-value snapshot")
    }

    const store = new Map(Object.entries(snapshot.data))
    let sequence = snapshot.sequence
    let recordCount = 0
    const walPaths = [this.rotatingWalPath, this.walPath]
    for (const walPath of walPaths) {
      for (const record of readWal(walPath, { repairTail })) {
        if (record.sequence <= sequence) continue
        if (record.sequence !== sequence + 1) {
          throw new Error(
            `WAL sequence gap: expected ${sequence + 1}, received ${record.sequence}`,
          )
        }
        applyOperations(store, record.operations)
        sequence = record.sequence
        recordCount += 1
      }
    }
    return { store, sequence, recordCount }
  }

  replaceState(state) {
    this.state = state
    this.snapshotIdentity = fileIdentity(this.snapshotPath)
    this.walIdentity = fileIdentity(this.walPath)
    this.walOffset = existsSync(this.walPath) ? statSync(this.walPath).size : 0
    return state
  }

  releaseCache() {
    this.state?.store.clear()
    this.state = null
    this.snapshotIdentity = null
    this.walIdentity = null
    this.walOffset = 0
  }

  refreshState(repairTail = false) {
    if (
      this.state === null ||
      existsSync(this.rotatingWalPath) ||
      fileIdentity(this.snapshotPath) !== this.snapshotIdentity ||
      fileIdentity(this.walPath) !== this.walIdentity ||
      statSync(this.walPath).size < this.walOffset
    ) {
      return this.replaceState(this.loadState(repairTail))
    }

    const tail = readWalFrom(this.walPath, this.walOffset, { repairTail })
    for (const record of tail.records) {
      if (record.sequence <= this.state.sequence) continue
      if (record.sequence !== this.state.sequence + 1) {
        throw new Error(
          `WAL sequence gap: expected ${this.state.sequence + 1}, ` +
          `received ${record.sequence}`,
        )
      }
      applyOperations(this.state.store, record.operations)
      this.state.sequence = record.sequence
      this.state.recordCount += 1
    }
    this.walOffset = tail.offset
    return this.state
  }

  async read(options) {
    return await this.withCommitLock(async () => this.refreshState(true), options)
  }

  async commit(change, options) {
    return await this.enqueue(async () => {
      const committed = await this.withCommitLock(async () => {
        const current = this.refreshState(true)
        const prepared = typeof change === "function" ? change(current) : { operations: change }
        const operations = prepared.operations
        if (operations.length === 0 && prepared.forceCommit !== true) {
          return { state: current, result: prepared.result }
        }
        const record = {
          version: WAL_VERSION,
          sequence: current.sequence + 1,
          operations,
        }
        const frame = encodeRecord(record)
        const descriptor = openSync(this.walPath, "a")
        try {
          writeAll(descriptor, frame)
          fsyncSync(descriptor)
        } finally {
          closeSync(descriptor)
        }
        applyOperations(current.store, operations)
        current.sequence = record.sequence
        current.recordCount += 1
        this.walOffset += frame.length
        return { state: current, result: prepared.result }
      }, options)
      this.scheduleCompaction(committed.state)
      return committed
    })
  }

  scheduleCompaction(state) {
    const bytes = existsSync(this.walPath) ? statSync(this.walPath).size : 0
    if (bytes < this.compactBytes && state.recordCount < this.compactRecords) return
    if (this.compaction !== null) return
    this.compaction = this.enqueue(async () => {
      try {
        await this.compact()
      } finally {
        this.compaction = null
      }
    })
    this.compaction.catch(() => {})
  }

  async compact() {
    const captured = await this.withCommitLock(async () => {
      if (existsSync(this.rotatingWalPath)) return null
      const state = this.refreshState(true)
      renameSync(this.walPath, this.rotatingWalPath)
      this.createEmptyWal()
      this.walIdentity = fileIdentity(this.walPath)
      this.walOffset = 0
      state.recordCount = 0
      return {
        version: WAL_VERSION,
        sequence: state.sequence,
        data: Object.fromEntries(state.store),
      }
    }, { priority: "background", namespace: "facesdb:compaction" })
    if (captured === null) return

    atomicJSON(this.snapshotPath, captured)

    await this.withCommitLock(async () => {
      const tail = readWalFrom(this.walPath, this.walOffset, { repairTail: true })
      for (const record of tail.records) {
        if (record.sequence <= this.state.sequence) continue
        if (record.sequence !== this.state.sequence + 1) {
          throw new Error(
            `WAL sequence gap: expected ${this.state.sequence + 1}, ` +
            `received ${record.sequence}`,
          )
        }
        applyOperations(this.state.store, record.operations)
        this.state.sequence = record.sequence
        this.state.recordCount += 1
      }
      this.walOffset = tail.offset
      if (existsSync(this.rotatingWalPath)) {
        rmSync(this.rotatingWalPath)
        syncDirectory(this.snapshotPath)
      }
      this.snapshotIdentity = fileIdentity(this.snapshotPath)
      this.walIdentity = fileIdentity(this.walPath)
    }, { priority: "background", namespace: "facesdb:compaction" })
  }

  enqueue(task) {
    const run = this.localQueue.then(task, task)
    this.localQueue = run.catch(() => {})
    return run
  }

  async withCommitLock(task, options) {
    return await scheduleKVMutation([COMMIT_LOCK_KEY], options, task, {
      root: this.root,
      operation: "walCommit",
    })
  }
}

export const KV_WAL_LIMITS = {
  bytes: COMPACT_BYTES,
  records: COMPACT_RECORDS,
}
