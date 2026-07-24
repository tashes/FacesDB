import { createHash, randomUUID } from 'crypto'
import {
  appendFileSync,
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
  writeSync,
} from 'fs'
import { join } from 'path'

import { scheduleResourceAccess } from './resourceLockScheduler.js'

const FORMAT_VERSION = 2
const PARTITIONS = 256
const ROTATE_BYTES = 1024 * 1024
const ROTATE_RECORDS = 1000
const LOOKUP_MAGIC = "FDBKVLK2"
const LOOKUP_HEADER = 16
const LOOKUP_RECORD = 76

function hashKey(key) {
  return createHash("sha256").update(key).digest("hex")
}

function checksum(payload) {
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex")
}

function encodeRecord(record) {
  const payload = {
    version: FORMAT_VERSION,
    key: record.key,
    revision: record.revision,
    operation: record.operation,
  }
  if (record.operation === "set") payload.value = record.value
  return JSON.stringify({ ...payload, checksum: checksum(payload) })
}

function decodeRecord(line) {
  try {
    const record = JSON.parse(line)
    const payload = {
      version: record.version,
      key: record.key,
      revision: record.revision,
      operation: record.operation,
    }
    if (record.operation === "set") payload.value = record.value
    if (
      record.version !== FORMAT_VERSION ||
      typeof record.key !== "string" ||
      Number.isSafeInteger(record.revision) === false ||
      record.revision < 1 ||
      (record.operation !== "set" && record.operation !== "delete") ||
      record.checksum !== checksum(payload)
    ) return null
    return payload
  } catch (_) {
    return null
  }
}

function writeAll(descriptor, buffer) {
  let offset = 0
  while (offset < buffer.length) {
    offset += writeSync(descriptor, buffer, offset, buffer.length - offset)
  }
}

