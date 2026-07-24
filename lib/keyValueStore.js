import { deepcopy } from '../utils/deepcopy.js'
import { Wrap } from '../utils/errors.js'
import { path } from '../utils/fs.js'
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

export class KeyValueStore {
  constructor(root = path(), persistenceOptions = {}) {
    this.persistence = new KVWalPersistence(root, persistenceOptions)
    this.ready = this.persistence.initialize()
  }

  async set(key, value) {
    await this.ready
    const prepared = ensureSerializable(value)
    await this.persistence.commit([{ type: "set", key, value: prepared }])
    return deepcopy(prepared)
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

  async delete(key) {
    await this.ready
    const { result } = await this.persistence.commit((state) => {
      const existed = state.store.has(key)
      return {
        operations: existed ? [{ type: "delete", key }] : [],
        result: existed,
      }
    })
    return result
  }
}

const keyValueStore = new KeyValueStore()

export async function setKV(key, value) {
  let normalized
  try {
    normalized = ensureKey(key)
  } catch (err) {
    throw Wrap("Cannot start setKV", err)
  }
  try {
    return await keyValueStore.set(normalized, value)
  } catch (err) {
    throw Wrap("Cannot run setKV", err)
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

export async function deleteKV(key) {
  let normalized
  try {
    normalized = ensureKey(key)
  } catch (err) {
    throw Wrap("Cannot start deleteKV", err)
  }
  try {
    return await keyValueStore.delete(normalized)
  } catch (err) {
    throw Wrap("Cannot run deleteKV", err)
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
