import {
  closeSync,
  createReadStream,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'fs'
import { createHash, randomUUID } from 'crypto'
import { join } from 'path'

import { checkCollection } from '../utils/checks.js'
import { DOCUMENTID } from '../utils/constants.js'
import { deepcopy } from '../utils/deepcopy.js'
import { Wrap } from '../utils/errors.js'
import { atomicwritejson, path } from '../utils/fs.js'
import { newid } from '../utils/ids.js'
import { scheduleKVMutation } from './kvLockScheduler.js'

const BUFFER_BYTES = 1024 * 1024
const CACHE_SHARDS = 4
const shardCache = new Map()

function shardForId(id) {
  return createHash("sha256").update(id).digest("hex").slice(0, 2)
}

function syncDirectory(directory) {
  const descriptor = openSync(directory, "r")
  try {
    fsyncSync(descriptor)
  } finally {
    closeSync(descriptor)
  }
}

function ensureCollection(collection) {
  const error = checkCollection(collection)
  if (error instanceof Error) throw error
  if (existsSync(path(collection)) === false) throw new Error("Collection does not exist")
}

function ensureNodeId(nodeId) {
  if (typeof nodeId !== "string" || /^[a-zA-Z0-9_-]{1,64}$/.test(nodeId) === false) {
    throw new Error("nodeId must contain 1-64 letters, numbers, underscores, or dashes")
  }
  return nodeId
}

function locations(collection) {
  const collectionPath = path(collection)
  return {
    collectionPath,
    segmentsPath: join(collectionPath, "segments"),
    derivedPath: join(collectionPath, ".facesdb"),
    indexPath: join(collectionPath, ".facesdb", "segments"),
    manifestPath: join(collectionPath, ".facesdb", "manifest.json"),
  }
}

function ensureLocations(collection) {
  const result = locations(collection)
  mkdirSync(result.segmentsPath, { recursive: true })
  mkdirSync(result.indexPath, { recursive: true })
  return result
}

function readManifest(paths) {
  if (existsSync(paths.manifestPath) === false) return { version: 1, segments: [] }
  const manifest = JSON.parse(readFileSync(paths.manifestPath, "utf8"))
  if (manifest.version !== 1 || Array.isArray(manifest.segments) === false) {
    throw new Error("Invalid segmented collection manifest")
  }
  return manifest
}

function manifestVersion(manifest) {
  return manifest.segments.join("|")
}

function invalidateCollectionCache(collection) {
  for (const key of shardCache.keys()) {
    if (key.startsWith(`${collection}:`)) shardCache.delete(key)
  }
}

class BufferedFile {
  constructor(filePath) {
    this.filePath = filePath
    this.descriptor = openSync(filePath, "wx")
    this.buffers = []
    this.bufferBytes = 0
    this.offset = 0
  }

  write(buffer) {
    const start = this.offset + this.bufferBytes
    this.buffers.push(buffer)
    this.bufferBytes += buffer.length
    if (this.bufferBytes >= BUFFER_BYTES) this.flush()
    return start
  }

  flush() {
    if (this.bufferBytes === 0) return
    const buffer = Buffer.concat(this.buffers, this.bufferBytes)
    writeFileSync(this.descriptor, buffer)
    this.offset += buffer.length
    this.buffers = []
    this.bufferBytes = 0
  }

  close({ durable = true } = {}) {
    if (this.descriptor === undefined) return
    this.flush()
    if (durable) fsyncSync(this.descriptor)
    closeSync(this.descriptor)
    this.descriptor = undefined
  }
}

class ShardWriters {
  constructor(directory) {
    this.directory = directory
    this.writers = new Map()
    mkdirSync(directory, { recursive: true })
  }

  write(id, offset, length, operation, revision) {
    const shard = shardForId(id)
    let writer = this.writers.get(shard)
    if (writer === undefined) {
      writer = new BufferedFile(join(this.directory, `${shard}.unsorted`))
      this.writers.set(shard, writer)
    }
    writer.write(Buffer.from(
      `${id}\t${offset}\t${length}\t${operation}\t${revision}\n`,
    ))
  }

  finish() {
    for (const writer of this.writers.values()) writer.close({ durable: false })
    for (const [shard, writer] of this.writers) {
      const rows = readFileSync(writer.filePath, "utf8").trim().split("\n")
      rows.sort((left, right) => left.slice(0, 24).localeCompare(right.slice(0, 24)))
      const deduplicated = []
      for (const row of rows) {
        if (
          deduplicated.length > 0 &&
          deduplicated.at(-1).slice(0, 24) === row.slice(0, 24)
        ) deduplicated[deduplicated.length - 1] = row
        else deduplicated.push(row)
      }
      writeFileSync(join(this.directory, `${shard}.idx`), `${deduplicated.join("\n")}\n`)
      rmSync(writer.filePath, { force: true })
    }
    syncDirectory(this.directory)
  }

  abort() {
    for (const writer of this.writers.values()) {
      try {
        writer.close({ durable: false })
      } catch (_) {}
    }
    rmSync(this.directory, { recursive: true, force: true })
  }
}

function prepareDocument(document, segmentId, operation = "put", sequence = 0) {
  if (document === null || Array.isArray(document) || typeof document !== "object") {
    throw new Error("Documents must be objects")
  }
  const copy = deepcopy(document)
  const id = copy._id === undefined ? newid() : `${copy._id}`
  if (DOCUMENTID.test(id) === false) throw new Error(`Invalid document id: ${id}`)
  const revision = `${segmentId}:${`${sequence}`.padStart(12, "0")}`
  if (operation === "delete") return { _id: id, _rev: revision, _op: "delete" }
  return { ...copy, _id: id, _rev: revision, _op: "put" }
}

async function indexSegment(segmentPath, indexDirectory) {
  const shards = new ShardWriters(indexDirectory)
  const input = createReadStream(segmentPath)
  let pending = Buffer.alloc(0)
  let pendingOffset = 0
  try {
    for await (const chunk of input) {
      const combined = pending.length === 0 ? chunk : Buffer.concat([pending, chunk])
      let start = 0
      while (true) {
        const newline = combined.indexOf(10, start)
        if (newline === -1) break
        const length = newline - start + 1
        const record = JSON.parse(combined.subarray(start, newline).toString())
        shards.write(
          record._id,
          pendingOffset + start,
          length,
          record._op,
          record._rev,
        )
        start = newline + 1
      }
      pendingOffset += start
      pending = combined.subarray(start)
    }
    if (pending.length > 0) {
      const record = JSON.parse(pending.toString())
      shards.write(
        record._id,
        pendingOffset,
        pending.length,
        record._op,
        record._rev,
      )
    }
    shards.finish()
  } catch (err) {
    shards.abort()
    throw err
  }
}

async function refreshUnlocked(collection) {
  const paths = ensureLocations(collection)
  const segmentFiles = readdirSync(paths.segmentsPath)
    .filter((name) => name.endsWith(".jsonl"))
    .sort()
  const manifest = readManifest(paths)
  for (const segment of segmentFiles) {
    const segmentId = segment.slice(0, -6)
    const indexDirectory = join(paths.indexPath, segmentId)
    if (existsSync(indexDirectory) === false) {
      const temporary = `${indexDirectory}.${process.pid}.${randomUUID()}.tmp`
      await indexSegment(join(paths.segmentsPath, segment), temporary)
      renameSync(temporary, indexDirectory)
      syncDirectory(paths.indexPath)
    }
  }
  if (manifest.segments.join("|") !== segmentFiles.join("|")) {
    atomicwritejson(
      { version: 1, segments: segmentFiles },
      collection,
      ".facesdb",
      "manifest.json",
    )
    invalidateCollectionCache(collection)
  }
  return { paths, manifest: { version: 1, segments: segmentFiles } }
}

export async function refreshCollectionIndex(collection) {
  try {
    ensureCollection(collection)
    const refreshed = await scheduleKVMutation(
      [`facesdb:collection:${collection}:segments`],
      {},
      async () => await refreshUnlocked(collection),
      { root: path(), operation: "refreshCollectionIndex" },
    )
    return { segments: refreshed.manifest.segments.length }
  } catch (err) {
    throw Wrap("Cannot run refreshCollectionIndex", err)
  }
}

async function importPrepared(collection, documents, options, operation) {
  ensureCollection(collection)
  const nodeId = ensureNodeId(options.nodeId ?? "local")
  const paths = ensureLocations(collection)
  const latestTimestamp = readdirSync(paths.segmentsPath)
    .map((name) => Number(name.slice(0, 13)))
    .filter(Number.isSafeInteger)
    .reduce((latest, value) => Math.max(latest, value), 0)
  const timestamp = Math.max(Date.now(), latestTimestamp + 1)
  const segmentId = `${`${timestamp}`.padStart(13, "0")}-${nodeId}-${randomUUID()}`
  const segmentName = `${segmentId}.jsonl`
  const temporarySegment = join(paths.segmentsPath, `.${segmentName}.tmp`)
  const temporaryIndex = join(paths.indexPath, `.${segmentId}.${process.pid}.tmp`)
  const segmentWriter = new BufferedFile(temporarySegment)
  const shards = new ShardWriters(temporaryIndex)
  let count = 0
  try {
    for await (const document of documents) {
      const prepared = prepareDocument(document, segmentId, operation, count)
      const line = Buffer.from(`${JSON.stringify(prepared)}\n`)
      const offset = segmentWriter.write(line)
      shards.write(prepared._id, offset, line.length, prepared._op, prepared._rev)
      count += 1
    }
    segmentWriter.close()
    shards.finish()
    if (count === 0) {
      rmSync(temporarySegment, { force: true })
      rmSync(temporaryIndex, { recursive: true, force: true })
      return { segment: null, count: 0 }
    }
    renameSync(temporarySegment, join(paths.segmentsPath, segmentName))
    renameSync(temporaryIndex, join(paths.indexPath, segmentId))
    syncDirectory(paths.segmentsPath)
    syncDirectory(paths.indexPath)
    await refreshUnlocked(collection)
    return { segment: segmentName, count }
  } catch (err) {
    try {
      segmentWriter.close()
    } catch (_) {}
    shards.abort()
    rmSync(temporarySegment, { force: true })
    throw err
  }
}

export async function importDocuments(collection, documents, options = {}) {
  try {
    ensureCollection(collection)
    if (documents?.[Symbol.iterator] === undefined && documents?.[Symbol.asyncIterator] === undefined) {
      throw new Error("Documents must be iterable")
    }
    return await scheduleKVMutation(
      [`facesdb:collection:${collection}:segments`],
      options,
      async () => await importPrepared(collection, documents, options, "put"),
      { root: path(), operation: "importDocuments" },
    )
  } catch (err) {
    throw Wrap("Cannot run importDocuments", err)
  }
}

export async function deleteSegmentDocuments(collection, documentIds, options = {}) {
  const tombstones = {
    async *[Symbol.asyncIterator]() {
      for await (const id of documentIds) yield { _id: id }
    },
  }
  try {
    ensureCollection(collection)
    return await scheduleKVMutation(
      [`facesdb:collection:${collection}:segments`],
      options,
      async () => await importPrepared(collection, tombstones, options, "delete"),
      { root: path(), operation: "deleteSegmentDocuments" },
    )
  } catch (err) {
    throw Wrap("Cannot run deleteSegmentDocuments", err)
  }
}

function loadShard(collection, paths, manifest, shard) {
  const version = manifestVersion(manifest)
  const cacheKey = `${collection}:${shard}`
  const cached = shardCache.get(cacheKey)
  if (cached?.version === version) {
    shardCache.delete(cacheKey)
    shardCache.set(cacheKey, cached)
    return cached.entries
  }

  const entries = new Map()
  for (const segmentName of manifest.segments) {
    const segmentId = segmentName.slice(0, -6)
    const indexFile = join(paths.indexPath, segmentId, `${shard}.idx`)
    if (existsSync(indexFile) === false) continue
    const rows = readFileSync(indexFile, "utf8").trim()
    if (rows.length === 0) continue
    for (const row of rows.split("\n")) {
      const [id, offset, length, operation, revision] = row.split("\t")
      entries.set(id, {
        segmentName,
        offset: Number(offset),
        length: Number(length),
        operation,
        revision,
      })
    }
  }
  shardCache.set(cacheKey, { version, entries })
  while (shardCache.size > CACHE_SHARDS) shardCache.delete(shardCache.keys().next().value)
  return entries
}

export async function viewSegmentDocument(collection, document) {
  try {
    ensureCollection(collection)
    if (typeof document !== "string" || DOCUMENTID.test(document) === false) {
      throw new Error("Invalid document id")
    }
    const state = await getSegmentCollectionState(collection)
    const location = findSegmentLocation(collection, state, document)
    if (location === undefined || location.operation === "delete") return undefined

    const descriptor = openSync(join(state.paths.segmentsPath, location.segmentName), "r")
    try {
      const buffer = Buffer.allocUnsafe(location.length)
      readSync(descriptor, buffer, 0, buffer.length, location.offset)
      const record = JSON.parse(buffer.toString().trimEnd())
      const { _op, _rev, ...result } = record
      return result
    } finally {
      closeSync(descriptor)
    }
  } catch (err) {
    throw Wrap("Cannot run viewSegmentDocument", err)
  }
}

export async function getSegmentCollectionState(collection) {
  ensureCollection(collection)
  return await scheduleKVMutation(
      [`facesdb:collection:${collection}:segments`],
      {},
      async () => await refreshUnlocked(collection),
      { root: path(), operation: "viewSegmentDocument" },
  )
}

export function findSegmentLocation(collection, state, document) {
  return loadShard(
    collection,
    state.paths,
    state.manifest,
    shardForId(document),
  ).get(document)
}
