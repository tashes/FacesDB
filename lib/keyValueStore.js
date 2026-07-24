import { createHash } from 'crypto'
import { existsSync, mkdirSync } from 'fs'
import { join } from 'path'

import { deepcopy } from '../utils/deepcopy.js'
import { Wrap } from '../utils/errors.js'
import { atomicwritejson, path } from '../utils/fs.js'
import {
  scheduleKVMutation,
  validateKVMutationOptions,
} from './kvLockScheduler.js'
import { KVWalPersistence } from './kvPersistence.js'
import {
  deleteSegmentDocuments,
  importDocuments,
  viewSegmentDocument,
} from './segmentStore.js'

const BATCH_TRANSACTION_LOCK = "facesdb:internal:batch-transaction"
const KV_MODE_LOCK = "facesdb:internal:kv-mode"
const SEGMENT_COLLECTION = "kvsegments"
const SEGMENT_MARKER = ".kvstore.segmented"

function segmentDocumentId(key) {
  return createHash("sha256").update(key).digest("hex").slice(0, 24)
}

function ensureSerializable(value) {
  if (value === undefined) throw new Error("Value cannot be undefined")
  try {
    return deepcopy(value)
  } catch (_) {
    throw new Error("Value must be JSON serializable")
  }
}

function ensureKey(key) {
  if (key === undefined || key === null) throw new Error("Key must be defined")
  const normalized = `${key}`
  if (normalized.length === 0) throw new Error("Key cannot be empty")
  return normalized
}

function wrapRuntime(operation, err) {
  const wrapped = Wrap(`Cannot run ${operation}`, err)
  if (err.code === "KV_LOCK_TIMEOUT") {
    Object.assign(wrapped, {
      code: err.code,
      keyHash: err.keyHash,
      priority: err.priority,
      namespace: err.namespace,
    })
  }
  return wrapped
}

function prepareSetEntries(entries) {
  if (Array.isArray(entries) === false) throw new Error("Entries must be an array")
  return entries.map((entry, index) => {
    if (Array.isArray(entry) === false || entry.length !== 2) {
      throw new Error(`Entry at index ${index} must be a [key, value] pair`)
    }
    return [ensureKey(entry[0]), ensureSerializable(entry[1])]
  })
}

function prepareDeleteKeys(keys) {
  if (Array.isArray(keys) === false) throw new Error("Keys must be an array")
  return keys.map((key) => ensureKey(key))
}

function ensureMutationOptions(options) {
  validateKVMutationOptions(options)
}

export class KeyValueStore {
  constructor(root = path(), persistenceOptions = {}) {
    this.root = root
    this.persistence = new KVWalPersistence(root, persistenceOptions)
    this.ready = this.persistence.initialize()
  }

  isSegmented() {
    return existsSync(join(this.root, SEGMENT_MARKER))
  }

  ensureSegmentCollection() {
    mkdirSync(join(this.root, SEGMENT_COLLECTION, "bucket"), { recursive: true })
  }

  async getSegmentEntry(key) {
    const document = await viewSegmentDocument(
      SEGMENT_COLLECTION,
      segmentDocumentId(key),
    )
    if (document === undefined) return undefined
    if (document.key !== key) throw new Error("KV key hash collision")
    return document
  }

  async mutate(keys, options, operation, change) {
    await this.ready
    const uniqueKeys = new Set(keys)
    const lockKeys = uniqueKeys.size > 1
      ? [KV_MODE_LOCK, BATCH_TRANSACTION_LOCK]
      : [KV_MODE_LOCK, ...uniqueKeys]
    return await scheduleKVMutation(lockKeys, options, change, {
      root: this.root,
      operation,
      keyCount: uniqueKeys.size,
    })
  }

  async setMany(entries, options, operation = "setManyKV", returnValues = true) {
    const keys = entries.map(([key]) => key)
    return await this.mutate(keys, options, operation, async () => {
      if (this.isSegmented()) {
        await importDocuments(
          SEGMENT_COLLECTION,
          entries.map(([key, value]) => ({
            _id: segmentDocumentId(key),
            key,
            value,
          })),
          { ...options, nodeId: "kv" },
        )
        return returnValues
          ? entries.map(([, value]) => deepcopy(value))
          : undefined
      }
      const operations = entries.map(([key, value]) => ({ type: "set", key, value }))
      await this.persistence.commit(operations, options)
      return returnValues
        ? entries.map(([, value]) => deepcopy(value))
        : undefined
    })
  }

  async set(key, value, options) {
    const [stored] = await this.setMany([[key, value]], options, "setKV")
    return stored
  }

  async get(key) {
    await this.ready
    if (this.isSegmented()) {
      const entry = await this.getSegmentEntry(key)
      return entry === undefined ? undefined : deepcopy(entry.value)
    }
    const { store } = await this.persistence.read()
    if (store.has(key) === false) return undefined
    return deepcopy(store.get(key))
  }

  async has(key) {
    await this.ready
    if (this.isSegmented()) return await this.getSegmentEntry(key) !== undefined
    const { store } = await this.persistence.read()
    return store.has(key)
  }

