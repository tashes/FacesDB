import {
  existsSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'fs'
import { randomUUID } from 'crypto'
import { createReadStream } from 'fs'
import readline from 'readline'

import { appendjsonl, path } from '../utils/fs.js'

const overlayCache = new Map()

function cacheKey(index, collection) {
  return `${path(collection)}\0${index}`
}

export function activeUpdateName(index) {
  return `${index}.updates.jsonl`
}

export function updateFiles(index, collection, includeActive = true) {
  try {
    const rotated = path(collection, `.${index}.updates.rotated.jsonl`)
    const files = existsSync(rotated) ? [rotated] : []
    const active = path(collection, activeUpdateName(index))
    if (includeActive && existsSync(active)) files.push(active)
    return files
  } catch (_) {
    return []
  }
}

function signature(files) {
  return files.map((file) => {
    const stats = statSync(file, { bigint: true })
    return `${file}:${stats.size}:${stats.mtimeNs}`
  }).join("|")
}

export function readIndexOverlay(index, collection, { includeActive = true } = {}) {
  const files = updateFiles(index, collection, includeActive)
  const key = `${cacheKey(index, collection)}:${includeActive}`
  const currentSignature = signature(files)
  const cached = overlayCache.get(key)
  if (cached?.signature === currentSignature) return cached.entries
  const entries = new Map()
  for (const file of files) {
    for (const line of readFileSync(file, "utf8").split("\n")) {
      if (line.length === 0) continue
      try {
        const entry = JSON.parse(line)
        if (typeof entry._id === "string") entries.set(entry._id, entry)
      } catch (_) {
        // A torn final cache line is safely ignored; documents remain authoritative.
      }
    }
  }
  overlayCache.set(key, { signature: currentSignature, entries })
  return entries
}

export function appendIndexUpdate(index, collection, entry) {
  const location = appendjsonl(entry, collection, activeUpdateName(index))
  invalidateIndexOverlay(index, collection)
  return location
}

export function deleteIndexUpdate(index, collection, document) {
  return appendIndexUpdate(index, collection, {
    _id: document,
    _facesdbDeleted: true,
  })
}

export function rotateIndexUpdates(index, collection) {
  const active = path(collection, activeUpdateName(index))
  const rotated = path(collection, `.${index}.updates.rotated.jsonl`)
  if (existsSync(rotated)) return `.${index}.updates.rotated.jsonl`
  if (existsSync(active) === false || statSync(active).size === 0) return undefined
  const name = `.${index}.updates.rotated.jsonl`
  renameSync(active, rotated)
  writeFileSync(active, "")
  invalidateIndexOverlay(index, collection)
  return name
}

export function indexUpdateStats(index, collection) {
  const files = updateFiles(index, collection)
  let bytes = 0
  let records = 0
  for (const file of files) {
    bytes += statSync(file).size
    const contents = readFileSync(file, "utf8")
    for (let offset = 0; offset < contents.length; offset += 1) {
      if (contents.charCodeAt(offset) === 10) records += 1
    }
  }
  return { bytes, records }
}

export function removeIndexUpdates(index, collection, { rotatedOnly = false } = {}) {
  for (const file of updateFiles(index, collection, rotatedOnly === false)) {
    if (rotatedOnly && file.endsWith(activeUpdateName(index))) continue
    rmSync(file, { force: true })
  }
  invalidateIndexOverlay(index, collection)
}

export function invalidateIndexOverlay(index, collection) {
  const prefix = cacheKey(index, collection)
  for (const key of overlayCache.keys()) {
    if (key.startsWith(prefix)) overlayCache.delete(key)
  }
}

export function hasIndexUpdates(index, collection) {
  return updateFiles(index, collection).some((file) => statSync(file).size > 0)
}

export async function* iterateLogicalIndex(index, collection, { includeActive = true } = {}) {
  const overlay = readIndexOverlay(index, collection, { includeActive })
  const input = createReadStream(path(collection, `${index}.jsonl`))
  const lines = readline.createInterface({ input, crlfDelay: Infinity })
  try {
    for await (const line of lines) {
      if (line.length === 0) continue
      const entry = JSON.parse(line)
      if (overlay.has(entry._id)) continue
      yield entry
    }
  } finally {
    lines.close()
    input.destroy()
  }
  for (const entry of overlay.values()) {
    if (entry._facesdbDeleted === true) continue
    yield entry
  }
}

export async function readLogicalIndex(index, collection, from = 0, count = Infinity) {
  const results = []
  let position = 0
  for await (const entry of iterateLogicalIndex(index, collection)) {
    if (position >= from && results.length < count) results.push(entry)
    position += 1
    if (results.length >= count) break
  }
  return results
}
