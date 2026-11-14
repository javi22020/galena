// Live preview: links, math and tables are shown rendered and turn back into
// their Markdown source while the cursor (or a selection) touches them.
// Nested numbered items also show the numbers of the items they belong to.

import { syntaxTree } from '@codemirror/language'
import { Prec, StateField, type EditorState, type Extension, type Range } from '@codemirror/state'
import {
  Decoration,
  EditorView,
  keymap,
  ViewPlugin,
  WidgetType,
  type Command,
  type DecorationSet,
  type ViewUpdate,
} from '@codemirror/view'
import type { SyntaxNode } from '@lezer/common'
import { linkTarget } from '../shared/links'
import { renderMath } from './math'
import { followLink } from './store'
import { renderTable } from './table'

const hidden = Decoration.replace({})
/** The lines of a code block; the first and the last one close its box. */
const codeLine = (first: boolean, last: boolean) =>
  Decoration.line({ class: `cm-code-line${first ? ' cm-code-first' : ''}${last ? ' cm-code-last' : ''}` })

/** Whether the cursor or a selection is on a range, ends included. */
function touches(state: EditorState, from: number, to: number): boolean {
  return state.selection.ranges.some((range) => range.from <= to && range.to >= from)
}

class MathWidget extends WidgetType {
  constructor(
    readonly tex: string,
    readonly display: boolean,
    readonly block = false,
  ) {
    super()
  }

  eq(other: MathWidget): boolean {
    return other.tex === this.tex && other.display === this.display && other.block === this.block
  }

  toDOM(): HTMLElement {
    const element = document.createElement(this.block ? 'div' : 'span')
    element.className = this.block ? 'cm-math cm-math-block' : 'cm-math'
    renderMath(element, this.tex, this.display)
    return element
  }

  // Let the editor handle clicks: they put the cursor on the formula, revealing it.
  ignoreEvent(): boolean {
    return false
  }
}

/** The outer numbers of a nested numbered item, shown before its own marker. */
class NumberPrefixWidget extends WidgetType {
  constructor(readonly prefix: string) {
    super()
  }

  eq(other: NumberPrefixWidget): boolean {
    return other.prefix === this.prefix
  }

  toDOM(): HTMLElement {
    const element = document.createElement('span')
    element.className = 'cm-list-prefix'
    element.textContent = this.prefix
    return element
  }

  ignoreEvent(): boolean {
    return false
  }
}

/**
 * The numbers of the numbered items around a list marker, as in the "2.1." of
 * "2.1.3."; empty at the top level. Bullets in between start the count again.
 */
function numberPrefix(state: EditorState, mark: SyntaxNode): string {
  let prefix = ''
  let list = mark.parent?.parent
  while (list?.name === 'OrderedList') {
    const item = list.parent
    const outer = item?.name === 'ListItem' ? item.getChild('ListMark') : null
    const number = outer && /^\d+/.exec(state.sliceDoc(outer.from, outer.to))?.[0]
    if (!item || !number) break
    prefix = `${number}.${prefix}`
    list = item.parent
  }
  return prefix
}

class TableWidget extends WidgetType {
  constructor(readonly source: string) {
    super()
  }

  eq(other: TableWidget): boolean {
    return other.source === this.source
  }

  toDOM(view: EditorView): HTMLElement {
    const element = renderTable(this.source)
    // The editor ignores events inside widgets, so clicks are handled here:
    // they reveal the source with the cursor in the cell that was clicked.
    element.addEventListener('mousedown', (event) => {
      if (event.button !== 0 || !(event.target instanceof Element)) return
      event.preventDefault()
      if (openLink(event)) return
      const cell = event.target.closest<HTMLElement>('th, td')
      const anchor = view.posAtDOM(element) + Number(cell?.dataset.offset ?? 0)
      view.dispatch({ selection: { anchor }, scrollIntoView: true, userEvent: 'select' })
      view.focus()
    })
    return element
  }
}

/** Follows the link under a Ctrl/Cmd+click; says whether there was one. */
function openLink(event: MouseEvent): boolean {
  if (!(event.ctrlKey || event.metaKey) || !(event.target instanceof Element)) return false
  const link = event.target.closest<HTMLElement>('.cm-wikilink, .cm-link')
  if (!link) return false
  const { target, href } = link.dataset
  if (target) void followLink(target)
  else if (href && /^[a-z][a-z\d+.-]*:/i.test(href)) window.open(href, '_blank', 'noopener')
  else if (href) void followLink(decodeURIComponent(href)) // a relative link to another note
  return true
}

/**
 * Decorations that stay within a line: hidden link syntax, inline math, the
 * numbers of nested lists and the styling of code-block lines. Only the visible part of the note is built.
 */
