import {
  closeSync,
  createReadStream,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
  writeSync,
} from 'fs'
import { randomUUID } from 'crypto'
import { join } from 'path'
import readline from 'readline'

import { checkCollection, checkDocument, checkIndex } from '../utils/checks.js'
import { Wrap } from '../utils/errors.js'
import { path } from '../utils/fs.js'

const HEADER_SIZE = 32
const LOOKUP_RECORD_SIZE = 36
const DELTA_RECORD_SIZE = 37
const CHUNK_ENTRIES = 100_000
const DELTA_ENTRIES = 100_000
const OFFSETS_MAGIC = "FDBOFFS1"
const LOOKUP_MAGIC = "FDBLOOK1"
const deltaCache = new Map()

function sourceInfo(filePath) {
  const stats = statSync(filePath, { bigint: true })
  return { size: stats.size, mtime: stats.mtimeNs }
}

function header(magic, count, source) {
  const buffer = Buffer.alloc(HEADER_SIZE)
  buffer.write(magic, 0, 8, "ascii")
  buffer.writeBigUInt64BE(BigInt(count), 8)
  buffer.writeBigUInt64BE(source.size, 16)
  buffer.writeBigUInt64BE(source.mtime, 24)
  return buffer
}

function readHeader(filePath, magic) {
  if (existsSync(filePath) === false) return null
  const descriptor = openSync(filePath, "r")
  try {
    const buffer = Buffer.alloc(HEADER_SIZE)
    if (readSync(descriptor, buffer, 0, buffer.length, 0) !== buffer.length) return null
    if (buffer.toString("ascii", 0, 8) !== magic) return null
    return {
      count: Number(buffer.readBigUInt64BE(8)),
      size: buffer.readBigUInt64BE(16),
      mtime: buffer.readBigUInt64BE(24),
    }
  } finally {
    closeSync(descriptor)
  }
}

function writeAll(descriptor, buffer, position = null) {
  let offset = 0
  while (offset < buffer.length) {
    offset += writeSync(
      descriptor,
      buffer,
      offset,
      buffer.length - offset,
      position === null ? null : position + offset,
    )
  }
}

async function scanLines(filePath, callback) {
  const input = createReadStream(filePath)
  let pending = Buffer.alloc(0)
  let pendingOffset = 0
  for await (const chunk of input) {
    const combined = pending.length === 0 ? chunk : Buffer.concat([pending, chunk])
    let start = 0
    while (true) {
      const newline = combined.indexOf(10, start)
      if (newline === -1) break
      const length = newline - start + 1
      await callback(combined.subarray(start, newline), pendingOffset + start, length)
      start = newline + 1
    }
    pendingOffset += start
    pending = combined.subarray(start)
  }
  if (pending.length > 0) await callback(pending, pendingOffset, pending.length)
}

function writeRun(runDirectory, number, entries) {
  entries.sort((left, right) => (
    left.id.localeCompare(right.id) || left.position - right.position
  ))
  const runPath = join(runDirectory, `${number}.run`)
  writeFileSync(
    runPath,
    `${entries.map((entry) => (
      `${entry.id}\t${entry.offset}\t${entry.length}\t${entry.position}`
    )).join("\n")}\n`,
  )
  return runPath
}

function openRun(filePath) {
  const input = createReadStream(filePath)
  const lines = readline.createInterface({ input, crlfDelay: Infinity })
  const iterator = lines[Symbol.asyncIterator]()
  return {
    async next() {
      const value = await iterator.next()
      if (value.done) return undefined
      const [id, offset, length, position] = value.value.split("\t")
      return { id, offset: Number(offset), length: Number(length), position: Number(position) }
    },
    close() {
      lines.close()
      input.destroy()
    },
  }
}

function lookupRecord(entry) {
  const buffer = Buffer.alloc(LOOKUP_RECORD_SIZE)
  buffer.write(entry.id, 0, 24, "ascii")
  buffer.writeBigUInt64BE(BigInt(entry.offset), 24)
  buffer.writeUInt32BE(entry.length, 32)
  return buffer
}

