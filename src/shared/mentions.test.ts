import assert from 'node:assert/strict'
import { test } from 'node:test'
import { hasMention, mentionLabel, pruneMentions, rankMentions, removeMention } from './mentions.ts'
import type { Entry } from './types'

const file = (path: string): Entry => ({ path, type: 'file' })
const dir = (path: string): Entry => ({ path, type: 'dir' })

test('mentionLabel uses the name, or the path when the name is shared', () => {
  const entries = [file('a/Ideas.md'), file('b/Ideas.md'), file('Plan.md'), dir('Projects')]
  assert.equal(mentionLabel('Plan.md', entries), 'Plan')
  assert.equal(mentionLabel('Projects', entries), 'Projects')
  assert.equal(mentionLabel('a/Ideas.md', entries), 'a/Ideas')
})

test('hasMention matches the whole token only', () => {
  assert.ok(hasMention('look at @My note please', 'My note'))
  assert.ok(hasMention('@My note', 'My note'))
  assert.ok(hasMention('see @Plan, then', 'Plan'))
  assert.ok(!hasMention('look at @My notebook', 'My note'))
  assert.ok(!hasMention('mail me@Plan', 'Plan'))
  assert.ok(!hasMention('look at @My no', 'My note'))
})

test('hasMention takes regex characters literally', () => {
  assert.ok(hasMention('@C++ (draft) notes', 'C++ (draft)'))
  assert.ok(!hasMention('@Cx (draft)', 'C+ (draft)'))
})

test('removeMention drops the token and the space after it', () => {
  assert.equal(removeMention('compare @Plan with @Ideas ', 'Plan'), 'compare with @Ideas ')
  assert.equal(removeMention('@Plan', 'Plan'), '')
  assert.equal(removeMention('no mention here', 'Plan'), 'no mention here')
  assert.equal(removeMention('@Planning and @Plan ok', 'Plan'), '@Planning and ok')
})

test('pruneMentions keeps selections and mentions still in the text', () => {
  const refs = [{ path: 'Plan.md', mention: 'Plan' }, { path: 'Ideas.md', mention: 'Ideas' }, { path: 'Plan.md' }]
  assert.deepEqual(pruneMentions('about @Plan', refs), [refs[0], refs[2]])
  // Nothing dropped: the same array, so React sees no change.
  assert.equal(pruneMentions('@Plan and @Ideas', refs), refs)
})

test('rankMentions puts name prefixes first, then notes before folders', () => {
  const entries = [dir('plans'), file('archive/old plan.md'), file('Plan.md'), file('plan b/notes.md'), file('x.md')]
  assert.deepEqual(
    rankMentions(entries, 'plan').map((e) => e.path),
    ['Plan.md', 'plans', 'archive/old plan.md', 'plan b/notes.md'],
  )
  assert.equal(rankMentions(entries, '', 2).length, 2)
})
