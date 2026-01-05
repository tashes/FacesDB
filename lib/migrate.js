import { checkCollection, checkFn, isDefined } from "../utils/checks.js"
import { Wrap } from "../utils/errors.js"
import { listCollectionDocuments } from "./listCollectionDocuments.js"
import { viewDocument } from "./viewDocument.js"
import { listCollectionIndexes } from "./listCollectionIndexes.js"
import { viewIndexConfig } from "./viewIndexConfig.js"
import { deepcopy } from "../utils/deepcopy.js"
import {
  createFolder,
  rm,
  path as fsPath,
  appendjsonl,
} from "../utils/fs.js"
import { existsSync, renameSync, writeFileSync } from "fs"
import { join } from "path"
import os from "os"

const TMP_NEW_DIR = "new"
const TMP_BACKUP_DIR = "backup"

function objectsEqual(a, b) {
  if (a === b) return true
  if (typeof a !== typeof b) return false
  if (a && b && typeof a === "object") {
    if (Array.isArray(a) !== Array.isArray(b)) return false
    const aKeys = Object.keys(a)
    const bKeys = Object.keys(b)
    if (aKeys.length !== bKeys.length) return false
    for (const key of aKeys) {
      if (!objectsEqual(a[key], b[key])) return false
    }
    return true
  }
  return false
}

function getConcurrencyLimit() {
  const cpus = os.cpus?.().length || 1
  return Math.min(Math.max(cpus, 2), 32)
}

async function runWithLimit(items, limit, handler) {
  let index = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const currentIndex = index++
      if (currentIndex >= items.length) break
      await handler(items[currentIndex])
    }
  })
  await Promise.all(workers)
}

async function rebuildIndexes(collection) {
  const indexNames = await listCollectionIndexes(collection)
  for (const name of indexNames) {
    try {
      rm(collection, `${name}.jsonl`)
    } catch (_) {}
  }

  const docIds = await listCollectionDocuments(collection)
  for (const id of docIds) {
    const doc = await viewDocument(collection, id)
    for (const indexName of indexNames) {
      const config = await viewIndexConfig(indexName, collection)
      const keys = Object.keys(config)
      const shouldGo = keys.every((key) =>
        config[key] ? isDefined(doc[key]) === true : true,
      )
      if (shouldGo) {
        const indexObj = Object.fromEntries([
          ["_id", id],
          ...keys.map((key) => [key, doc[key]]),
        ])
        appendjsonl(indexObj, collection, `${indexName}.jsonl`)
      }
    }
  }
}

export async function migrate(collection, fn) {
  const colErr = checkCollection(collection)
  if (colErr instanceof Error) throw Wrap("Invalid collection", colErr)
  const fnErr = checkFn(fn)
  if (fnErr instanceof Error) throw Wrap("Invalid callback", fnErr)

  const ids = await listCollectionDocuments(collection)
  if (ids.length === 0) return { migrated: 0, changed: 0 }

  const useParallel = ids.length > 1000
  const concurrency = useParallel ? getConcurrencyLimit() : 1

  let tmpFolderParts = null
  let tmpPaths = null
  const changedIds = []
  const backedUpIds = []

  const ensureTmp = () => {
    if (!tmpFolderParts) {
      tmpFolderParts = [collection, `.tmp-migrate-${Date.now()}`]
      createFolder(...tmpFolderParts)
      createFolder(...tmpFolderParts, TMP_NEW_DIR)
      createFolder(...tmpFolderParts, TMP_BACKUP_DIR)
      tmpPaths = {
        root: fsPath(...tmpFolderParts),
        newDir: fsPath(...tmpFolderParts, TMP_NEW_DIR),
        backupDir: fsPath(...tmpFolderParts, TMP_BACKUP_DIR),
      }
    }
    return tmpPaths
  }

  const cleanupTmp = () => {
    if (tmpFolderParts) {
      try {
        rm(...tmpFolderParts)
      } catch (_) {}
      tmpFolderParts = null
      tmpPaths = null
      backedUpIds.length = 0
    }
  }

  const restoreBackups = () => {
    if (!tmpPaths || backedUpIds.length === 0) return
    for (let i = backedUpIds.length - 1; i >= 0; i--) {
      const id = backedUpIds[i]
      const backupPath = join(tmpPaths.backupDir, `${id}.json`)
      if (!existsSync(backupPath)) continue
      const destinationPath = fsPath(collection, `${id}.json`)
      try {
        renameSync(backupPath, destinationPath)
      } catch (_) {}
    }
  }

  const processOne = async (id) => {
    const original = await viewDocument(collection, id)
    const transformed = await fn(deepcopy(original))

    if (
      typeof transformed !== "object" ||
      transformed === null ||
      !Object.prototype.hasOwnProperty.call(transformed, "_id")
    ) {
      throw new Error("Callback must return an object containing an `_id`")
    }
    if (transformed._id !== original._id) {
      throw new Error(
        `Transformed document _id (${transformed._id}) does not match original (${original._id})`,
      )
    }

    if (!objectsEqual(original, transformed)) {
      const { newDir } = ensureTmp()
      const targetPath = join(newDir, `${id}.json`)
      writeFileSync(targetPath, JSON.stringify(transformed))
      changedIds.push(id)
    }
  }

  try {
    if (useParallel) {
      await runWithLimit(ids, concurrency, processOne)
    } else {
      for (const id of ids) {
        await processOne(id)
      }
    }

    if (!tmpPaths || changedIds.length === 0) {
      cleanupTmp()
      return { migrated: ids.length, changed: 0 }
    }

    try {
      for (const id of changedIds) {
        const originalPath = fsPath(collection, `${id}.json`)
        const backupPath = join(tmpPaths.backupDir, `${id}.json`)
        const newPath = join(tmpPaths.newDir, `${id}.json`)
        renameSync(originalPath, backupPath)
        backedUpIds.push(id)
        renameSync(newPath, originalPath)
      }
    } catch (commitErr) {
      restoreBackups()
      throw commitErr
    }

    try {
      await rebuildIndexes(collection)
    } catch (indexErr) {
      restoreBackups()
      throw indexErr
    }

    cleanupTmp()
    return { migrated: ids.length, changed: changedIds.length }
  } catch (error) {
    restoreBackups()
    cleanupTmp()
    throw Wrap("Migration failed – all changes rolled back", error)
  }
}
