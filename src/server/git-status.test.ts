import { expect, test } from 'vitest'
import { defaultMessage, excludeRules, failureText, isSafeRemote, parseStatus } from './git-status'

/** Joins records the way `git status -z` does. */
const z = (...records: string[]) => records.join('\0') + '\0'

const HASHES = '100644 100644 100644 1111111 2222222'

test('parseStatus reads the branch and how far it is from its upstream', () => {
  const status = parseStatus(
    z('# branch.oid 1234abc', '# branch.head main', '# branch.upstream origin/main', '# branch.ab +2 -3'),
  )
  expect(status).toStrictEqual({ branch: 'main', upstream: 'origin/main', ahead: 2, behind: 3, files: [] })
})

test('parseStatus knows a detached HEAD and a branch without upstream', () => {
  const status = parseStatus(z('# branch.oid 1234abc', '# branch.head (detached)'))
  expect(status.branch).toBe(null)
  expect(status.upstream).toBe(null)
})

test('parseStatus drops an upstream there is nothing to compare with', () => {
  // What git prints once the upstream branch is deleted on the remote: its name, but no counts.
  const gone = parseStatus(z('# branch.oid 1234abc', '# branch.head draft', '# branch.upstream origin/draft'))
  expect(gone.upstream).toBe(null)
  const unborn = parseStatus(z('# branch.oid (initial)', '# branch.head main', '# branch.upstream origin/main'))
  expect(unborn.upstream).toBe(null)
})

test('parseStatus tells the kinds of change apart', () => {
  const { files } = parseStatus(
    z(
      `1 .M N... ${HASHES} modified.md`,
      `1 A. N... ${HASHES} staged new.md`,
      `1 .D N... ${HASHES} deleted.md`,
      `2 R. N... ${HASHES} R100 new name.md`,
      'old name.md',
      `u UU N... 100644 100644 100644 100644 1111111 2222222 3333333 both.md`,
      '? untracked.md',
      '! ignored.md',
    ),
  )
  expect(files).toStrictEqual([
    { path: 'both.md', status: 'conflict' },
    { path: 'deleted.md', status: 'deleted' },
    { path: 'modified.md', status: 'modified' },
    { path: 'new name.md', status: 'renamed', from: 'old name.md' },
    { path: 'staged new.md', status: 'added' },
    { path: 'untracked.md', status: 'added' },
  ])
})

test('parseStatus leaves out repositories nested in the vault', () => {
  const { files } = parseStatus(z('? nested/', '? notes/new.md'))
  expect(files).toStrictEqual([{ path: 'notes/new.md', status: 'added' }])
})

test('parseStatus lists a submodule that moved to another commit', () => {
  const { files } = parseStatus(z('1 .M SC.. 160000 160000 160000 1111111 1111111 lib'))
  expect(files).toStrictEqual([{ path: 'lib', status: 'modified' }])
})

test('parseStatus takes a copy for a new file and a deleted rename for a deletion', () => {
  const { files } = parseStatus(
    z(`2 C. N... ${HASHES} C90 copy.md`, 'original.md', `2 RD N... ${HASHES} R100 moved.md`, 'was here.md'),
  )
  expect(files).toStrictEqual([
    { path: 'copy.md', status: 'added' },
    { path: 'moved.md', status: 'deleted', from: 'was here.md' },
  ])
})

test('parseStatus keeps accents and spaces in paths', () => {
  const { files } = parseStatus(z(`1 .M N... ${HASHES} teoría/Cálculo tensorial.md`))
  expect(files).toStrictEqual([{ path: 'teoría/Cálculo tensorial.md', status: 'modified' }])
})

test('parseStatus keeps only the vault of a larger repository', () => {
  const { files } = parseStatus(
    z(
      `1 .M N... ${HASHES} notes/inside.md`,
      `1 .M N... ${HASHES} src/outside.ts`,
      `2 R. N... ${HASHES} R100 notes/moved in.md`,
      'docs/was outside.md',
      '? notes-too/outside.md',
    ),
    'notes/',
  )
  expect(files).toStrictEqual([
    { path: 'inside.md', status: 'modified' },
    { path: 'moved in.md', status: 'added' },
  ])
})

test('excludeRules adds its rule once', () => {
  const original = '# git ls-files --others --exclude-from=.git/info/exclude\n*.tmp\n'
  const excluded = excludeRules(original, true)
  expect(excluded).toBe(`${original}# Galena keeps its own data out of the repository\n.galena/\n`)
  expect(excludeRules(excluded, true)).toBe(excluded)
  expect(excludeRules('', true).split('\n').length).toBe(3)
})

test('excludeRules narrows its rule to the trash and widens it back', () => {
  const excluded = excludeRules('*.tmp\n', true)
  const narrowed = excludeRules(excluded, false)
  expect(narrowed).toBe('*.tmp\n# Galena keeps its own data out of the repository\n.galena/trash/\n')
  expect(excludeRules(narrowed, false)).toBe(narrowed)
  expect(excludeRules(narrowed, true)).toBe(excluded)
})

test("excludeRules leaves the user's own rule alone", () => {
  const own = '*.tmp\n/.galena\n'
  expect(excludeRules(own, true)).toBe(own)
  expect(excludeRules(own, false)).toBe(own)
})

test('excludeRules keeps the line endings of the file', () => {
  const windows = excludeRules('*.tmp\r\n', true)
  expect(windows).toBe('*.tmp\r\n# Galena keeps its own data out of the repository\r\n.galena/\r\n')
  expect(excludeRules(windows, false).split('\r\n').length).toBe(4)
  // A last line that is not ended gets its line break before anything follows it.
  expect(excludeRules('*.tmp', true).split('\n')[1]).toBe('# Galena keeps its own data out of the repository')
})

test('isSafeRemote refuses options and command helpers', () => {
  expect(isSafeRemote('https://github.com/user/notes.git')).toBe(true)
  expect(isSafeRemote('git@github.com:user/notes.git')).toBe(true)
  expect(isSafeRemote('../notes.git')).toBe(true)
  expect(isSafeRemote('ssh://[::1]/notes.git')).toBe(true)
  expect(isSafeRemote('git@[2001:db8::1]:notes.git')).toBe(true)
  expect(isSafeRemote('--upload-pack=touch /tmp/x')).toBe(false)
  expect(isSafeRemote('ext::sh -c "touch /tmp/x"')).toBe(false)
  expect(isSafeRemote('')).toBe(false)
})

test('defaultMessage names a single note and counts several', () => {
  expect(defaultMessage([{ path: 'teoria/Transformers.md', status: 'added' }])).toBe('Add Transformers')
  expect(defaultMessage([{ path: 'a.md', status: 'deleted' }])).toBe('Delete a')
  expect(
    defaultMessage([
      { path: 'a.md', status: 'modified' },
      { path: 'b.md', status: 'added' },
    ]),
  ).toBe('Update 2 notes')
  expect(
    defaultMessage([
      { path: 'a.md', status: 'modified' },
      { path: 'img.png', status: 'added' },
    ]),
  ).toBe('Update 2 files')
})

test('failureText keeps what Git said, without hints or the leading label', () => {
  const stderr = 'fatal: unable to access the remote\nhint: check your connection\n'
  expect(failureText('push', stderr)).toBe('unable to access the remote')
  expect(failureText('push', '', '')).toBe('git push failed')
  expect(failureText('pull', '', 'CONFLICT in a.md\n')).toBe('CONFLICT in a.md')
  expect(failureText('push', 'x'.repeat(1000)).length).toBeLessThan(420)
})
