import { setTimeout as delay } from 'timers/promises'

const [mode, root, key, value] = process.argv.slice(2)
process.env.FS = root

if (mode === "set") {
  const { setKV } = await import('../../lib/keyValueStore.js')
  await setKV(key, JSON.parse(value))
  process.stdout.write("done\n")
}

if (mode === "lock") {
  const { createKVLockManager } = await import('../../lib/kvLockManager.js')
  const locks = createKVLockManager({ rootPath: root, leaseMs: 100 })
  const release = await locks.acquire([key], { timeoutMs: 2_000 })
  process.stdout.write("acquired\n")
  await delay(Number(value))
  release()
  process.stdout.write("released\n")
}
