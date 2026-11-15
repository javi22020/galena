// Tab and Shift+Tab on list items: indentation that Markdown reads as nesting,
// and numbers that keep counting after an item has moved to another level.

import { ensureSyntaxTree, syntaxTree } from '@codemirror/language'
import type { ChangeSpec, EditorState, StateCommand, Text } from '@codemirror/state'
import type { SyntaxNode } from '@lezer/common'

/** Nests the selected items under the item above them. */
export const indentListItems: StateCommand = ({ state, dispatch }) => {
  const { doc } = state
  const selected = selectedItems(state)
  const above = selected?.first.prevSibling
  if (!selected || above?.name !== 'ListItem') return false
  const { run, first, last } = selected

  // Join the list the item above already ends with, or start one under its text.
  const joined = nestedList(above)
  const from = markColumn(doc, first)
  const target = joined ? itemColumn(doc, joined) : contentColumn(doc, above)
  if (from === null || target === null || target <= from) return false

  const edit = listEdit(doc)
  for (const item of run) edit.shift(item, target - from)
  const number = numberOf(doc, first)
  if (number !== null) {
    const start = lastNumber(doc, joined) + 1
    run.forEach((item, i) => edit.number(item, start + i))
    edit.follow(last, number) // the items left behind close the gap
  }
  dispatch(state.update({ changes: edit.changes(), scrollIntoView: true, userEvent: 'input.indent' }))
  return true
}

/** Moves the selected items out to the level of the item they are nested in. */
export const outdentListItems: StateCommand = ({ state, dispatch }) => {
  const { doc } = state
  const selected = selectedItems(state)
  const parent = selected?.first.parent?.parent
  if (!selected || parent?.name !== 'ListItem') return false
  const { run, first, last } = selected

  const from = markColumn(doc, first)
  const target = markColumn(doc, parent)
  if (from === null || target === null || target >= from) return false

  const edit = listEdit(doc)
  for (const item of run) edit.shift(item, target - from)
  let widened = 0
  if (numberOf(doc, first) !== null) {
    const outer = numberOf(doc, parent)
    const start = outer === null ? 1 : outer + 1
    run.forEach((item, i) => (widened = edit.number(item, start + i)))
    if (outer !== null) edit.follow(parent, start + run.length) // make room among the parent's siblings
  }

  // The items that came after end up below the last one moved, so they become
  // its children: line them up with the ones it has, or with its text.
  const tail = siblingsAfter(last)
  if (tail.length) {
    const own = nestedList(last)
    const before = own ? itemColumn(doc, own) : contentColumn(doc, last)
    if (before === null) return false
    for (const item of tail) {
      const at = markColumn(doc, item)
      if (at === null) return false
      edit.shift(item, before + (target - from) + widened - at)
    }
    edit.follow(last, lastNumber(doc, own) + 1)
  }
  dispatch(state.update({ changes: edit.changes(), scrollIntoView: true, userEvent: 'delete.dedent' }))
  return true
}

interface Selected {
  /** The items the selection covers, all of them siblings, from `first` to `last`. */
  run: SyntaxNode[]
  first: SyntaxNode
  last: SyntaxNode
}

/**
 * The list items under the selection; null when it is not in a list. One that
 * reaches into deeper items takes the sibling that holds them.
 */
function selectedItems(state: EditorState): Selected | null {
  if (state.selection.ranges.length > 1) return null
  const { doc } = state
  const tree = ensureSyntaxTree(state, doc.length, 50) ?? syntaxTree(state)
  const itemAt = (pos: number): SyntaxNode | null => {
    const line = doc.lineAt(pos)
    const text = line.from + (line.text.length - line.text.trimStart().length)
    for (let node: SyntaxNode | null = tree.resolveInner(text, 1); node; node = node.parent) {
      if (node.name === 'ListItem') return node
    }
    return null
  }

  let { from, to } = state.selection.main
  if (to > from && to === doc.lineAt(to).from) to-- // whole lines selected: the next one is not part of it
  const first = itemAt(from)
  const list = first?.parent
  if (!first || !list) return null
  let last = itemAt(to)
  while (last && !(last.parent?.from === list.from && last.parent.name === list.name)) {
    last = last.parent?.parent ?? null
  }
  if (!last || last.name !== 'ListItem' || last.from < first.from) return null

  const end = last.from
  return { run: [first, ...siblingsAfter(first).filter((item) => item.from <= end)], first, last }
}

