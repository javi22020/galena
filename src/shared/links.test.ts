import { expect, test } from 'vitest'
import { linkTarget, parentOf, resolveLink } from './links'

test('linkTarget keeps only the note, without heading or alias', () => {
  expect(linkTarget('folder/Note#Heading|alias')).toBe('folder/Note')
  expect(linkTarget('Note|alias#not a heading')).toBe('Note')
  expect(linkTarget(' Note ')).toBe('Note')
})

test('linkTarget reads the escaped pipe of a link inside a table', () => {
  expect(linkTarget('Note\\|alias')).toBe('Note')
  expect(linkTarget('folder/Note#Heading\\|alias')).toBe('folder/Note')
})

test('resolveLink takes the exact path over any other note of that name', () => {
  // The nested one comes first and is a match too: only being exact beats it.
  expect(resolveLink('a/Note', ['x/a/Note.md', 'a/Note.md'])).toBe('a/Note.md')
  expect(resolveLink('Note', ['a/Note.md', 'Note.md'])).toBe('Note.md')
})

test('resolveLink takes the shortest path among notes of the same name', () => {
  expect(resolveLink('Note', ['deep/folder/Note.md', 'a/Note.md', 'another/Note.md'])).toBe('a/Note.md')
  expect(resolveLink('folder/Note', ['x/y/folder/Note.md', 'x/folder/Note.md'])).toBe('x/folder/Note.md')
})

test('resolveLink ignores case and a written extension', () => {
  expect(resolveLink('my NOTE', ['a/My note.md'])).toBe('a/My note.md')
  expect(resolveLink('Note.md', ['a/Note.md'])).toBe('a/Note.md')
})

test('resolveLink matches whole names only', () => {
  expect(resolveLink('Note', ['a/My Note.md', 'Notebook.md', 'Note/Other.md'])).toBe(undefined)
  expect(resolveLink('missing', [])).toBe(undefined)
})

test('parentOf is empty at the top of the vault', () => {
  expect(parentOf('a/b/Note.md')).toBe('a/b')
  expect(parentOf('Note.md')).toBe('')
})