async function mergeRuns(runs, descriptor) {
  const readers = runs.map(openRun)
  const heads = []
  let count = 0
  try {
    for (let index = 0; index < readers.length; index += 1) {
      const entry = await readers[index].next()
      if (entry !== undefined) heads.push({ index, entry })
    }
    let pending
    while (heads.length > 0) {
      heads.sort((left, right) => (
        left.entry.id.localeCompare(right.entry.id) ||
        left.entry.position - right.entry.position
      ))
      const next = heads.shift()
      if (pending !== undefined && pending.id !== next.entry.id) {
        writeAll(descriptor, lookupRecord(pending))
        count += 1
      }
      pending = next.entry
      const replacement = await readers[next.index].next()
      if (replacement !== undefined) heads.push({ index: next.index, entry: replacement })
    }
    if (pending !== undefined) {
      writeAll(descriptor, lookupRecord(pending))
      count += 1
    }
    return count
  } finally {
    readers.forEach((reader) => reader.close())
  }
}

function sidecarPaths(index, collection) {
  return {
    source: path(collection, `${index}.jsonl`),
    offsets: path(collection, `${index}.offsets`),
    lookup: path(collection, `${index}.lookup`),
    delta: path(collection, `${index}.lookup.delta`),
  }
}

export async function buildIndexSidecars(index, collection) {
  const files = sidecarPaths(index, collection)
  const token = `${process.pid}-${randomUUID()}`
  const temporaryOffsets = `${files.offsets}.${token}.tmp`
  const temporaryLookup = `${files.lookup}.${token}.tmp`
  const temporaryDelta = `${files.delta}.${token}.tmp`
  const runDirectory = path(collection, `.${index}.lookup-${token}`)
  mkdirSync(runDirectory)
  const offsetsDescriptor = openSync(temporaryOffsets, "wx")
  const runs = []
  let entries = []
  let rowCount = 0
  try {
    writeAll(offsetsDescriptor, Buffer.alloc(HEADER_SIZE))
    const zero = Buffer.alloc(8)
    writeAll(offsetsDescriptor, zero)
    await scanLines(files.source, async (line, offset, length) => {
      const end = Buffer.alloc(8)
      end.writeBigUInt64BE(BigInt(offset + length))
      writeAll(offsetsDescriptor, end)
      const object = JSON.parse(line.toString())
      if (typeof object._id === "string" && object._id.length === 24) {
        entries.push({ id: object._id, offset, length, position: rowCount })
        if (entries.length >= CHUNK_ENTRIES) {
          runs.push(writeRun(runDirectory, runs.length, entries))
          entries = []
        }
      }
      rowCount += 1
    })
    if (entries.length > 0) runs.push(writeRun(runDirectory, runs.length, entries))
    const source = sourceInfo(files.source)
    writeAll(offsetsDescriptor, header(OFFSETS_MAGIC, rowCount, source), 0)
    fsyncSync(offsetsDescriptor)
    closeSync(offsetsDescriptor)

    const lookupDescriptor = openSync(temporaryLookup, "wx")
    writeAll(lookupDescriptor, Buffer.alloc(HEADER_SIZE))
    const lookupCount = await mergeRuns(runs, lookupDescriptor)
    writeAll(lookupDescriptor, header(LOOKUP_MAGIC, lookupCount, source), 0)
    fsyncSync(lookupDescriptor)
    closeSync(lookupDescriptor)
    writeFileSync(temporaryDelta, "")

    renameSync(temporaryOffsets, files.offsets)
    renameSync(temporaryLookup, files.lookup)
    renameSync(temporaryDelta, files.delta)
    deltaCache.delete(files.delta)
    return { rows: rowCount, documents: lookupCount }
  } catch (err) {
    try {
      closeSync(offsetsDescriptor)
    } catch (_) {}
    rmSync(temporaryOffsets, { force: true })
    rmSync(temporaryLookup, { force: true })
    rmSync(temporaryDelta, { force: true })
    throw err
  } finally {
    rmSync(runDirectory, { recursive: true, force: true })
  }
}

