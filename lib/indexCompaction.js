import { mkdirSync, renameSync, rmSync } from 'fs'
import { randomUUID } from 'crypto'
import { join } from 'path'

import { checkCollection, checkIndex } from '../utils/checks.js'
import { Wrap } from '../utils/errors.js'
import { openjsonlwriter, path } from '../utils/fs.js'
import { buildIndexSidecars, indexBaseRowCount } from './indexSidecar.js'
import {
  hasIndexUpdates,
  indexUpdateStats,
  invalidateIndexOverlay,
  iterateLogicalIndex,
  removeIndexUpdates,
  rotateIndexUpdates,
} from './indexUpdates.js'
import { listCollectionIndexes } from './listCollectionIndexes.js'
import {
  collectionResource,
  indexResource,
  withResources,
} from './resourceLocks.js'
import { scheduleResourceAccess } from './resourceLockScheduler.js'

export const INDEX_MAINTENANCE_DEFAULTS = {
  intervalMs: 30_000,
  updateLimitBytes: 64 * 1024 * 1024,
  staleRatio: 0.10,
  minimumUpdateRecords: 1_000,
}

async function compactIndexRaw(index, collection) {
  return await withResources([{
    resource: `index-maintenance:${collection}:${index}`,
    mode: "exclusive",
  }], "compactIndexMaintenance", async () => {
    const rotated = await withResources([
      collectionResource(collection),
      indexResource(collection, index, "exclusive"),
    ], "compactIndexRotate", () => rotateIndexUpdates(index, collection));
    if (rotated === undefined && hasIndexUpdates(index, collection) === false) return false;

    const temporaryName = `.${index}.compact-${process.pid}-${randomUUID()}`;
    const temporaryCollection = `${collection}/${temporaryName}`;
    mkdirSync(path(temporaryCollection));
    let writer;
    try {
      writer = openjsonlwriter(temporaryCollection, `${index}.jsonl`);
      for await (const entry of iterateLogicalIndex(index, collection, { includeActive: false })) {
        writer.write(entry);
      }
      writer.commit();
      writer = undefined;
      await buildIndexSidecars(index, temporaryCollection);

      await withResources([
        collectionResource(collection),
        indexResource(collection, index, "exclusive"),
      ], "compactIndexPublish", () => {
        for (const suffix of ["jsonl", "offsets", "lookup", "lookup.delta"]) {
          renameSync(
            path(temporaryCollection, `${index}.${suffix}`),
            path(collection, `${index}.${suffix}`),
          );
        }
        removeIndexUpdates(index, collection, { rotatedOnly: true });
        invalidateIndexOverlay(index, collection);
      });
      return true;
    } finally {
      writer?.abort();
      rmSync(path(temporaryCollection), { recursive: true, force: true });
    }
  });
}

export async function compactIndex(index, collection) {
  const indexError = checkIndex(index);
  if (indexError instanceof Error) throw Wrap("Cannot start compactIndex", indexError);
  const collectionError = checkCollection(collection);
  if (collectionError instanceof Error) throw Wrap("Cannot start compactIndex", collectionError);
  try {
    return await compactIndexRaw(index, collection);
  } catch (err) {
    throw Wrap("Cannot run compactIndex", err);
  }
}

export async function runMaintenanceAtRoot(root, options = {}) {
  const limits = {
    updateLimitBytes: options.updateLimitBytes ?? INDEX_MAINTENANCE_DEFAULTS.updateLimitBytes,
    staleRatio: options.staleRatio ?? INDEX_MAINTENANCE_DEFAULTS.staleRatio,
    minimumUpdateRecords: options.minimumUpdateRecords ??
      INDEX_MAINTENANCE_DEFAULTS.minimumUpdateRecords,
  };
  try {
    return await scheduleResourceAccess([{
      resource: "maintenance:indexes",
      mode: "exclusive",
    }], { timeoutMs: 0, priority: "background" }, async () => {
      const { readdirSync, statSync } = await import('fs');
      const collections = readdirSync(root).filter((name) => {
        if (name.startsWith(".")) return false;
        try { return statSync(join(root, name)).isDirectory(); } catch (_) { return false; }
      });
      const compacted = [];
      for (const collection of collections) {
        for (const index of await listCollectionIndexes(collection)) {
          const stats = indexUpdateStats(index, collection);
          if (stats.records === 0) continue;
          const baseRows = await indexBaseRowCount(index, collection);
          if (
            options.force === true ||
            stats.bytes >= limits.updateLimitBytes ||
            stats.records >= Math.max(
              limits.minimumUpdateRecords,
              Math.ceil(baseRows * limits.staleRatio),
            )
          ) {
            if (await compactIndexRaw(index, collection)) compacted.push({ collection, index });
          }
        }
      }
      return compacted;
    }, { root, operation: "runMaintenance" });
  } catch (err) {
    if (err.code === "RESOURCE_LOCK_TIMEOUT") return [];
    throw err;
  }
}
