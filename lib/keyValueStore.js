import { mkdirSync } from 'fs'

import { deepcopy } from '../utils/deepcopy.js'
import { Wrap } from '../utils/errors.js'
import { exists, path, readfile } from '../utils/fs.js'
import { persistKeyValueStore } from './keyValuePersistence.js'

const STORE_FILE = ".kvstore"

function ensureSerializable(value) {
  if (value === undefined) {
    throw new Error("Value cannot be undefined")
  }
  try {
    return deepcopy(value)
  } catch (err) {
    throw new Error("Value must be JSON serializable")
  }
}

function cloneValue(value) {
  return deepcopy(value)
}

function ensureKey(key) {
  if (key === undefined || key === null) {
    throw new Error("Key must be defined")
  }
  const normalized = `${key}`
  if (normalized.length === 0) {
    throw new Error("Key cannot be empty")
  }
  return normalized
}

class KeyValueStore {
  constructor(fileName = STORE_FILE) {
    this.fileName = fileName
    this.store = new Map()
    this.queue = Promise.resolve()
    this.ready = this.bootstrap()
  }

  async bootstrap() {
    try {
      this.ensureRootExists()
      if (exists(this.fileName) === false) {
        persistKeyValueStore(this.store, this.fileName)
        return
      }

      const raw = readfile(this.fileName).toString()

      if (raw.trim().length === 0) return
      const parsed = JSON.parse(raw)
      Object.entries(parsed).forEach(([key, value]) => {
        this.store.set(key, value)
      })
    } catch (err) {
      throw Wrap("Cannot initialize keyValueStore", err)
    }
  }

  ensureRootExists() {
    const root = path()
    try {
      mkdirSync(root, { recursive: true })
    } catch (err) {
      if (err.code !== "EEXIST") throw err
    }
  }

  enqueue(task) {
    const run = this.queue.then(() => task())
    this.queue = run.catch(() => undefined)
    return run
  }

  async commit(mutate) {
    await this.ready
    return await this.enqueue(() => {
      const staged = new Map(this.store)
      const result = mutate(staged)
      this.persist(staged)
      this.store = staged
      return result
    })
  }

  async setMany(entries) {
    return await this.commit((staged) => {
      entries.forEach(([key, value]) => staged.set(key, value))
      return entries.map(([, value]) => cloneValue(value))
    })
  }

  async get(key) {
    await this.ready
    if (this.store.has(key) === false) return undefined
    return cloneValue(this.store.get(key))
  }

  async has(key) {
    await this.ready
    return this.store.has(key)
  }

  async deleteMany(keys) {
    return await this.commit((staged) => {
      return keys.map((key) => staged.delete(key))
    })
  }

  persist(store) {
    this.ensureRootExists()
    persistKeyValueStore(store, this.fileName)
  }
}

const keyValueStore = new KeyValueStore()

export async function setKV(key, value) {
  let prepared
  try {
    prepared = [ensureKey(key), ensureSerializable(value)]
  } catch (err) {
    throw Wrap("Cannot start setKV", err)
  }
  try {
    const [stored] = await keyValueStore.setMany([prepared])
    return stored
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
    const [deleted] = await keyValueStore.deleteMany([normalized])
    return deleted
  } catch (err) {
    throw Wrap("Cannot run deleteKV", err)
  }
}

function prepareSetEntries(entries) {
  if (Array.isArray(entries) === false) {
    throw new Error("Entries must be an array")
  }

  const prepared = []
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index]
    if (Array.isArray(entry) === false || entry.length !== 2) {
      throw new Error(`Entry at index ${index} must be a [key, value] pair`)
    }
    prepared.push([ensureKey(entry[0]), ensureSerializable(entry[1])])
  }
  return prepared
}

function prepareDeleteKeys(keys) {
  if (Array.isArray(keys) === false) {
    throw new Error("Keys must be an array")
  }
  const prepared = []
  for (let index = 0; index < keys.length; index += 1) {
    prepared.push(ensureKey(keys[index]))
  }
  return prepared
}

function ensureMutationOptions(options) {
  if (options === undefined) return
  if (options === null || typeof options !== "object" || Array.isArray(options)) {
    throw new Error("Mutation options must be an object")
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
    return await keyValueStore.setMany(prepared)
  } catch (err) {
    throw Wrap("Cannot run setManyKV", err)
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
    return await keyValueStore.deleteMany(prepared)
  } catch (err) {
    throw Wrap("Cannot run deleteManyKV", err)
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
