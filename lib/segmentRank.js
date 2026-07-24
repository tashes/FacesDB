import {
  createReadStream,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
} from 'fs'
import { join } from 'path'
import readline from 'readline'

import { checkCollection, checkIndex } from '../utils/checks.js'
import { Wrap } from '../utils/errors.js'
import { atomicwritejson, path } from '../utils/fs.js'
import { externalSortJsonl } from './rankIndex.js'
import {
  findSegmentLocation,
  getSegmentCollectionState,
} from './segmentStore.js'

function validateSpec(spec) {
  if (spec === null || Array.isArray(spec) || typeof spec !== "object") {
    throw new Error("Rank specification must be an object")
  }
  if (typeof spec.field !== "string" || spec.field.length === 0) {
    throw new Error("Rank field must be a non-empty string")
  }
  if (spec.order !== undefined && ["ascending", "descending"].includes(spec.order) === false) {
    throw new Error("Rank order must be ascending or descending")
  }
  if (spec.exclude !== undefined) {
    if (
      spec.exclude === null ||
      typeof spec.exclude !== "object" ||
      typeof spec.exclude.field !== "string"
    ) throw new Error("Rank exclusion must contain a field")
  }
  return {
    field: spec.field,
    order: spec.order ?? "descending",
    exclude: spec.exclude,
  }
}

function validateNames(index, collection) {
  const indexError = checkIndex(index)
  if (indexError instanceof Error) throw indexError
  const collectionError = checkCollection(collection)
  if (collectionError instanceof Error) throw collectionError
}

function compareValues(left, right) {
  if (Object.is(left, right)) return 0
  if (left === undefined || left === null) return 1
  if (right === undefined || right === null) return -1
  if (typeof left === "number" && typeof right === "number") return left - right
  return `${left}`.localeCompare(`${right}`)
}

function comparator(spec) {
  const direction = spec.order === "ascending" ? 1 : -1
  return (left, right) => {
    const compared = compareValues(left[spec.field], right[spec.field])
    if (compared !== 0) return compared * direction
    return left._id.localeCompare(right._id)
  }
}

function excluded(record, spec) {
  if (record._op !== "put") return true
  if (spec.exclude === undefined) return false
  return Object.is(record[spec.exclude.field], spec.exclude.equals)
}

function configPath(collection, index) {
  return path(collection, "ranks", `${index}.json`)
}

function readConfig(collection, index) {
  if (existsSync(configPath(collection, index)) === false) {
    throw new Error("Ranked index does not exist")
  }
  return validateSpec(JSON.parse(readFileSync(configPath(collection, index), "utf8")))
}

async function refreshRankedIndex(index, collection, spec) {
  const state = await getSegmentCollectionState(collection)
  const outputDirectory = path(collection, ".facesdb", "ranks", index)
  mkdirSync(outputDirectory, { recursive: true })
  for (const segmentName of state.manifest.segments) {
    const output = join(outputDirectory, segmentName)
    if (existsSync(output)) continue
    await externalSortJsonl(
      join(state.paths.segmentsPath, segmentName),
      [collection, ".facesdb", "ranks", index, segmentName],
      comparator(spec),
      (record) => excluded(record, spec),
      { label: `${index}-${segmentName}` },
    )
  }
  return state
}

class MinHeap {
  constructor(compare) {
    this.compare = compare
    this.values = []
  }

  push(value) {
    this.values.push(value)
    this.values.sort(this.compare)
  }

  pop() {
    return this.values.shift()
  }

  get size() {
    return this.values.length
  }
}

function openRun(filePath, segmentName) {
  const input = createReadStream(filePath)
  const lines = readline.createInterface({ input, crlfDelay: Infinity })
  const iterator = lines[Symbol.asyncIterator]()
  return {
    segmentName,
    async next() {
      const value = await iterator.next()
      return value.done ? undefined : JSON.parse(value.value)
    },
    close() {
      lines.close()
      input.destroy()
    },
  }
}

export async function createRankedIndex(index, collection, specification) {
  try {
    validateNames(index, collection)
    const spec = validateSpec(specification)
    const ranksPath = path(collection, "ranks")
    mkdirSync(ranksPath, { recursive: true })
    if (existsSync(configPath(collection, index))) throw new Error("Ranked index exists")
    await refreshRankedIndex(index, collection, spec)
    atomicwritejson(spec, collection, "ranks", `${index}.json`)
  } catch (err) {
    throw Wrap("Cannot run createRankedIndex", err)
  }
}

export async function viewRankedIndex(index, collection, { limit = 10 } = {}) {
  try {
    validateNames(index, collection)
    if (Number.isSafeInteger(limit) === false || limit < 0 || limit > 1000) {
      throw new Error("Rank limit must be an integer between 0 and 1000")
    }
    const spec = readConfig(collection, index)
    const state = await refreshRankedIndex(index, collection, spec)
    if (limit === 0) return []

    const directory = path(collection, ".facesdb", "ranks", index)
    const readers = readdirSync(directory)
      .filter((name) => name.endsWith(".jsonl"))
      .map((name) => openRun(join(directory, name), name))
    const compare = comparator(spec)
    const heap = new MinHeap((left, right) => compare(left.record, right.record))
    const results = []
    try {
      for (let index = 0; index < readers.length; index += 1) {
        const record = await readers[index].next()
        if (record !== undefined) heap.push({ reader: index, record })
      }
      while (heap.size > 0 && results.length < limit) {
        const candidate = heap.pop()
        const reader = readers[candidate.reader]
        const location = findSegmentLocation(collection, state, candidate.record._id)
        if (
          location?.segmentName === reader.segmentName &&
          location.revision === candidate.record._rev &&
          location.operation === "put"
        ) {
          const { _op, _rev, ...result } = candidate.record
          results.push(result)
        }
        const next = await reader.next()
        if (next !== undefined) heap.push({ reader: candidate.reader, record: next })
      }
      return results
    } finally {
      readers.forEach((reader) => reader.close())
    }
  } catch (err) {
    throw Wrap("Cannot run viewRankedIndex", err)
  }
}
