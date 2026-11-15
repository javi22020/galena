import assert from 'node:assert/strict'
import { test } from 'node:test'
import { SearchQuery } from '@codemirror/search'
import { EditorState } from '@codemirror/state'
import { countMatches, matchLabel, withQuery } from './search.ts'

const stateOf = (doc: string, anchor = 0, head = anchor) => EditorState.create({ doc, selection: { anchor, head } })

test('countMatches counts every match and finds the selected one', () => {
  const state = stateOf('a cat, a cat, a dog', 9, 12)
  assert.deepEqual(countMatches(state, new SearchQuery({ search: 'cat' })), { total: 2, more: false, current: 1 })
})

test('countMatches has no current match unless the selection covers one exactly', () => {
  const query = new SearchQuery({ search: 'cat' })
  assert.equal(countMatches(stateOf('a cat', 0), query).current, null)
  assert.equal(countMatches(stateOf('a cat', 2, 4), query).current, null)
})

test('countMatches follows the query options', () => {
  const state = stateOf('Cat cat category')
  assert.equal(countMatches(state, new SearchQuery({ search: 'cat' })).total, 3)
  assert.equal(countMatches(state, new SearchQuery({ search: 'cat', caseSensitive: true })).total, 2)
  assert.equal(countMatches(state, new SearchQuery({ search: 'cat', wholeWord: true })).total, 2)
  assert.equal(countMatches(state, new SearchQuery({ search: 'c.t', regexp: true })).total, 3)
})

test('countMatches finds nothing for an empty or broken query', () => {
  const state = stateOf('a cat')
  assert.equal(countMatches(state, new SearchQuery({ search: '' })).total, 0)
  assert.equal(countMatches(state, new SearchQuery({ search: '(', regexp: true })).total, 0)
})

test('countMatches stops at the limit', () => {
  const state = stateOf('xxxxx', 4, 5)
  assert.deepEqual(countMatches(state, new SearchQuery({ search: 'x' }), 3), { total: 3, more: true, current: null })
  assert.deepEqual(countMatches(state, new SearchQuery({ search: 'x' }), 5), { total: 5, more: false, current: 4 })
})

test('matchLabel describes the matches', () => {
  const query = new SearchQuery({ search: 'cat' })
  assert.equal(matchLabel(new SearchQuery({ search: '' }), { total: 0, more: false, current: null }), null)
  assert.deepEqual(matchLabel(new SearchQuery({ search: '(', regexp: true }), { total: 0, more: false, current: null }), {
    text: 'Invalid regex',
    error: true,
  })
  assert.deepEqual(matchLabel(query, { total: 0, more: false, current: null }), { text: 'No results', error: true })
  assert.deepEqual(matchLabel(query, { total: 4, more: false, current: 1 }), { text: '2 of 4', error: false })
  assert.deepEqual(matchLabel(query, { total: 1000, more: true, current: 0 }), { text: '1 of 1000+', error: false })
  assert.deepEqual(matchLabel(query, { total: 1, more: false, current: null }), { text: '1 result', error: false })
  assert.deepEqual(matchLabel(query, { total: 3, more: false, current: null }), { text: '3 results', error: false })
})

test('withQuery changes only what it is given', () => {
  const query = new SearchQuery({ search: 'cat', replace: 'dog', regexp: true, wholeWord: true })
  const changed = withQuery(query, { caseSensitive: true })
  assert.ok(changed.eq(new SearchQuery({ search: 'cat', replace: 'dog', regexp: true, wholeWord: true, caseSensitive: true })))
})
