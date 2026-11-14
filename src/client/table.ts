// Renders the Markdown source of a GFM table as an HTML table. Cells carry the
// offset of their text in the source, so a click can put the cursor there.

import type { SyntaxNode } from '@lezer/common'
import { linkTarget } from '../shared/links'
import { renderMath } from './math'
import { noteParser } from './syntax'

/** Inline nodes that map directly to an HTML element. */
const ELEMENTS: Record<string, string> = {
  Emphasis: 'em',
  StrongEmphasis: 'strong',
  Strikethrough: 'del',
  InlineCode: 'code',
  Subscript: 'sub',
  Superscript: 'sup',
  Autolink: 'span',
}

type Align = 'left' | 'center' | 'right' | ''

export function renderTable(source: string): HTMLElement {
  const wrapper = document.createElement('div')
  wrapper.className = 'cm-table'
  const table = noteParser.parse(source).topNode.firstChild
  if (table?.name !== 'Table') {
    wrapper.textContent = source
    return wrapper
  }

  const element = wrapper.appendChild(document.createElement('table'))
  let align: Align[] = []
  for (let row = table.firstChild; row; row = row.nextSibling) {
    if (row.name === 'TableDelimiter') {
      align = alignments(source.slice(row.from, row.to))
    } else {
      const header = row.name === 'TableHeader'
      const tr = element.appendChild(document.createElement('tr'))
      cells(row).forEach((cell, column) => {
        const td = tr.appendChild(document.createElement(header ? 'th' : 'td'))
        td.dataset.offset = String(cell.to)
        if (cell.node) renderInline(td, cell.node, source, cell.from, cell.to)
      })
    }
  }
  // The header comes before the row that says how its columns are aligned.
  for (const tr of element.rows) {
    for (const td of tr.cells) td.style.textAlign = align[td.cellIndex] ?? ''
  }
  return wrapper
}

interface Cell {
  from: number
  to: number
  /** Missing for an empty cell, which has no node in the syntax tree. */
  node?: SyntaxNode
}

/** The cells of a row, empty ones included. The outer pipes are optional. */
function cells(row: SyntaxNode): Cell[] {
  const found: Cell[] = []
  let cell: SyntaxNode | null = null
  let lastPipe: SyntaxNode | null = null
  for (let child = row.firstChild; child; child = child.nextSibling) {
    if (child.name === 'TableCell') {
      cell = child
    } else {
      // A pipe closes a cell, unless it is the one that opens the row.
      const empty: number = lastPipe ? Math.min(lastPipe.to + 1, child.from) : child.from
      if (cell) found.push({ from: cell.from, to: cell.to, node: cell })
      else if (lastPipe) found.push({ from: empty, to: empty })
      cell = null
      lastPipe = child
    }
  }
  if (cell) found.push({ from: cell.from, to: cell.to, node: cell })
  return found
}

/** `|:--|:-:|--:|` -> left, center, right */
function alignments(delimiterRow: string): Align[] {
  return delimiterRow
    .replace(/^\s*\||\|\s*$/g, '')
    .split('|')
    .map((cell) => cell.trim())
    .map((cell) =>
      cell.startsWith(':') && cell.endsWith(':') ? 'center' : cell.endsWith(':') ? 'right' : cell.startsWith(':') ? 'left' : '',
    )
}

/**
 * Appends the content of `node` between `from` and `to`: text as it is,
 * child nodes as elements, and markup characters (`**`, `` ` ``, ...) dropped.
 */
function renderInline(parent: HTMLElement, node: SyntaxNode, source: string, from: number, to: number): void {
  let pos = from
  for (let child = node.firstChild; child; child = child.nextSibling) {
    if (child.from < from || child.to > to) continue
    parent.append(source.slice(pos, child.from))
    pos = child.to
    if (!child.name.endsWith('Mark')) parent.append(inlineElement(child, source))
  }
  parent.append(source.slice(pos, to))
}

function inlineElement(node: SyntaxNode, source: string): Node | string {
  const text = source.slice(node.from, node.to)
  const tag = ELEMENTS[node.name]
  if (tag) {
    const element = document.createElement(tag)
    renderInline(element, node, source, node.from, node.to)
    return element
  }

  const span = document.createElement('span')
  switch (node.name) {
    case 'InlineMath': {
      const display = text.startsWith('$$')
      span.className = 'cm-math'
      renderMath(span, text.slice(display ? 2 : 1, display ? -2 : -1), display)
      return span
    }
    case 'Wikilink': {
      // `[[Note|alias]]` shows the alias; in a table the pipe is written `\|`.
      const inner = text.slice(2, -2)
      span.className = 'cm-wikilink'
      span.dataset.target = linkTarget(inner)
      span.textContent = inner.slice(inner.indexOf('|') + 1)
      return span
    }
    case 'Link': {
      const [open, close] = node.getChildren('LinkMark')
      const url = node.getChild('URL')
      if (!open || !close || !url) return text
      span.className = 'cm-link'
      span.dataset.href = source.slice(url.from, url.to)
      renderInline(span, node, source, open.to, close.from)
      return span
    }
    case 'URL':
      span.className = 'cm-link'
      span.dataset.href = text
      span.textContent = text
      return span
    case 'Escape':
      return text.slice(1)
    case 'HTMLTag':
      return /^<br\s*\/?>$/i.test(text) ? document.createElement('br') : text
    default:
      return text
  }
}
