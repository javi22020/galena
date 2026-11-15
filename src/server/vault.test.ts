import { tmpdir } from 'node:os'
import path from 'node:path'
import { expect, test } from 'vitest'
import { Vault } from './vault'

// Any folder that exists will do: these tests only work out paths, and read or write nothing.
const vault = await Vault.open(tmpdir())
const { root } = vault

const refused = (status: number, message: string) =>
  expect.objectContaining({ status, message: expect.stringContaining(message) })

test('a path inside the vault resolves to a file under its folder', () => {
  expect(vault.resolve('notes/a.md')).toBe(path.join(root, 'notes', 'a.md'))
  expect(vault.resolve('notes/../a.md')).toBe(path.join(root, 'a.md'))
})

test('a path that leaves the vault is refused', () => {
  const outside = refused(403, 'Outside the vault')
  expect(() => vault.resolve('../a.md')).toThrow(outside)
  expect(() => vault.resolve('notes/../../a.md')).toThrow(outside)
  expect(() => vault.resolve(path.resolve(root, '..', 'elsewhere', 'a.md'))).toThrow(outside)
})

test('a folder next to the vault whose name starts like it is outside too', () => {
  expect(() => vault.relative(`${root}-backup${path.sep}a.md`)).toThrow(refused(403, 'Outside the vault'))
})

test('hidden files and folders are refused at any depth', () => {
  const hidden = refused(403, 'Hidden path')
  expect(() => vault.resolve('.git/config')).toThrow(hidden)
  expect(() => vault.resolve('.galena/sessions/1.json')).toThrow(hidden)
  expect(() => vault.resolve('notes/.obsidian/app.json')).toThrow(hidden)
  expect(() => vault.resolve('notes/.secret.md')).toThrow(hidden)
  // Not hidden: the dot is not what the name starts with.
  expect(vault.resolve('notes/v1.2.md')).toBe(path.join(root, 'notes', 'v1.2.md'))
})

test('the path of a file is given from the vault, with forward slashes', () => {
  expect(vault.relative(path.join(root, 'notes', 'deep', 'a.md'))).toBe('notes/deep/a.md')
})

test('only a folder that exists can be opened as a vault', async () => {
  const missing = path.join(root, 'galena-test-no-such-folder')
  await expect(Vault.open(missing)).rejects.toThrow(refused(400, 'Not a folder'))
})
