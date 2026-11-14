// What the find-and-replace panel shows about a query: how many matches it
// has, and which of them is selected. CodeMirror's search extension does the
// searching itself; see components/SearchPanel.tsx.

import { SearchQuery } from '@codemirror/search'
import type { EditorState } from '@codemirror/state'

/** Counting stops here, so that a query matching nearly everything stays cheap. */
export const MAX_COUNTED = 1000

export interface Matches {
  /** How many there are, up to the limit. */
  total: number
  /** Whether there are more than `total`. */
  more: boolean
  /** The index of the match the main selection covers exactly, if any. */
  current: number | null
}

const none: Matches = { total: 0, more: false, current: null }

export function countMatches(state: EditorState, query: SearchQuery, limit = MAX_COUNTED): Matches {
  if (!query.valid) return none
  const { from, to } = state.selection.main
  const cursor = query.getCursor(state)
  let total = 0
  let current: number | null = null
  for (let step = cursor.next(); !step.done; step = cursor.next()) {
    if (total === limit) return { total, more: true, current }
    if (step.value.from === from && step.value.to === to) current = total
    total++
  }
  return { total, more: false, current }
}

/** The counter beside the find field; `error` when nothing can be found. */
export function matchLabel(query: SearchQuery, matches: Matches): { text: string; error: boolean } | null {
  if (!query.search) return null
  if (!query.valid) return { text: 'Invalid regex', error: true }
  if (!matches.total) return { text: 'No results', error: true }
  const total = `${matches.total}${matches.more ? '+' : ''}`
  if (matches.current !== null) return { text: `${matches.current + 1} of ${total}`, error: false }
  return { text: `${total} ${total === '1' ? 'result' : 'results'}`, error: false }
}

type QueryConfig = ConstructorParameters<typeof SearchQuery>[0]

/** `query` with some of its settings changed. */
export function withQuery(query: SearchQuery, change: Partial<QueryConfig>): SearchQuery {
  const { search, caseSensitive, literal, regexp, replace, wholeWord, test } = query
  return new SearchQuery({ search, caseSensitive, literal, regexp, replace, wholeWord, test, ...change })
}