function isFresh(files) {
  const source = sourceInfo(files.source)
  const offsets = readHeader(files.offsets, OFFSETS_MAGIC)
  const lookup = readHeader(files.lookup, LOOKUP_MAGIC)
  return offsets !== null && lookup !== null &&
    offsets.size === source.size && offsets.mtime === source.mtime &&
    lookup.size === source.size && lookup.mtime === source.mtime
}

export async function ensureIndexSidecars(index, collection) {
  const files = sidecarPaths(index, collection)
  const deltaSize = existsSync(files.delta) ? statSync(files.delta).size : 0
  if (
    isFresh(files) === false ||
    deltaSize > DELTA_ENTRIES * DELTA_RECORD_SIZE
  ) await buildIndexSidecars(index, collection)
  return files
}

export async function refreshIndexSidecars(index, collection) {
  try {
    await buildIndexSidecars(index, collection)
    return true
  } catch (_) {
    removeIndexSidecars(index, collection)
    return false
  }
}

export async function readIndexRows(index, collection, from, count) {
  const files = await ensureIndexSidecars(index, collection)
  const info = readHeader(files.offsets, OFFSETS_MAGIC)
  if (from >= info.count || count <= 0) return []
  const rows = Math.min(count, info.count - from)
  const offsetBuffer = Buffer.alloc((rows + 1) * 8)
  const offsetsDescriptor = openSync(files.offsets, "r")
  try {
    readSync(
      offsetsDescriptor,
      offsetBuffer,
      0,
      offsetBuffer.length,
      HEADER_SIZE + from * 8,
    )
  } finally {
    closeSync(offsetsDescriptor)
  }
  const start = Number(offsetBuffer.readBigUInt64BE(0))
  const end = Number(offsetBuffer.readBigUInt64BE(rows * 8))
  const source = Buffer.alloc(end - start)
  const sourceDescriptor = openSync(files.source, "r")
  try {
    readSync(sourceDescriptor, source, 0, source.length, start)
  } finally {
    closeSync(sourceDescriptor)
  }
  return source.toString().trimEnd().split("\n").map((line) => JSON.parse(line))
}

function loadDelta(filePath) {
  if (existsSync(filePath) === false) return new Map()
  const stats = statSync(filePath)
  const cached = deltaCache.get(filePath)
  if (cached?.size === stats.size && cached.mtime === stats.mtimeMs) return cached.entries
  const contents = readFileSync(filePath)
  const entries = new Map()
  for (let offset = 0; offset + DELTA_RECORD_SIZE <= contents.length; offset += DELTA_RECORD_SIZE) {
    const status = contents[offset]
    const id = contents.toString("ascii", offset + 1, offset + 25)
    entries.set(id, status === 2 ? null : {
      offset: Number(contents.readBigUInt64BE(offset + 25)),
      length: contents.readUInt32BE(offset + 33),
    })
  }
  deltaCache.set(filePath, { size: stats.size, mtime: stats.mtimeMs, entries })
  return entries
}

function binarySearchLookup(filePath, id) {
  const info = readHeader(filePath, LOOKUP_MAGIC)
  const descriptor = openSync(filePath, "r")
  const record = Buffer.alloc(LOOKUP_RECORD_SIZE)
  try {
    let low = 0
    let high = info.count - 1
    while (low <= high) {
      const middle = Math.floor((low + high) / 2)
      readSync(
        descriptor,
        record,
        0,
        record.length,
        HEADER_SIZE + middle * LOOKUP_RECORD_SIZE,
      )
      const current = record.toString("ascii", 0, 24)
      const compared = current.localeCompare(id)
      if (compared === 0) {
        return {
          offset: Number(record.readBigUInt64BE(24)),
          length: record.readUInt32BE(32),
        }
      }
      if (compared < 0) low = middle + 1
      else high = middle - 1
    }
    return undefined
  } finally {
    closeSync(descriptor)
  }
}

