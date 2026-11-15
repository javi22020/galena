import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { EditorState, type StateCommand } from '@codemirror/state'
import { expect, test } from 'vitest'
import { indentListItems, outdentListItems } from './lists'

/**
 * Runs a command on `doc` with the cursor on the line that holds `at`, or with
 * everything from that line to the one that holds `until` selected. Returns
 * the document it leaves, or null if the command did not apply.
 */
function run(command: StateCommand, doc: string, at: string, until = at): string | null {
  const selection = { anchor: doc.indexOf(at), head: doc.indexOf(until) + until.length }
  const state = EditorState.create({ doc, selection, extensions: markdown({ base: markdownLanguage }) })
  let result: string | null = null
  const applied = command({ state, dispatch: (transaction) => (result = transaction.state.doc.toString()) })
  expect(applied).toBe(result !== null)
  return result
}

const lines = (...text: string[]) => text.join('\n')

test('indenting nests an item under the text of the one above', () => {
  expect(run(indentListItems, lines('- one', '- two'), 'two')).toBe(lines('- one', '  - two'))
  // A numbered item's text starts further in than a bullet's.
  expect(run(indentListItems, lines('10. one', '11. two'), 'two')).toBe(lines('10. one', '    1. two'))
})

test('indenting takes the whole item along: its other lines and its children', () => {
  const doc = lines('- one', '- two', '  more of two', '  - child', '- three')
  expect(run(indentListItems, doc, 'two')).toBe(
    lines('- one', '  - two', '    more of two', '    - child', '- three'),
  )
})

test('indenting moves every selected item, and only those', () => {
  const doc = lines('- one', '- two', '- three', '- four')
  expect(run(indentListItems, doc, 'two', 'three')).toBe(lines('- one', '  - two', '  - three', '- four'))
})

test('indenting a numbered item restarts its number and closes the gap it leaves', () => {
  const doc = lines('1. one', '2. two', '3. three', '4. four')
  expect(run(indentListItems, doc, 'two')).toBe(lines('1. one', '   1. two', '2. three', '3. four'))
})

test('indenting into a list that is already there carries on its numbers', () => {
  const doc = lines('1. one', '   1. a', '   2. b', '2. two', '3. three')
  expect(run(indentListItems, doc, 'two')).toBe(lines('1. one', '   1. a', '   2. b', '   3. two', '2. three'))
})

test('indenting does not apply to the first item, nor outside a list', () => {
  expect(run(indentListItems, lines('- one', '- two'), 'one')).toBe(null)
  expect(run(indentListItems, lines('some text', 'more text'), 'more')).toBe(null)
})

test('lists inside a quote or indented with tabs are left to the ordinary indentation', () => {
  expect(run(indentListItems, lines('> - one', '> - two'), 'two')).toBe(null)
  expect(run(outdentListItems, lines('> - one', '>   - two'), 'two')).toBe(null)
  expect(run(indentListItems, lines('- one', '\t- two', '\t- three'), 'three')).toBe(null)
  expect(run(outdentListItems, lines('- one', '\t- two'), 'two')).toBe(null)
})

test('outdenting moves an item out to the level of the one it is nested in', () => {
  expect(run(outdentListItems, lines('- one', '  - two'), 'two')).toBe(lines('- one', '- two'))
  expect(run(outdentListItems, lines('- one', '- two'), 'two')).toBe(null)
})

test('outdenting a numbered item counts on from its parent and makes room after it', () => {
  const doc = lines('1. one', '   1. a', '2. two', '3. three')
  expect(run(outdentListItems, doc, 'a')).toBe(lines('1. one', '2. a', '3. two', '4. three'))
})

test('outdenting leaves the items that came after as children of the one moved', () => {
  const doc = lines('1. one', '   1. a', '   2. b', '   3. c', '2. two')
  expect(run(outdentListItems, doc, 'a')).toBe(lines('1. one', '2. a', '   1. b', '   2. c', '3. two'))
})

test('a number that gets wider pushes the rest of its item along', () => {
  const doc = lines('9. nine', '   1. a', '      more of a')
  expect(run(outdentListItems, doc, '1. a')).toBe(lines('9. nine', '10. a', '    more of a'))
})

test('a list not numbered in order keeps its numbers', () => {
  const doc = lines('1. one', '5. two', '9. three', '4. four')
  expect(run(indentListItems, doc, 'two')).toBe(lines('1. one', '   1. two', '9. three', '4. four'))
})