  async deleteMany(keys, options, operation = "deleteManyKV") {
    return await this.mutate(keys, options, operation, async () => {
      if (this.isSegmented()) {
        const deleted = new Set()
        const results = []
        const tombstones = []
        for (const key of keys) {
          const existed = deleted.has(key) === false && await this.getSegmentEntry(key) !== undefined
          results.push(existed)
          if (existed) {
            deleted.add(key)
            tombstones.push(segmentDocumentId(key))
          }
        }
        if (tombstones.length > 0) {
          await deleteSegmentDocuments(
            SEGMENT_COLLECTION,
            tombstones,
            { ...options, nodeId: "kv" },
          )
        }
        return results
      }
      const { result } = await this.persistence.commit((state) => {
        const deleted = new Set()
        const results = []
        const operations = []
        for (const key of keys) {
          const existed = deleted.has(key) === false && state.store.has(key)
          results.push(existed)
          if (existed) {
            deleted.add(key)
            operations.push({ type: "delete", key })
          }
        }
        return {
          operations,
          result: results,
          forceCommit: operation === "deleteManyKV",
        }
      }, options)
      return result
    })
  }

  async delete(key, options) {
    const [deleted] = await this.deleteMany([key], options, "deleteKV")
    return deleted
  }

  async importMany(entries, options) {
    await this.ready
    return await scheduleKVMutation(
      [KV_MODE_LOCK],
      options,
      async () => {
        const alreadySegmented = this.isSegmented()
        this.ensureSegmentCollection()
        let count = 0
        const persistence = this.persistence
        const documents = {
          async *[Symbol.asyncIterator]() {
            if (alreadySegmented === false) {
              const state = await persistence.read(options)
              for (const [key, value] of state.store) {
                yield { _id: segmentDocumentId(key), key, value }
              }
            }
            for await (const entry of entries) {
              if (Array.isArray(entry) === false || entry.length !== 2) {
                throw new Error(`Entry at index ${count} must be a [key, value] pair`)
              }
              const key = ensureKey(entry[0])
              const value = ensureSerializable(entry[1])
              count += 1
              yield { _id: segmentDocumentId(key), key, value }
            }
          },
        }
        const result = await importDocuments(
          SEGMENT_COLLECTION,
          documents,
          { ...options, nodeId: "kv" },
        )
        if (alreadySegmented === false) {
          atomicwritejson({ version: 1 }, SEGMENT_MARKER)
          this.persistence.releaseCache()
        }
        return { count, batches: result.segment === null ? 0 : 1 }
      },
      { root: this.root, operation: "importManyKV", keyCount: 1 },
    )
  }
}

const keyValueStore = new KeyValueStore()

export async function setKV(key, value, options) {
  let prepared
  try {
    ensureMutationOptions(options)
    prepared = [ensureKey(key), ensureSerializable(value)]
  } catch (err) {
    throw Wrap("Cannot start setKV", err)
  }
  try {
    return await keyValueStore.set(prepared[0], prepared[1], options)
  } catch (err) {
    throw wrapRuntime("setKV", err)
  }
}

export async function setManyKV(entries, options) {
  let prepared
  try {
    ensureMutationOptions(options)
    prepared = prepareSetEntries(entries)
  } catch (err) {
    throw Wrap("Cannot start setManyKV", err)
  }
  if (prepared.length === 0) return []
  try {
    return await keyValueStore.setMany(prepared, options)
  } catch (err) {
    throw wrapRuntime("setManyKV", err)
  }
}

export async function getKV(key) {
  let normalized
  try {
    normalized = ensureKey(key)
  } catch (err) {
    throw Wrap("Cannot start getKV", err)
  }
  try {
    return await keyValueStore.get(normalized)
  } catch (err) {
    throw Wrap("Cannot run getKV", err)
  }
}

export async function deleteKV(key, options) {
  let normalized
  try {
    ensureMutationOptions(options)
    normalized = ensureKey(key)
  } catch (err) {
    throw Wrap("Cannot start deleteKV", err)
  }
  try {
    return await keyValueStore.delete(normalized, options)
  } catch (err) {
    throw wrapRuntime("deleteKV", err)
  }
}

export async function deleteManyKV(keys, options) {
  let prepared
  try {
    ensureMutationOptions(options)
    prepared = prepareDeleteKeys(keys)
  } catch (err) {
    throw Wrap("Cannot start deleteManyKV", err)
  }
  if (prepared.length === 0) return []
  try {
    return await keyValueStore.deleteMany(prepared, options)
  } catch (err) {
    throw wrapRuntime("deleteManyKV", err)
  }
}

export async function hasKV(key) {
  let normalized
  try {
    normalized = ensureKey(key)
  } catch (err) {
    throw Wrap("Cannot start hasKV", err)
  }
  try {
    return await keyValueStore.has(normalized)
  } catch (err) {
    throw Wrap("Cannot run hasKV", err)
  }
}

export async function importManyKV(entries, options = {}) {
  try {
    ensureMutationOptions(options)
    if (entries?.[Symbol.iterator] === undefined && entries?.[Symbol.asyncIterator] === undefined) {
      throw new Error("Entries must be iterable")
    }
  } catch (err) {
    throw Wrap("Cannot start importManyKV", err)
  }

  try {
    return await keyValueStore.importMany(entries, options)
  } catch (err) {
    throw wrapRuntime("importManyKV", err)
  }
}