async function findIndexEntryRaw(index, collection, document) {
  const files = await ensureIndexSidecars(index, collection)
  const delta = loadDelta(files.delta)
  const location = delta.has(document)
    ? delta.get(document)
    : binarySearchLookup(files.lookup, document)
  if (location === undefined || location === null) return undefined
  const buffer = Buffer.alloc(location.length)
  const descriptor = openSync(files.source, "r")
  try {
    readSync(descriptor, buffer, 0, buffer.length, location.offset)
  } finally {
    closeSync(descriptor)
  }
  return JSON.parse(buffer.toString().trimEnd())
}

export async function findIndexEntry(index, collection, document) {
  const indexError = checkIndex(index)
  if (indexError instanceof Error) throw Wrap("Cannot start findIndexEntry", indexError)
  const collectionError = checkCollection(collection)
  if (collectionError instanceof Error) {
    throw Wrap("Cannot start findIndexEntry", collectionError)
  }
  const documentError = checkDocument(document)
  if (documentError instanceof Error) {
    throw Wrap("Cannot start findIndexEntry", documentError)
  }
  try {
    return await findIndexEntryRaw(index, collection, document)
  } catch (err) {
    throw Wrap("Cannot run findIndexEntry", err)
  }
}

export function appendIndexSidecars(index, collection, entry, location) {
  if (location === undefined) return false
  const files = sidecarPaths(index, collection)
  const offsets = readHeader(files.offsets, OFFSETS_MAGIC)
  const lookup = readHeader(files.lookup, LOOKUP_MAGIC)
  if (
    offsets === null ||
    lookup === null ||
    offsets.size !== BigInt(location.offset) ||
    lookup.size !== BigInt(location.offset) ||
    existsSync(files.delta) === false
  ) return false

  const source = sourceInfo(files.source)
  const offsetsDescriptor = openSync(files.offsets, "r+")
  try {
    const end = Buffer.alloc(8)
    end.writeBigUInt64BE(BigInt(location.offset + location.length))
    writeAll(
      offsetsDescriptor,
      end,
      HEADER_SIZE + (offsets.count + 1) * 8,
    )
    writeAll(
      offsetsDescriptor,
      header(OFFSETS_MAGIC, offsets.count + 1, source),
      0,
    )
    fsyncSync(offsetsDescriptor)
  } finally {
    closeSync(offsetsDescriptor)
  }

  const lookupDescriptor = openSync(files.lookup, "r+")
  try {
    writeAll(lookupDescriptor, header(LOOKUP_MAGIC, lookup.count, source), 0)
    fsyncSync(lookupDescriptor)
  } finally {
    closeSync(lookupDescriptor)
  }

  if (typeof entry._id === "string" && entry._id.length === 24) {
    const record = Buffer.alloc(DELTA_RECORD_SIZE)
    record[0] = 1
    record.write(entry._id, 1, 24, "ascii")
    record.writeBigUInt64BE(BigInt(location.offset), 25)
    record.writeUInt32BE(location.length, 33)
    const deltaDescriptor = openSync(files.delta, "a")
    try {
      writeAll(deltaDescriptor, record)
      fsyncSync(deltaDescriptor)
    } finally {
      closeSync(deltaDescriptor)
    }
    deltaCache.delete(files.delta)
  }
  return true
}

export function removeIndexSidecars(index, collection) {
  const files = sidecarPaths(index, collection)
  rmSync(files.offsets, { force: true })
  rmSync(files.lookup, { force: true })
  rmSync(files.delta, { force: true })
  deltaCache.delete(files.delta)
}
