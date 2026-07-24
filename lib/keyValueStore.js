import { deepcopy } from '../utils/deepcopy.js'
import { Wrap } from '../utils/errors.js'
import { path } from '../utils/fs.js'
import {
  scheduleKVMutation,
  validateKVMutationOptions,
} from './kvLockScheduler.js'
import { KVWalPersistence } from './kvPersistence.js'

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

  async mutate(keys, options, operation, change) {
    await this.ready
    return await scheduleKVMutation(keys, options, change, {
      root: this.root,
      operation,
    })
  }

  async setMany(entries, options, operation = "setManyKV") {
    const keys = entries.map(([key]) => key)
    return await this.mutate(keys, options, operation, async () => {
      const operations = entries.map(([key, value]) => ({ type: "set", key, value }))
      await this.persistence.commit(operations, options)
      return entries.map(([, value]) => deepcopy(value))
    })
  }

  async set(key, value, options) {
    const [stored] = await this.setMany([[key, value]], options, "setKV")
    return stored
  }

  async get(key) {
    await this.ready
    const { store } = await this.persistence.read()
    if (store.has(key) === false) return undefined
    return deepcopy(store.get(key))
  }

  async has(key) {
    await this.ready
    const { store } = await this.persistence.read()
    return store.has(key)
  }

  async deleteMany(keys, options, operation = "deleteManyKV") {
    return await this.mutate(keys, options, operation, async () => {
      const { result } = await this.persistence.commit((state) => {
        const staged = new Map(state.store)
        const results = []
        const operations = []
        for (const key of keys) {
          const existed = staged.delete(key)
          results.push(existed)
          if (existed) operations.push({ type: "delete", key })
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
