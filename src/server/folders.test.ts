import { tmpdir } from 'node:os'
import path from 'node:path'
import { expect, test } from 'vitest'
import { createFolder } from './folders'

test('a new vault must be a single folder name, not a path', async () => {
  // A parent that does not exist, two levels down: whatever happens to the name, nothing can be made.
  const parent = path.join(tmpdir(), 'galena-test-no-such-folder', 'a', 'b')
  // Each of these would otherwise be made somewhere else than inside the parent, or fail further on.
  for (const name of ['', '   ', '.', '..', 'a/b', 'a\\b']) {
    await expect(createFolder(parent, name), JSON.stringify(name)).rejects.toThrow(
      expect.objectContaining({ status: 400, message: expect.stringContaining('Not a valid folder name') }),
    )
  }
})
