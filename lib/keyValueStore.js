import { deepcopy } from '../utils/deepcopy.js'
import { Wrap } from '../utils/errors.js'
import { path } from '../utils/fs.js'
import { scheduleResourceAccess, validateLockOptions } from './resourceLockScheduler.js'
import { KVCachePersistence } from './kvPersistence.js'

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

function ensureOptions(options = {}) {
  validateLockOptions(options)
  if (options.durability !== undefined && options.durability !== "buffered" && options.durability !== "sync") {
    throw new Error("durability must be buffered or sync")
  }
}

function wrapRuntime(operation, err) {
  if (err.code === "RESOURCE_LOCK_TIMEOUT") err.code = "KV_LOCK_TIMEOUT"
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

function prepareKeys(keys) {
  if (Array.isArray(keys) === false) throw new Error("Keys must be an array")
  return keys.map(ensureKey)
}

function visible(record) {
  return record !== undefined && record.operation === "set"
}

export class KeyValueStore {
  constructor(root = path(), persistenceOptions = {}) {
    this.root = root
    this.persistence = new KVCachePersistence(root, persistenceOptions)
    this.ready = this.persistence.initialize()
  }

  async access(keys, mode, options, operation, task) {
    await this.ready
    const unique = [...new Set(keys)]
    return await scheduleResourceAccess(
      unique.map((key) => ({ resource: `kv:${key}`, mode })),
      options,
      task,
      { root: this.root, operation, resourceCount: unique.length },
    )
  }

  async getMany(keys, options, operation = "getManyKV") {
    return await this.access(keys, "shared", options, operation, async () => {
      const records = await this.persistence.read(keys)
      return keys.map((key) => {
        const record = records.get(key)
        return visible(record) ? deepcopy(record.value) : undefined
      })
    })
  }

  async hasMany(keys, options, operation = "hasManyKV") {
    return await this.access(keys, "shared", options, operation, async () => {
      const records = await this.persistence.read(keys)
      return keys.map((key) => visible(records.get(key)))
    })
  }

  async setMany(entries, options, operation = "setManyKV", returnValues = true) {
    const keys = entries.map(([key]) => key)
    return await this.access(keys, "exclusive", options, operation, async () => {
      const records = await this.persistence.read(keys)
      const next = new Map(records)
      const writes = entries.map(([key, value]) => {
        const record = {
          key,
          revision: (next.get(key)?.revision ?? 0) + 1,
          operation: "set",
          value,
        }
        next.set(key, record)
        return record
      })
      await this.persistence.append(writes, options)
      return returnValues ? entries.map(([, value]) => deepcopy(value)) : undefined
    })
  }

  async deleteMany(keys, options, operation = "deleteManyKV") {
    return await this.access(keys, "exclusive", options, operation, async () => {
      const current = await this.persistence.read(keys)
      const next = new Map(current)
      const results = []
      const writes = []
      for (const key of keys) {
        const record = next.get(key)
        const existed = visible(record)
        results.push(existed)
        if (existed) {
          const deletion = {
            key,
            revision: record.revision + 1,
            operation: "delete",
          }
          writes.push(deletion)
          next.set(key, deletion)
        }
      }
      if (writes.length > 0) await this.persistence.append(writes, options)
      return results
    })
  }

  async update(key, updater, options) {
    return await this.access([key], "exclusive", options, "updateKV", async () => {
      const current = (await this.persistence.read([key])).get(key)
      const value = visible(current) ? deepcopy(current.value) : undefined
      const updated = updater(value)
      if (updated?.then instanceof Function) throw new Error("updateKV callback must be synchronous")
      const stored = ensureSerializable(updated)
      await this.persistence.append([{
        key,
        revision: (current?.revision ?? 0) + 1,
        operation: "set",
        value: stored,
      }], options)
      return deepcopy(stored)
    })
  }

  async versioned(key, options) {
    return await this.access([key], "shared", options, "getVersionedKV", async () => {
      const record = (await this.persistence.read([key])).get(key)
      return {
        value: visible(record) ? deepcopy(record.value) : undefined,
        revision: record?.revision ?? 0,
      }
    })
  }

  async compareAndSet(key, expectedRevision, value, options) {
    return await this.access([key], "exclusive", options, "compareAndSetKV", async () => {
      const current = (await this.persistence.read([key])).get(key)
      if ((current?.revision ?? 0) !== expectedRevision) return false
      await this.persistence.append([{
        key,
        revision: expectedRevision + 1,
        operation: "set",
        value,
      }], options)
      return true
    })
  }
}

const keyValueStore = new KeyValueStore()

export async function setKV(key, value, options) {
  let prepared
  try {
    ensureOptions(options)
    prepared = [ensureKey(key), ensureSerializable(value)]
  } catch (err) {
    throw Wrap("Cannot start setKV", err)
  }
  try {
    const [stored] = await keyValueStore.setMany([prepared], options, "setKV")
    return stored
  } catch (err) {
    throw wrapRuntime("setKV", err)
  }
}

export async function setManyKV(entries, options) {
  let prepared
  try {
    ensureOptions(options)
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

export async function getKV(key, options) {
  let normalized
  try {
    ensureOptions(options)
    normalized = ensureKey(key)
  } catch (err) {
    throw Wrap("Cannot start getKV", err)
  }
  try {
    return (await keyValueStore.getMany([normalized], options, "getKV"))[0]
  } catch (err) {
    throw wrapRuntime("getKV", err)
  }
}

export async function getManyKV(keys, options) {
  let prepared
  try {
    ensureOptions(options)
    prepared = prepareKeys(keys)
  } catch (err) {
    throw Wrap("Cannot start getManyKV", err)
  }
  if (prepared.length === 0) return []
  try {
    return await keyValueStore.getMany(prepared, options)
  } catch (err) {
    throw wrapRuntime("getManyKV", err)
  }
}

export async function hasKV(key, options) {
  let normalized
  try {
    ensureOptions(options)
    normalized = ensureKey(key)
  } catch (err) {
    throw Wrap("Cannot start hasKV", err)
  }
  try {
    return (await keyValueStore.hasMany([normalized], options, "hasKV"))[0]
  } catch (err) {
    throw wrapRuntime("hasKV", err)
  }
}

export async function hasManyKV(keys, options) {
  let prepared
  try {
    ensureOptions(options)
    prepared = prepareKeys(keys)
  } catch (err) {
    throw Wrap("Cannot start hasManyKV", err)
  }
  if (prepared.length === 0) return []
  try {
    return await keyValueStore.hasMany(prepared, options)
  } catch (err) {
    throw wrapRuntime("hasManyKV", err)
  }
}

export async function deleteKV(key, options) {
  let normalized
  try {
    ensureOptions(options)
    normalized = ensureKey(key)
  } catch (err) {
    throw Wrap("Cannot start deleteKV", err)
  }
  try {
    return (await keyValueStore.deleteMany([normalized], options, "deleteKV"))[0]
  } catch (err) {
    throw wrapRuntime("deleteKV", err)
  }
}

export async function deleteManyKV(keys, options) {
  let prepared
  try {
    ensureOptions(options)
    prepared = prepareKeys(keys)
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

export async function updateKV(key, updater, options) {
  let normalized
  try {
    ensureOptions(options)
    normalized = ensureKey(key)
    if (typeof updater !== "function") throw new Error("updater must be a function")
  } catch (err) {
    throw Wrap("Cannot start updateKV", err)
  }
  try {
    return await keyValueStore.update(normalized, updater, options)
  } catch (err) {
    throw wrapRuntime("updateKV", err)
  }
}

export async function getVersionedKV(key, options) {
  let normalized
  try {
    ensureOptions(options)
    normalized = ensureKey(key)
  } catch (err) {
    throw Wrap("Cannot start getVersionedKV", err)
  }
  try {
    return await keyValueStore.versioned(normalized, options)
  } catch (err) {
    throw wrapRuntime("getVersionedKV", err)
  }
}

export async function compareAndSetKV(key, expectedRevision, value, options) {
  let normalized
  let stored
  try {
    ensureOptions(options)
    normalized = ensureKey(key)
    if (Number.isSafeInteger(expectedRevision) === false || expectedRevision < 0) {
      throw new Error("expectedRevision must be a non-negative safe integer")
    }
    stored = ensureSerializable(value)
  } catch (err) {
    throw Wrap("Cannot start compareAndSetKV", err)
  }
  try {
    return await keyValueStore.compareAndSet(normalized, expectedRevision, stored, options)
  } catch (err) {
    throw wrapRuntime("compareAndSetKV", err)
  }
}

export async function importManyKV(entries, options = {}) {
  let batchSize
  try {
    ensureOptions(options)
    if (entries?.[Symbol.iterator] === undefined && entries?.[Symbol.asyncIterator] === undefined) {
      throw new Error("Entries must be iterable")
    }
    batchSize = options.batchSize ?? 10_000
    if (Number.isSafeInteger(batchSize) === false || batchSize <= 0 || batchSize > 100_000) {
      throw new Error("batchSize must be an integer between 1 and 100000")
    }
  } catch (err) {
    throw Wrap("Cannot start importManyKV", err)
  }
  let count = 0
  let batches = 0
  let prepared = []
  try {
    for await (const entry of entries) {
      if (Array.isArray(entry) === false || entry.length !== 2) {
        throw new Error(`Entry at index ${count} must be a [key, value] pair`)
      }
      prepared.push([ensureKey(entry[0]), ensureSerializable(entry[1])])
      count += 1
      if (prepared.length >= batchSize) {
        await keyValueStore.setMany(prepared, options, "importManyKV", false)
        batches += 1
        prepared = []
      }
    }
    if (prepared.length > 0) {
      await keyValueStore.setMany(prepared, options, "importManyKV", false)
      batches += 1
    }
    return { count, batches }
  } catch (err) {
    throw wrapRuntime("importManyKV", err)
  }
}
