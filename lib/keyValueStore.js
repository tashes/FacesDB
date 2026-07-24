import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'fs'
import { dirname, join } from 'path'

import { deepcopy } from '../utils/deepcopy.js'
import { Wrap } from '../utils/errors.js'
import { path } from '../utils/fs.js'
import { createKVLockManager, syncDirectory } from './kvLockManager.js'

const STORE_FILE = ".kvstore"
const COMMIT_LOCK_KEY = "facesdb:kv:commit"

function ensureSerializable(value) {
  if (value === undefined) throw new Error("Value cannot be undefined")
  try {
    return deepcopy(value)
  } catch (_) {
    throw new Error("Value must be JSON serializable")
  }
}

function cloneValue(value) {
  return deepcopy(value)
}

function ensureKey(key) {
  if (key === undefined || key === null) throw new Error("Key must be defined")
  const normalized = `${key}`
  if (normalized.length === 0) throw new Error("Key cannot be empty")
  return normalized
}

function readSnapshot(filePath) {
  if (existsSync(filePath) === false) return new Map()
  const raw = readFileSync(filePath, "utf8")
  if (raw.trim().length === 0) return new Map()
  return new Map(Object.entries(JSON.parse(raw)))
}

function writeSnapshot(filePath, store) {
  const temporary = join(
    dirname(filePath),
    `${STORE_FILE}.${process.pid}.${Date.now()}.${Math.random()}.tmp`,
  )
  let descriptor
  try {
    descriptor = openSync(temporary, "wx")
    writeFileSync(descriptor, JSON.stringify(Object.fromEntries(store.entries())))
    fsyncSync(descriptor)
    closeSync(descriptor)
    descriptor = undefined
    renameSync(temporary, filePath)
    syncDirectory(dirname(filePath))
  } catch (err) {
    if (descriptor !== undefined) closeSync(descriptor)
    try {
      unlinkSync(temporary)
    } catch (_) {}
    throw err
  }
}

class KeyValueStore {
  constructor(fileName = STORE_FILE) {
    this.rootPath = path()
    this.filePath = path(fileName)
    this.locks = createKVLockManager({ rootPath: this.rootPath })
    this.commitLocks = createKVLockManager({
      rootPath: this.rootPath,
      directoryName: ".kvstore-commit-locks",
    })
    this.ready = this.bootstrap()
  }

  async bootstrap() {
    try {
      mkdirSync(this.rootPath, { recursive: true })
      const release = await this.commitLocks.acquire([COMMIT_LOCK_KEY])
      try {
        if (existsSync(this.filePath) === false) writeSnapshot(this.filePath, new Map())
      } finally {
        release()
      }
    } catch (err) {
      throw Wrap("Cannot initialize keyValueStore", err)
    }
  }

  async mutate(key, options, change) {
    await this.ready
    const releaseKey = await this.locks.acquire([key], options)
    try {
      const releaseCommit = await this.commitLocks.acquire([COMMIT_LOCK_KEY], options)
      try {
        const store = readSnapshot(this.filePath)
        const result = change(store)
        if (result.changed) writeSnapshot(this.filePath, store)
        return result.value
      } finally {
        releaseCommit()
      }
    } finally {
      releaseKey()
    }
  }

  async set(key, value, options) {
    const prepared = ensureSerializable(value)
    return await this.mutate(key, options, (store) => {
      store.set(key, prepared)
      return { changed: true, value: cloneValue(prepared) }
    })
  }

  async get(key) {
    await this.ready
    const store = readSnapshot(this.filePath)
    if (store.has(key) === false) return undefined
    return cloneValue(store.get(key))
  }

  async has(key) {
    await this.ready
    return readSnapshot(this.filePath).has(key)
  }

  async delete(key, options) {
    return await this.mutate(key, options, (store) => {
      if (store.has(key) === false) return { changed: false, value: false }
      store.delete(key)
      return { changed: true, value: true }
    })
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