function atomicWrite(file, contents) {
  const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`
  const descriptor = openSync(temporary, "wx")
  try {
    writeAll(descriptor, Buffer.from(contents))
    fsyncSync(descriptor)
  } finally {
    closeSync(descriptor)
  }
  renameSync(temporary, file)
}

function legacyDecodeWal(file) {
  if (existsSync(file) === false) return []
  const contents = readFileSync(file)
  const records = []
  let offset = 0
  while (offset + 4 <= contents.length) {
    const length = contents.readUInt32BE(offset)
    const end = offset + 4 + length + 32
    if (end > contents.length) break
    const payload = contents.subarray(offset + 4, offset + 4 + length)
    const expected = contents.subarray(offset + 4 + length, end)
    const actual = createHash("sha256").update(payload).digest()
    if (actual.equals(expected) === false) throw new Error(`Corrupt WAL checksum at byte ${offset}`)
    records.push(JSON.parse(payload.toString()))
    offset = end
  }
  return records
}

export const readWal = legacyDecodeWal

function latest(left, right) {
  if (left === undefined) return right
  if (right === undefined) return left
  return right.revision >= left.revision ? right : left
}

export class KVCachePersistence {
  constructor(root, options = {}) {
    this.root = root
    this.cacheRoot = join(root, ".kvstore-cache")
    this.partitionsRoot = join(this.cacheRoot, "partitions")
    this.manifestPath = join(this.cacheRoot, "manifest.json")
    this.writerToken = `${process.pid}-${randomUUID()}`
    this.rotateBytes = options.rotateBytes ?? ROTATE_BYTES
    this.rotateRecords = options.rotateRecords ?? ROTATE_RECORDS
    this.writerFiles = new Map()
    this.writerCounts = new Map()
    this.states = new Map()
    this.compactions = new Map()
  }

  async initialize() {
    mkdirSync(this.root, { recursive: true })
    await scheduleResourceAccess(
      [{ resource: "cache:migration", mode: "exclusive" }],
      {},
      async () => {
        mkdirSync(this.partitionsRoot, { recursive: true })
        if (existsSync(this.manifestPath) === false) {
          const migrated = this.readLegacyState()
          if (migrated.size > 0) {
            await this.append([...migrated].map(([key, value]) => ({
              key,
              revision: 1,
              operation: "set",
              value,
            })), { durability: "sync", compact: false })
          }
          atomicWrite(this.manifestPath, JSON.stringify({
            version: FORMAT_VERSION,
            partitions: PARTITIONS,
          }))
          this.archiveLegacyFiles()
        } else {
          const manifest = JSON.parse(readFileSync(this.manifestPath, "utf8"))
          if (manifest.version !== FORMAT_VERSION || manifest.partitions !== PARTITIONS) {
            throw new Error("Unsupported KV cache manifest")
          }
        }
      },
      { root: this.root, operation: "migrateKVCache" },
    )
  }

  readLegacyState() {
    const state = new Map()
    const legacyObject = join(this.root, ".kvstore")
    const snapshotPath = join(this.root, ".kvstore.snapshot")
    if (existsSync(legacyObject)) {
      const parsed = JSON.parse(readFileSync(legacyObject, "utf8") || "{}")
      for (const [key, value] of Object.entries(parsed)) state.set(key, value)
    }
    let sequence = 0
    if (existsSync(snapshotPath)) {
      const snapshot = JSON.parse(readFileSync(snapshotPath, "utf8"))
      sequence = snapshot.sequence ?? 0
      for (const [key, value] of Object.entries(snapshot.data ?? {})) state.set(key, value)
    }
    for (const file of [
      join(this.root, ".kvstore.wal.rotating"),
      join(this.root, ".kvstore.wal"),
    ]) {
      for (const record of legacyDecodeWal(file)) {
        if (record.sequence <= sequence) continue
        for (const operation of record.operations) {
          if (operation.type === "set") state.set(operation.key, operation.value)
          else if (operation.type === "delete") state.delete(operation.key)
        }
        sequence = record.sequence
      }
    }
    return state
  }

  archiveLegacyFiles() {
    for (const name of [".kvstore", ".kvstore.snapshot", ".kvstore.wal", ".kvstore.wal.rotating"]) {
      const source = join(this.root, name)
      const destination = join(this.root, `${name}.legacy`)
      if (existsSync(source) && existsSync(destination) === false) renameSync(source, destination)
    }
  }

  partition(key) {
    return hashKey(key).slice(0, 2)
  }

  paths(code) {
    const root = join(this.partitionsRoot, code)
    const writers = join(root, "writers")
    mkdirSync(writers, { recursive: true })
    return { root, writers, current: join(root, "CURRENT") }
  }

  currentBase(code) {
    const files = this.paths(code)
    if (existsSync(files.current) === false) return { id: null, included: [] }
    try {
      return JSON.parse(readFileSync(files.current, "utf8"))
    } catch (_) {
      return { id: null, included: [] }
    }
  }

  baseRecord(code, key) {
    const current = this.currentBase(code)
    if (current.id === null) return undefined
    const files = this.paths(code)
    const lookupPath = join(files.root, `base-${current.id}.lookup`)
    const dataPath = join(files.root, `base-${current.id}.jsonl`)
    if (existsSync(lookupPath) === false || existsSync(dataPath) === false) return undefined
    const descriptor = openSync(lookupPath, "r")
    const header = Buffer.alloc(LOOKUP_HEADER)
    const record = Buffer.alloc(LOOKUP_RECORD)
    const wanted = hashKey(key)
    try {
      if (readSync(descriptor, header, 0, header.length, 0) !== header.length) return undefined
      if (header.toString("ascii", 0, 8) !== LOOKUP_MAGIC) return undefined
      let low = 0
      let high = Number(header.readBigUInt64BE(8)) - 1
      while (low <= high) {
        const middle = Math.floor((low + high) / 2)
        readSync(descriptor, record, 0, record.length, LOOKUP_HEADER + middle * LOOKUP_RECORD)
        const found = record.toString("ascii", 0, 64)
        if (found === wanted) {
          const offset = Number(record.readBigUInt64BE(64))
          const length = record.readUInt32BE(72)
          const data = Buffer.alloc(length)
          const dataDescriptor = openSync(dataPath, "r")
          try {
            readSync(dataDescriptor, data, 0, length, offset)
          } finally {
            closeSync(dataDescriptor)
          }
          const decoded = decodeRecord(data.toString().trimEnd())
          return decoded?.key === key ? decoded : undefined
        }
        if (found < wanted) low = middle + 1
        else high = middle - 1
      }
      return undefined
    } finally {
      closeSync(descriptor)
    }
  }

  refresh(code) {
    const files = this.paths(code)
    const current = this.currentBase(code)
    let state = this.states.get(code)
    if (state === undefined || state.baseId !== current.id) {
      state = { baseId: current.id, offsets: new Map(), latest: new Map() }
      this.states.set(code, state)
    }
    const included = new Set(current.included ?? [])
    const names = readdirSync(files.writers)
      .filter((name) => name.endsWith(".jsonl") && included.has(name) === false)
    for (const name of names) {
      const file = join(files.writers, name)
      const size = statSync(file).size
      let offset = state.offsets.get(name) ?? 0
      if (size < offset) offset = 0
      if (size === offset) continue
      const descriptor = openSync(file, "r")
      const buffer = Buffer.alloc(size - offset)
      try {
        readSync(descriptor, buffer, 0, buffer.length, offset)
      } finally {
        closeSync(descriptor)
      }
      const lastNewline = buffer.lastIndexOf(10)
      if (lastNewline === -1) continue
      for (const line of buffer.subarray(0, lastNewline).toString().split("\n")) {
        if (line.length === 0) continue
        const record = decodeRecord(line)
        if (record === null) continue
        state.latest.set(record.key, latest(state.latest.get(record.key), record))
      }
      state.offsets.set(name, offset + lastNewline + 1)
    }
    return state
  }

  async read(keys) {
    const byPartition = new Map()
    for (const key of keys) {
      const code = this.partition(key)
      if (byPartition.has(code) === false) byPartition.set(code, [])
      byPartition.get(code).push(key)
    }
    const results = new Map()
    for (const [code, partitionKeys] of byPartition) {
      const state = this.refresh(code)
      for (const key of partitionKeys) {
        const record = latest(this.baseRecord(code, key), state.latest.get(key))
        results.set(key, record)
      }
    }
    return results
  }

  writerFile(code) {
    let file = this.writerFiles.get(code)
    if (file !== undefined) return file
    const files = this.paths(code)
    file = join(files.writers, `${this.writerToken}-${randomUUID()}.active.jsonl`)
    writeFileSync(file, "", { flag: "wx" })
    this.writerFiles.set(code, file)
    this.writerCounts.set(code, 0)
    return file
  }

  rotate(code) {
    const file = this.writerFiles.get(code)
    if (file === undefined || existsSync(file) === false) return
    const count = this.writerCounts.get(code) ?? 0
    if (statSync(file).size < this.rotateBytes && count < this.rotateRecords) return
    const sealed = file.replace(".active.jsonl", ".sealed.jsonl")
    renameSync(file, sealed)
    this.writerFiles.delete(code)
    this.writerCounts.delete(code)
    this.scheduleCompaction(code)
  }

  async append(records, options = {}) {
    const groups = new Map()
    for (const record of records) {
      const code = this.partition(record.key)
      if (groups.has(code) === false) groups.set(code, [])
      groups.get(code).push(record)
    }
    for (const [code, group] of groups) {
      const file = this.writerFile(code)
      const contents = `${group.map(encodeRecord).join("\n")}\n`
      appendFileSync(file, contents)
      if (options.durability === "sync") {
        const descriptor = openSync(file, "r+")
        try {
          fsyncSync(descriptor)
        } finally {
          closeSync(descriptor)
        }
      }
      this.writerCounts.set(code, (this.writerCounts.get(code) ?? 0) + group.length)
      this.refresh(code)
      if (options.compact !== false) this.rotate(code)
    }
  }

  scheduleCompaction(code) {
    if (this.compactions.has(code)) return
    const promise = this.compact(code).finally(() => this.compactions.delete(code))
    this.compactions.set(code, promise)
    promise.catch(() => {})
  }

  async compact(code) {
    return await scheduleResourceAccess(
      [{ resource: `cache-partition:${code}:maintenance`, mode: "exclusive" }],
      { priority: "background" },
      async () => {
        const files = this.paths(code)
        const current = this.currentBase(code)
        const included = new Set(current.included ?? [])
        const sealed = readdirSync(files.writers).filter((name) => (
          name.endsWith(".sealed.jsonl") && included.has(name) === false
        ))
        if (sealed.length === 0) return
        const records = new Map()
        if (current.id !== null) {
          const base = join(files.root, `base-${current.id}.jsonl`)
          if (existsSync(base)) {
            for (const line of readFileSync(base, "utf8").split("\n")) {
              if (line.length === 0) continue
              const record = decodeRecord(line)
              if (record !== null) records.set(record.key, latest(records.get(record.key), record))
            }
          }
        }
        for (const name of sealed) {
          for (const line of readFileSync(join(files.writers, name), "utf8").split("\n")) {
            if (line.length === 0) continue
            const record = decodeRecord(line)
            if (record !== null) records.set(record.key, latest(records.get(record.key), record))
          }
        }
        const entries = [...records.values()]
          .filter((record) => record.operation === "set")
          .sort((left, right) => hashKey(left.key).localeCompare(hashKey(right.key)))
        const id = randomUUID()
        const dataPath = join(files.root, `base-${id}.jsonl`)
        const lookupPath = join(files.root, `base-${id}.lookup`)
        const dataDescriptor = openSync(dataPath, "wx")
        const lookupDescriptor = openSync(lookupPath, "wx")
        try {
          const header = Buffer.alloc(LOOKUP_HEADER)
          header.write(LOOKUP_MAGIC, 0, 8, "ascii")
          header.writeBigUInt64BE(BigInt(entries.length), 8)
          writeAll(lookupDescriptor, header)
          let offset = 0
          for (const entry of entries) {
            const line = Buffer.from(`${encodeRecord(entry)}\n`)
            writeAll(dataDescriptor, line)
            const lookup = Buffer.alloc(LOOKUP_RECORD)
            lookup.write(hashKey(entry.key), 0, 64, "ascii")
            lookup.writeBigUInt64BE(BigInt(offset), 64)
            lookup.writeUInt32BE(line.length, 72)
            writeAll(lookupDescriptor, lookup)
            offset += line.length
          }
          fsyncSync(dataDescriptor)
          fsyncSync(lookupDescriptor)
        } finally {
          closeSync(dataDescriptor)
          closeSync(lookupDescriptor)
        }
        atomicWrite(files.current, JSON.stringify({
          id,
          included: [...included, ...sealed],
        }))
        this.states.delete(code)
      },
      { root: this.root, operation: "compactKVCache" },
    )
  }
}

export const KVWalPersistence = KVCachePersistence
export const KV_CACHE_LIMITS = {
  partitions: PARTITIONS,
  rotateBytes: ROTATE_BYTES,
  rotateRecords: ROTATE_RECORDS,
}
