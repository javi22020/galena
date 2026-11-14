import assert from 'node:assert/strict'
import { test } from 'node:test'
import { defaultMessage, excludeRules, failureText, isSafeRemote, parseStatus } from './git-status.ts'

/** Joins records the way `git status -z` does. */
const z = (...records: string[]) => records.join('\0') + '\0'

const HASHES = '100644 100644 100644 1111111 2222222'

test('parseStatus reads the branch and how far it is from its upstream', () => {
  const status = parseStatus(
    z('# branch.oid 1234abc', '# branch.head main', '# branch.upstream origin/main', '# branch.ab +2 -3'),
  )
  assert.deepEqual(status, { branch: 'main', upstream: 'origin/main', ahead: 2, behind: 3, files: [] })
})

test('parseStatus knows a detached HEAD and a branch without upstream', () => {
  const status = parseStatus(z('# branch.oid 1234abc', '# branch.head (detached)'))
  assert.equal(status.branch, null)
  assert.equal(status.upstream, null)
})

test('parseStatus drops an upstream there is nothing to compare with', () => {
  // What git prints once the upstream branch is deleted on the remote: its name, but no counts.
  const gone = parseStatus(z('# branch.oid 1234abc', '# branch.head draft', '# branch.upstream origin/draft'))
  assert.equal(gone.upstream, null)
  const unborn = parseStatus(z('# branch.oid (initial)', '# branch.head main', '# branch.upstream origin/main'))
  assert.equal(unborn.upstream, null)
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
  assert.deepEqual(files, [
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
  assert.deepEqual(files, [{ path: 'notes/new.md', status: 'added' }])
})

test('parseStatus lists a submodule that moved to another commit', () => {
  const { files } = parseStatus(z('1 .M SC.. 160000 160000 160000 1111111 1111111 lib'))
  assert.deepEqual(files, [{ path: 'lib', status: 'modified' }])
})

test('parseStatus takes a copy for a new file and a deleted rename for a deletion', () => {
  const { files } = parseStatus(
    z(`2 C. N... ${HASHES} C90 copy.md`, 'original.md', `2 RD N... ${HASHES} R100 moved.md`, 'was here.md'),
  )
  assert.deepEqual(files, [
    { path: 'copy.md', status: 'added' },
    { path: 'moved.md', status: 'deleted', from: 'was here.md' },
  ])
})

test('parseStatus keeps accents and spaces in paths', () => {
  const { files } = parseStatus(z(`1 .M N... ${HASHES} teoría/Cálculo tensorial.md`))
  assert.deepEqual(files, [{ path: 'teoría/Cálculo tensorial.md', status: 'modified' }])
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
  assert.deepEqual(files, [
    { path: 'inside.md', status: 'modified' },
    { path: 'moved in.md', status: 'added' },
  ])
})

test('excludeRules adds its rule once', () => {
  const original = '# git ls-files --others --exclude-from=.git/info/exclude\n*.tmp\n'
  const excluded = excludeRules(original, true)
  assert.equal(excluded, `${original}# Galena keeps its own data out of the repository\n.galena/\n`)
  assert.equal(excludeRules(excluded, true), excluded)
  assert.equal(excludeRules('', true).split('\n').length, 3)
})

test('excludeRules narrows its rule to the trash and widens it back', () => {
  const excluded = excludeRules('*.tmp\n', true)
  const narrowed = excludeRules(excluded, false)
  assert.equal(narrowed, '*.tmp\n# Galena keeps its own data out of the repository\n.galena/trash/\n')
  assert.equal(excludeRules(narrowed, false), narrowed)
  assert.equal(excludeRules(narrowed, true), excluded)
})

test("excludeRules leaves the user's own rule alone", () => {
  const own = '*.tmp\n/.galena\n'
  assert.equal(excludeRules(own, true), own)
  assert.equal(excludeRules(own, false), own)
})

test('excludeRules keeps the line endings of the file', () => {
  const windows = excludeRules('*.tmp\r\n', true)
  assert.equal(windows, '*.tmp\r\n# Galena keeps its own data out of the repository\r\n.galena/\r\n')
  assert.equal(excludeRules(windows, false).split('\r\n').length, 4)
  // A last line that is not ended gets its line break before anything follows it.
  assert.equal(excludeRules('*.tmp', true).split('\n')[1], '# Galena keeps its own data out of the repository')
})

test('isSafeRemote refuses options and command helpers', () => {
  assert.ok(isSafeRemote('https://github.com/user/notes.git'))
  assert.ok(isSafeRemote('git@github.com:user/notes.git'))
  assert.ok(isSafeRemote('../notes.git'))
  assert.ok(isSafeRemote('ssh://[::1]/notes.git'))
  assert.ok(isSafeRemote('git@[2001:db8::1]:notes.git'))
  assert.ok(!isSafeRemote('--upload-pack=touch /tmp/x'))
  assert.ok(!isSafeRemote('ext::sh -c "touch /tmp/x"'))
  assert.ok(!isSafeRemote(''))
})

test('defaultMessage names a single note and counts several', () => {
  assert.equal(defaultMessage([{ path: 'teoria/Transformers.md', status: 'added' }]), 'Add Transformers')
  assert.equal(defaultMessage([{ path: 'a.md', status: 'deleted' }]), 'Delete a')
  assert.equal(
    defaultMessage([
      { path: 'a.md', status: 'modified' },
      { path: 'b.md', status: 'added' },
    ]),
    'Update 2 notes',
  )
  assert.equal(
    defaultMessage([
      { path: 'a.md', status: 'modified' },
      { path: 'img.png', status: 'added' },
    ]),
    'Update 2 files',
  )
})

test('failureText keeps what Git said, without hints or the leading label', () => {
  const stderr = 'fatal: unable to access the remote\nhint: check your connection\n'
  assert.equal(failureText('push', stderr), 'unable to access the remote')
  assert.equal(failureText('push', '', ''), 'git push failed')
  assert.equal(failureText('pull', '', 'CONFLICT in a.md\n'), 'CONFLICT in a.md')
  assert.ok(failureText('push', 'x'.repeat(1000)).length < 420)
})
