import { mkdirSync } from 'fs'

import { deepcopy } from '../utils/deepcopy.js'
import { Wrap } from '../utils/errors.js'
import { exists, path, readfile, writejson } from '../utils/fs.js'
import { scheduleKVMutation } from './kvLockScheduler.js'

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
        writejson({}, this.fileName)
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

  reload() {
    this.store.clear()
    if (exists(this.fileName) === false) return
    const raw = readfile(this.fileName).toString()
    if (raw.trim().length === 0) return
    const parsed = JSON.parse(raw)
    Object.entries(parsed).forEach(([key, value]) => this.store.set(key, value))
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
    this.queue = run.catch((err) => {
      this.queue = Promise.resolve()
      throw err
    })
    return run
  }

  async set(key, value, options) {
    await this.ready
    const prepared = ensureSerializable(value)
    await scheduleKVMutation([key], options, async () => {
      await this.enqueue(() => {
        this.reload()
        this.store.set(key, prepared)
        this.persist()
      })
    })
    return cloneValue(prepared)
  }

  async get(key) {
    await this.ready
    this.reload()
    if (this.store.has(key) === false) return undefined
    return cloneValue(this.store.get(key))
  }

  async has(key) {
    await this.ready
    this.reload()
    return this.store.has(key)
  }

  async delete(key, options) {
    await this.ready
    return await scheduleKVMutation([key], options, async () => {
      return await this.enqueue(() => {
        this.reload()
        if (this.store.has(key) === false) return false
        this.store.delete(key)
        this.persist()
        return true
      })
    })
  }

  persist() {
    this.ensureRootExists()
    const payload = Object.fromEntries(this.store.entries())
    writejson(payload, this.fileName)
  }
}

const keyValueStore = new KeyValueStore()

export async function setKV(key, value, options) {
  let normalized
  try {
    normalized = ensureKey(key)
  } catch (err) {
    throw Wrap("Cannot start setKV", err)
  }
  try {
    return await keyValueStore.set(normalized, value, options)
  } catch (err) {
    const wrapped = Wrap("Cannot run setKV", err)
    if (err.code === "KV_LOCK_TIMEOUT") Object.assign(wrapped, {
      code: err.code,
      keyHash: err.keyHash,
      priority: err.priority,
      namespace: err.namespace,
    })
    throw wrapped
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
    normalized = ensureKey(key)
  } catch (err) {
    throw Wrap("Cannot start deleteKV", err)
  }
  try {
    return await keyValueStore.delete(normalized, options)
  } catch (err) {
    const wrapped = Wrap("Cannot run deleteKV", err)
    if (err.code === "KV_LOCK_TIMEOUT") Object.assign(wrapped, {
      code: err.code,
      keyHash: err.keyHash,
      priority: err.priority,
      namespace: err.namespace,
    })
    throw wrapped
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
