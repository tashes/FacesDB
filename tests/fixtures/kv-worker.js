const [mode, root, key, value] = process.argv.slice(2)
process.env.FS = root

if (mode === "set") {
  const { setKV } = await import('../../lib/keyValueStore.js')
  await setKV(key, JSON.parse(value))
  process.stdout.write("done\n")
}
