import { SearchQuery } from '@codemirror/search'
import { EditorState } from '@codemirror/state'
import { expect, test } from 'vitest'
import { countMatches, matchLabel, withQuery } from './search'

const stateOf = (doc: string, anchor = 0, head = anchor) => EditorState.create({ doc, selection: { anchor, head } })

test('countMatches counts every match and finds the selected one', () => {
  const state = stateOf('a cat, a cat, a dog', 9, 12)
  expect(countMatches(state, new SearchQuery({ search: 'cat' }))).toStrictEqual({ total: 2, more: false, current: 1 })
})

test('countMatches has no current match unless the selection covers one exactly', () => {
  const query = new SearchQuery({ search: 'cat' })
  expect(countMatches(stateOf('a cat', 0), query).current).toBe(null)
  expect(countMatches(stateOf('a cat', 2, 4), query).current).toBe(null)
})

test('countMatches follows the query options', () => {
  const state = stateOf('Cat cat category')
  expect(countMatches(state, new SearchQuery({ search: 'cat' })).total).toBe(3)
  expect(countMatches(state, new SearchQuery({ search: 'cat', caseSensitive: true })).total).toBe(2)
  expect(countMatches(state, new SearchQuery({ search: 'cat', wholeWord: true })).total).toBe(2)
  expect(countMatches(state, new SearchQuery({ search: 'c.t', regexp: true })).total).toBe(3)
})

test('countMatches finds nothing for an empty or broken query', () => {
  const state = stateOf('a cat')
  expect(countMatches(state, new SearchQuery({ search: '' })).total).toBe(0)
  expect(countMatches(state, new SearchQuery({ search: '(', regexp: true })).total).toBe(0)
})

test('countMatches stops at the limit', () => {
  const state = stateOf('xxxxx', 4, 5)
  expect(countMatches(state, new SearchQuery({ search: 'x' }), 3)).toStrictEqual({ total: 3, more: true, current: null })
  expect(countMatches(state, new SearchQuery({ search: 'x' }), 5)).toStrictEqual({ total: 5, more: false, current: 4 })
})

test('matchLabel describes the matches', () => {
  const query = new SearchQuery({ search: 'cat' })
  expect(matchLabel(new SearchQuery({ search: '' }), { total: 0, more: false, current: null })).toBe(null)
  expect(matchLabel(new SearchQuery({ search: '(', regexp: true }), { total: 0, more: false, current: null })).toStrictEqual({
    text: 'Invalid regex',
    error: true,
  })
  expect(matchLabel(query, { total: 0, more: false, current: null })).toStrictEqual({ text: 'No results', error: true })
  expect(matchLabel(query, { total: 4, more: false, current: 1 })).toStrictEqual({ text: '2 of 4', error: false })
  expect(matchLabel(query, { total: 1000, more: true, current: 0 })).toStrictEqual({ text: '1 of 1000+', error: false })
  expect(matchLabel(query, { total: 1, more: false, current: null })).toStrictEqual({ text: '1 result', error: false })
  expect(matchLabel(query, { total: 3, more: false, current: null })).toStrictEqual({ text: '3 results', error: false })
})

test('withQuery changes only what it is given', () => {
  const query = new SearchQuery({ search: 'cat', replace: 'dog', regexp: true, wholeWord: true })
  const changed = withQuery(query, { caseSensitive: true })
  const wanted = new SearchQuery({ search: 'cat', replace: 'dog', regexp: true, wholeWord: true, caseSensitive: true })
  expect(changed.eq(wanted)).toBe(true)
})