/** Collects edits against the document as it is, to apply them in one change. */
function listEdit(doc: Text) {
  /** How far each line moves sideways, by line number. */
  const indent = new Map<number, number>()
  const marks: ChangeSpec[] = []

  const edit = {
    /** Moves the lines of an item sideways; with `rest`, only those after the first. */
    shift(item: SyntaxNode, by: number, rest = false): void {
      const first = doc.lineAt(markOf(item).from).number + (rest ? 1 : 0)
      const last = doc.lineAt(item.to).number
      for (let line = first; line <= last; line++) indent.set(line, (indent.get(line) ?? 0) + by)
    },

    /**
     * Gives a numbered item another number. Returns how much wider its marker
     * became; the rest of the item moves by as much, to stay inside it.
     */
    number(item: SyntaxNode, value: number): number {
      const old = digitsOf(doc, item)
      const text = String(value)
      if (!old || old === text) return 0
      const { from } = markOf(item)
      marks.push({ from, to: from + old.length, insert: text })
      edit.shift(item, text.length - old.length, true)
      return text.length - old.length
    },

    /**
     * Renumbers the items after `item` from `next` on, for as long as they
     * were counting up from it; a list numbered some other way is left alone.
     */
    follow(item: SyntaxNode, next: number): void {
      let expected = numberOf(doc, item)
      for (const sibling of siblingsAfter(item)) {
        if (expected === null || numberOf(doc, sibling) !== ++expected) return
        edit.number(sibling, next++)
      }
    },

    changes(): ChangeSpec[] {
      const lines: ChangeSpec[] = []
      for (const [number, by] of indent) {
        const line = doc.line(number)
        const spaces = line.text.length - line.text.replace(/^ +/, '').length
        if (by > 0 && line.text.trim()) lines.push({ from: line.from, insert: ' '.repeat(by) })
        if (by < 0 && spaces) lines.push({ from: line.from, to: line.from + Math.min(-by, spaces) })
      }
      return [...lines, ...marks]
    },
  }
  return edit
}

function markOf(item: SyntaxNode): SyntaxNode {
  return item.getChild('ListMark') ?? item
}

/** The digits of a numbered item's marker; empty for a bullet. */
function digitsOf(doc: Text, item: SyntaxNode): string {
  const mark = markOf(item)
  return /^\d*/.exec(doc.sliceString(mark.from, mark.to))![0]
}

function numberOf(doc: Text, item: SyntaxNode): number | null {
  const digits = digitsOf(doc, item)
  return digits ? Number(digits) : null
}

/** The number a numbered list has reached; zero for bullets or no list at all. */
function lastNumber(doc: Text, list: SyntaxNode | null): number {
  const item = list?.name === 'OrderedList' ? list.lastChild : null
  return (item && numberOf(doc, item)) ?? 0
}

/** The list an item ends with, which is where more children would go. */
function nestedList(item: SyntaxNode): SyntaxNode | null {
  const end = item.lastChild
  return end && (end.name === 'OrderedList' || end.name === 'BulletList') ? end : null
}

function siblingsAfter(item: SyntaxNode): SyntaxNode[] {
  const items: SyntaxNode[] = []
  for (let next = item.nextSibling; next; next = next.nextSibling) {
    if (next.name === 'ListItem') items.push(next)
  }
  return items
}

/**
 * How many spaces come before a position on its line. Null when anything else
 * does (tabs, a quote's `>`, another marker): such lists are left to the
 * ordinary indentation commands.
 */
function column(doc: Text, pos: number): number | null {
  const line = doc.lineAt(pos)
  const before = line.text.slice(0, pos - line.from)
  return /^ *$/.test(before) ? before.length : null
}

function markColumn(doc: Text, item: SyntaxNode): number | null {
  return column(doc, markOf(item).from)
}

/**
 * The column the items of a list are at, taken from its last one, next to
 * which a new one goes. Not where the list itself starts: a nested list takes
 * in the indentation before its first marker, so it starts at its parent's text.
 */
function itemColumn(doc: Text, list: SyntaxNode): number | null {
  const item = list.lastChild
  return item && markColumn(doc, item)
}

/** The column where an item's own text starts, which is how far its children are indented. */
function contentColumn(doc: Text, item: SyntaxNode): number | null {
  const mark = markOf(item)
  const start = column(doc, mark.from)
  if (start === null) return null
  const line = doc.lineAt(mark.to)
  const after = line.text.slice(mark.to - line.from)
  const spaces = after.length - after.trimStart().length
  // An empty item, or one that opens with indented code, counts a single space.
  const gap = after.trim() && spaces >= 1 && spaces <= 4 ? spaces : 1
  return start + (mark.to - mark.from) + gap
}
