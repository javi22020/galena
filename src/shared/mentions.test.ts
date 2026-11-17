import { expect, test } from 'vitest'
import { hasMention, mentionLabel, pruneMentions, rankMentions, removeMention } from './mentions'
import type { Entry } from './types'

const file = (path: string): Entry => ({ path, type: 'file' })
const dir = (path: string): Entry => ({ path, type: 'dir' })

test('mentionLabel uses the name, or the path when the name is shared', () => {
  const entries = [file('a/Ideas.md'), file('b/Ideas.md'), file('Plan.md'), dir('Projects')]
  expect(mentionLabel('Plan.md', entries)).toBe('Plan')
  expect(mentionLabel('Projects', entries)).toBe('Projects')
  expect(mentionLabel('a/Ideas.md', entries)).toBe('a/Ideas')
})

test('hasMention matches the whole token only', () => {
  expect(hasMention('look at @My note please', 'My note')).toBe(true)
  expect(hasMention('@My note', 'My note')).toBe(true)
  expect(hasMention('see @Plan, then', 'Plan')).toBe(true)
  expect(hasMention('look at @My notebook', 'My note')).toBe(false)
  expect(hasMention('mail me@Plan', 'Plan')).toBe(false)
  expect(hasMention('look at @My no', 'My note')).toBe(false)
})

test('hasMention takes regex characters literally', () => {
  expect(hasMention('@C++ (draft) notes', 'C++ (draft)')).toBe(true)
  expect(hasMention('@Cx (draft)', 'C+ (draft)')).toBe(false)
})

test('removeMention drops the token and the space after it', () => {
  expect(removeMention('compare @Plan with @Ideas ', 'Plan')).toBe('compare with @Ideas ')
  expect(removeMention('@Plan', 'Plan')).toBe('')
  expect(removeMention('no mention here', 'Plan')).toBe('no mention here')
  expect(removeMention('@Planning and @Plan ok', 'Plan')).toBe('@Planning and ok')
})

test('pruneMentions keeps selections and mentions still in the text', () => {
  const refs = [{ path: 'Plan.md', mention: 'Plan' }, { path: 'Ideas.md', mention: 'Ideas' }, { path: 'Plan.md' }]
  expect(pruneMentions('about @Plan', refs)).toStrictEqual([refs[0], refs[2]])
  // Nothing dropped: the same array, so React sees no change.
  expect(pruneMentions('@Plan and @Ideas', refs)).toBe(refs)
})

test('rankMentions puts name prefixes first, then notes before folders', () => {
  const entries = [dir('plans'), file('archive/old plan.md'), file('Plan.md'), file('plan b/notes.md'), file('x.md')]
  expect(rankMentions(entries, 'plan').map((e) => e.path)).toStrictEqual([
    'Plan.md',
    'plans',
    'archive/old plan.md',
    'plan b/notes.md',
  ])
  expect(rankMentions(entries, '', 2).length).toBe(2)
})

test('rankMentions leaves images out', () => {
  const entries: Entry[] = [file('Plan.md'), { path: 'assets/plan.png', type: 'asset' }]
  expect(rankMentions(entries, 'plan').map((e) => e.path)).toStrictEqual(['Plan.md'])
})
