const [mode, root, key, value] = process.argv.slice(2)
process.env.FS = root

if (mode === "set") {
  const { setKV } = await import('../../lib/keyValueStore.js')
  await setKV(key, JSON.parse(value))
  process.stdout.write("done\n")
}

if (mode === "increment") {
  const { updateKV } = await import('../../lib/keyValueStore.js')
  const count = Number.parseInt(value, 10)
  for (let index = 0; index < count; index += 1) {
    await updateKV(key, (current = 0) => current + 1)
  }
  process.stdout.write("done\n")
}
