import { Worker, isMainThread } from 'worker_threads'
import { existsSync } from 'fs'
import { fileURLToPath } from 'url'

import { path } from '../utils/fs.js'
import { INDEX_MAINTENANCE_DEFAULTS, runMaintenanceAtRoot } from './indexCompaction.js'

let worker
let workerConfig = { ...INDEX_MAINTENANCE_DEFAULTS }

function validateOptions(options) {
  if (options === null || typeof options !== "object" || Array.isArray(options)) {
    throw new Error("Maintenance options must be an object")
  }
  if (
    options.intervalMs !== undefined &&
    (Number.isFinite(options.intervalMs) === false || options.intervalMs <= 0)
  ) throw new Error("intervalMs must be a positive finite number")
  if (
    options.updateLimitBytes !== undefined &&
    (Number.isFinite(options.updateLimitBytes) === false || options.updateLimitBytes < 0)
  ) throw new Error("updateLimitBytes must be a non-negative finite number")
  if (
    options.staleRatio !== undefined &&
    (Number.isFinite(options.staleRatio) === false || options.staleRatio < 0 || options.staleRatio > 1)
  ) throw new Error("staleRatio must be between 0 and 1")
  if (
    options.minimumUpdateRecords !== undefined &&
    (Number.isSafeInteger(options.minimumUpdateRecords) === false || options.minimumUpdateRecords < 0)
  ) throw new Error("minimumUpdateRecords must be a non-negative safe integer")
}

function maintenanceWorkerUrl() {
  const built = new URL(/* @vite-ignore */ './maintenance-worker.es.js', import.meta.url)
  if (existsSync(fileURLToPath(built))) return built
  return new URL('./maintenanceWorker.js', import.meta.url)
}

export function configureMaintenance(options = {}) {
  validateOptions(options)
  workerConfig = { ...workerConfig, ...options }
  if (worker !== undefined) worker.postMessage({ type: "configure", options: workerConfig })
}

export function ensureMaintenanceWorker() {
  if (
    worker !== undefined ||
    isMainThread === false ||
    process.env.FACESDB_MAINTENANCE === "off" ||
    (process.env.NODE_ENV === "test" && process.env.FACESDB_MAINTENANCE !== "on")
  ) return worker
  worker = new Worker(maintenanceWorkerUrl(), {
    type: "module",
    workerData: { root: path(), options: workerConfig },
  })
  worker.unref()
  worker.on("error", () => { worker = undefined })
  worker.on("exit", () => { worker = undefined })
  return worker
}

export function notifyMaintenance() {
  ensureMaintenanceWorker()?.postMessage({ type: "wake" })
}

export async function runMaintenance(options = {}) {
  validateOptions(options)
  return await runMaintenanceAtRoot(path(), { ...workerConfig, ...options })
}

export async function stopMaintenance() {
  if (worker === undefined) return
  const current = worker
  worker = undefined
  await current.terminate()
}
