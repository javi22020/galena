import { EditorState } from '@codemirror/state'
import { expect, test } from 'vitest'
import { pickedText } from './selection'

const DOC = 'first\nsecond\nthird\n\nfifth'

/** Selects from the start of `from` to the end of `to`, both found in the document. */
function pick(from: string, to = from) {
  const selection = { anchor: DOC.indexOf(from), head: DOC.indexOf(to) + to.length }
  return pickedText(EditorState.create({ doc: DOC, selection }))
}

test('pickedText gives the text and the lines it spans, counted from 1', () => {
  expect(pick('second')).toStrictEqual({ text: 'second', lines: { from: 2, to: 2 } })
  expect(pick('rst', 'thi')).toStrictEqual({ text: 'rst\nsecond\nthi', lines: { from: 1, to: 3 } })
})

test('pickedText is the same whichever way the selection was dragged', () => {
  const state = EditorState.create({ doc: DOC, selection: { anchor: 12, head: 6 } })
  expect(pickedText(state)).toStrictEqual({ text: 'second', lines: { from: 2, to: 2 } })
})

test('a selection that ends at the start of a line does not take that line', () => {
  // What selecting whole lines gives: the line break is in, the next line is not.
  expect(pick('second', 'second\n')).toStrictEqual({ text: 'second\n', lines: { from: 2, to: 2 } })
})

test('pickedText has nothing for an empty selection or one of blank space alone', () => {
  const at = (anchor: number, head: number) => pickedText(EditorState.create({ doc: DOC, selection: { anchor, head } }))
  expect(at(3, 3)).toBe(null)
  // The break after `third` and the empty line that follows.
  expect(at(18, 20)).toBe(null)
})