function inlineDecorations(view: EditorView): DecorationSet {
  const { state } = view
  const ranges: Range<Decoration>[] = []

  for (const visible of view.visibleRanges) {
    syntaxTree(state).iterate({
      from: visible.from,
      to: visible.to,
      enter(node) {
        const { from, to } = node
        const shown = touches(state, from, to)

        if (node.name === 'FencedCode' || node.name === 'CodeBlock') {
          for (let line = state.doc.lineAt(from); ; line = state.doc.line(line.number + 1)) {
            const last = line.to >= to
            ranges.push(codeLine(line.from <= from, last).range(line.from))
            if (last) break
          }
          return false
        }

        if (node.name === 'ListMark') {
          // Added in front of the marker, which stays as it is in the file.
          const prefix = numberPrefix(state, node.node)
          if (prefix) {
            ranges.push(Decoration.widget({ widget: new NumberPrefixWidget(prefix), side: 1 }).range(from))
          }
        }

        if (node.name === 'InlineMath' && !shown) {
          const source = state.sliceDoc(from, to)
          const display = source.startsWith('$$')
          const tex = source.slice(display ? 2 : 1, display ? -2 : -1)
          ranges.push(Decoration.replace({ widget: new MathWidget(tex, display) }).range(from, to))
        }

        if (node.name === 'Wikilink') {
          const inner = state.sliceDoc(from + 2, to - 2)
          const link = Decoration.mark({
            class: 'cm-wikilink',
            attributes: { 'data-target': linkTarget(inner), title: 'Ctrl/Cmd + click to open' },
          })
          ranges.push(link.range(from, to))
          if (!shown) {
            // `[[Note|alias]]` shows only the alias.
            const alias = inner.indexOf('|') + 1
            ranges.push(hidden.range(from, from + 2 + alias), hidden.range(to - 2, to))
          }
        }

        if (node.name === 'Link') {
          // Only inline links, `[text](url)`; reference links have no URL to hide.
          const [open, close, paren] = node.node.getChildren('LinkMark')
          const url = node.node.getChild('URL')
          if (!open || !close || !url || !paren || open.to === close.from) return
          const link = Decoration.mark({
            class: 'cm-link',
            attributes: { 'data-href': state.sliceDoc(url.from, url.to), title: 'Ctrl/Cmd + click to open' },
          })
          ranges.push(link.range(open.to, close.from))
          if (!shown) ranges.push(hidden.range(from, open.to), hidden.range(close.from, to))
        }
      },
    })
  }
  return Decoration.set(ranges, true)
}

const inlinePreview = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet

    constructor(view: EditorView) {
      this.decorations = inlineDecorations(view)
    }

    update(update: ViewUpdate) {
      const parsed = syntaxTree(update.startState) !== syntaxTree(update.state)
      if (update.docChanged || update.selectionSet || update.viewportChanged || parsed) {
        this.decorations = inlineDecorations(update.view)
      }
    }
  },
  {
    decorations: (plugin) => plugin.decorations,
    eventHandlers: {
      mousedown(event) {
        if (openLink(event)) event.preventDefault()
      },
    },
  },
)

/**
 * `$$` blocks and tables, rendered. Decorations that replace whole lines
 * change the editor's vertical layout, so they must come from a state field
 * rather than a view plugin.
 */
function blockDecorations(state: EditorState): DecorationSet {
  const ranges: Range<Decoration>[] = []
  syntaxTree(state).iterate({
    enter(node) {
      if (node.name === 'Paragraph') return false // no blocks inside; skip its inline nodes
      if (node.name !== 'BlockMath' && node.name !== 'Table') return
      const { from, to } = node
      const source = state.sliceDoc(from, to)
      // Only blocks at the top level, which start and end with their lines.
      const wholeLines = from === state.doc.lineAt(from).from && to === state.doc.lineAt(to).to
      let widget: WidgetType | undefined
      if (node.name === 'Table') {
        widget = new TableWidget(source)
      } else {
        // An unclosed block would swallow the rest of the note: leave it as text.
        const tex = /^\$\$([\s\S]*)\$\$\s*$/.exec(source)?.[1]?.trim()
        if (tex) widget = new MathWidget(tex, true, true)
      }
      if (widget && wholeLines && !touches(state, from, to)) {
        ranges.push(Decoration.replace({ widget, block: true }).range(from, to))
      }
      return false
    },
  })
  return Decoration.set(ranges)
}

const blockPreview = StateField.define<DecorationSet>({
  create: blockDecorations,
  update(decorations, transaction) {
    const parsed = syntaxTree(transaction.startState) !== syntaxTree(transaction.state)
    return transaction.docChanged || transaction.selection || parsed
      ? blockDecorations(transaction.state)
      : decorations
  },
  provide: (field) => EditorView.decorations.from(field),
})

/**
 * Moving up or down would jump over a rendered block, which has no text to
 * land on. This steps into it instead, so it opens for editing.
 */
function enterBlock(forward: boolean): Command {
  return (view) => {
    const { state } = view
    const { main } = state.selection
    if (!main.empty) return false
    const line = state.doc.lineAt(main.head)
    const next = view.moveVertically(main, forward).head
    // Still inside the same wrapped line: an ordinary move.
    if (next !== main.head && state.doc.lineAt(next).number === line.number) return false

    const reach = forward ? Math.max(next, line.to + 1) : Math.min(next, line.from - 1)
    let target: number | undefined
    state
      .field(blockPreview)
      .between(Math.max(0, Math.min(main.head, reach)), Math.min(state.doc.length, Math.max(main.head, reach)), (from, to) => {
        if (forward && from > main.head) target ??= from
        if (!forward && to < main.head) target = to
      })
    if (target === undefined) return false
    view.dispatch({ selection: { anchor: target }, scrollIntoView: true, userEvent: 'select' })
    return true
  }
}

export const livePreview: Extension = [
  blockPreview,
  inlinePreview,
  Prec.high(
    keymap.of([
      { key: 'ArrowDown', run: enterBlock(true) },
      { key: 'ArrowUp', run: enterBlock(false) },
    ]),
  ),
]
