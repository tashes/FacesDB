import {
  observeResourceLocks,
  scheduleResourceAccess,
  validateLockOptions,
} from './resourceLockScheduler.js'

export const validateKVMutationOptions = validateLockOptions
export const observeKVLocks = observeResourceLocks

export async function scheduleKVMutation(keys, options, task, context = {}) {
  try {
    return await scheduleResourceAccess(
      keys.map((key) => ({ resource: `kv:${key}`, mode: "exclusive" })),
      options,
      task,
      {
        ...context,
        resourceCount: context.keyCount ?? new Set(keys).size,
      },
    )
  } catch (err) {
    if (err.code === "RESOURCE_LOCK_TIMEOUT") err.code = "KV_LOCK_TIMEOUT"
    throw err
  }
}
