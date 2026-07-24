import {
  closeSync,
  fsyncSync,
  openSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'fs'
import { dirname, join } from 'path'
import { randomUUID } from 'crypto'

import { path } from '../utils/fs.js'

export function persistKeyValueStore(store, fileName) {
  const destination = path(fileName)
  const directory = dirname(destination)
  const temporary = join(directory, `.${fileName}.${randomUUID()}.tmp`)
  let fileDescriptor

  try {
    fileDescriptor = openSync(temporary, "wx", 0o600)
    writeFileSync(fileDescriptor, JSON.stringify(Object.fromEntries(store)))
    fsyncSync(fileDescriptor)
    closeSync(fileDescriptor)
    fileDescriptor = undefined
    renameSync(temporary, destination)

    const directoryDescriptor = openSync(directory, "r")
    try {
      fsyncSync(directoryDescriptor)
    } finally {
      closeSync(directoryDescriptor)
    }
  } catch (err) {
    if (fileDescriptor !== undefined) closeSync(fileDescriptor)
    rmSync(temporary, { force: true })
    throw err
  }
}
