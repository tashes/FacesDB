import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'fs'
import os from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'

import { rmConcurrent } from '../../utils/fs.js'

const originalRoot = process.env.FS
let root

beforeEach(() => {
  root = mkdtempSync(join(os.tmpdir(), 'facesdb-fs-'))
  process.env.FS = root
})

afterEach(() => {
  if (originalRoot === undefined) delete process.env.FS
  else process.env.FS = originalRoot
  rmSync(root, { recursive: true, force: true })
})

describe('rmConcurrent', () => {
  test('removes large nested trees without following symbolic links', async () => {
    const collection = join(root, 'people')
    const nested = join(collection, 'bucket', 'nested')
    const outside = join(root, 'outside.json')
    mkdirSync(nested, { recursive: true })
    writeFileSync(outside, 'keep')
    symlinkSync(outside, join(collection, 'linked.json'))
    for (let index = 0; index < 1_000; index += 1) {
      writeFileSync(join(nested, `${index}.json`), '{}')
    }

    await rmConcurrent('people')

    expect(existsSync(collection)).toBe(false)
    expect(existsSync(outside)).toBe(true)
  })
})
