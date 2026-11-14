// Markdown syntax that the CommonMark/GFM parser does not know: math and
// wikilinks. Parsing them into nodes of their own keeps their content from
// being read as Markdown (the `_` and `^` of a formula are not emphasis) and
// gives the live preview something to find in the syntax tree.

import { tags as t } from '@lezer/highlight'
import {
  Emoji,
  GFM,
  parser,
  Subscript,
  Superscript,
  type BlockContext,
  type Line,
  type MarkdownConfig,
} from '@lezer/markdown'

const DOLLAR = 36
const OPEN_BRACKET = 91

/** Inside the document node only; blocks nested in lists or quotes stay text. */
const TOP_LEVEL = 1

const closesMath = (text: string) => /\$\$\s*$/.test(text)

/**
 * Whether a line starts a `$$` block. A line like `$$x$$ and more` does not:
 * its formula is closed mid-line, so it is ordinary text with inline math.
 */
function opensMathBlock(cx: BlockContext, line: Line): boolean {
  if (cx.depth !== TOP_LEVEL || !line.text.startsWith('$$', line.pos)) return false
  const rest = line.text.slice(line.pos + 2)
  return !rest.includes('$$') || closesMath(rest)
}

export const mathSyntax: MarkdownConfig = {
  defineNodes: [
    { name: 'InlineMath', style: t.monospace },
    { name: 'BlockMath', block: true, style: t.monospace },
  ],
  parseBlock: [
    {
      name: 'BlockMath',
      parse(cx, line) {
        if (!opensMathBlock(cx, line)) return false
        const from = cx.lineStart + line.pos
        // Runs to the first line that ends with `$$`, or to the end of the note.
        let open = !closesMath(line.text.slice(line.pos + 2))
        while (open && cx.nextLine()) open = !closesMath(line.text)
        if (!open) cx.nextLine()
        cx.addElement(cx.elt('BlockMath', from, cx.prevLineEnd()))
        return true
      },
      // Like a code fence, `$$` may follow a paragraph without a blank line.
      endLeaf: opensMathBlock,
    },
  ],
  parseInline: [
    {
      name: 'InlineMath',
      parse(cx, next, pos) {
        if (next !== DOLLAR) return -1
        const display = cx.char(pos + 1) === DOLLAR
        const mark = display ? 2 : 1
        const rest = cx.slice(pos + mark, cx.end)
        const close = display ? rest.indexOf('$$') : closingDollar(rest)
        if (close <= 0 || rest.slice(0, close).includes('\n')) return -1
        return cx.addElement(cx.elt('InlineMath', pos, pos + mark + close + mark))
      },
    },
  ],
}

/**
 * Index of the `$` that closes inline math, following Pandoc's rules so that
 * prices are left alone: no space right inside the delimiters, and no digit
 * right after the closing one ("$5 and $10" is not a formula).
 */
function closingDollar(rest: string): number {
  if (/^\s/.test(rest)) return -1
  for (let i = rest.indexOf('$'); i > 0; i = rest.indexOf('$', i + 1)) {
    const escaped = rest[i - 1] === '\\'
    if (!escaped && !/\s/.test(rest[i - 1]!) && !/\d/.test(rest[i + 1] ?? '')) return i
  }
  return -1
}

/** `[[Note]]`, `[[Note#Heading]]`, `[[Note|alias]]` */
export const wikilinkSyntax: MarkdownConfig = {
  defineNodes: ['Wikilink'],
  parseInline: [
    {
      name: 'Wikilink',
      before: 'Link',
      parse(cx, next, pos) {
        if (next !== OPEN_BRACKET || cx.char(pos + 1) !== OPEN_BRACKET) return -1
        const inner = /^[^[\]\n]+\]\]/.exec(cx.slice(pos + 2, cx.end))
        return inner ? cx.addElement(cx.elt('Wikilink', pos, pos + 2 + inner[0].length)) : -1
      },
    },
  ],
}

/**
 * Headings are only written with `#`. CommonMark also makes a line of `-` or
 * `=` turn the paragraph above it into a heading (a "setext" heading), so a
 * list started right under a paragraph would turn that paragraph into a
 * heading while its first `-` is being typed.
 */
export const noSetextHeadings: MarkdownConfig = { remove: ['SetextHeading'] }

/**
 * A standalone parser for the same Markdown the editor understands (the
 * extensions of `markdownLanguage` plus the ones above), to render pieces of
 * a note outside the editor's own syntax tree.
 */
export const noteParser = parser.configure([GFM, Subscript, Superscript, Emoji, mathSyntax, wikilinkSyntax, noSetextHeadings])
