import { expect, test } from 'vitest'
import { diagramSource, noteParser } from './syntax'

/** The text of every node with one of the given names, in document order. */
function nodes(text: string, ...names: string[]): string[] {
  const found: string[] = []
  noteParser.parse(text).iterate({
    enter(node) {
      if (names.includes(node.name)) found.push(text.slice(node.from, node.to))
    },
  })
  return found
}

test('inline math is what sits between two dollars', () => {
  expect(nodes('The area is $\\pi r^2$, and $E = mc^2$.', 'InlineMath')).toStrictEqual(['$\\pi r^2$', '$E = mc^2$'])
  expect(nodes('Inline display: $$x + y$$ here', 'InlineMath')).toStrictEqual(['$$x + y$$'])
})

test('a formula is not read as Markdown', () => {
  // Without the math node, the two underscores would be emphasis.
  expect(nodes('$a_i + b_i$ and _this_', 'Emphasis')).toStrictEqual(['_this_'])
  expect(nodes('$[[x]]$', 'Wikilink')).toStrictEqual([])
})

test('prices are not formulas', () => {
  // Nothing but the digit after the second dollar tells this from a formula.
  expect(nodes('From $5-$10 a month', 'InlineMath')).toStrictEqual([])
  expect(nodes('a $ x$ b, a $x $ b', 'InlineMath')).toStrictEqual([])
})

test('an escaped dollar does not close a formula, and a line break does not continue it', () => {
  expect(nodes('$a \\$ b$', 'InlineMath')).toStrictEqual(['$a \\$ b$'])
  expect(nodes('$a\nb$', 'InlineMath')).toStrictEqual([])
})

test('a block of math runs from one line of dollars to the next', () => {
  const text = 'Before\n\n$$\na_1 = b_2\n\nc\n$$\n\nAfter'
  expect(nodes(text, 'BlockMath')).toStrictEqual(['$$\na_1 = b_2\n\nc\n$$'])
  expect(nodes(text, 'Paragraph')).toStrictEqual(['Before', 'After'])
})

test('a block of math may be written on one line, or follow a paragraph directly', () => {
  expect(nodes('$$x = 1$$', 'BlockMath')).toStrictEqual(['$$x = 1$$'])
  expect(nodes('So:\n$$\nx\n$$', 'Paragraph', 'BlockMath')).toStrictEqual(['So:', '$$\nx\n$$'])
})

test('a line with more after its formula is text, not a block', () => {
  expect(nodes('$$x$$ and more', 'BlockMath')).toStrictEqual([])
  expect(nodes('$$x$$ and more', 'InlineMath')).toStrictEqual(['$$x$$'])
})

test('a block left open runs to the end of the note', () => {
  expect(nodes('$$\nx\n\n# Not a heading', 'BlockMath', 'ATXHeading1')).toStrictEqual(['$$\nx\n\n# Not a heading'])
})

test('wikilinks are found with their heading and alias', () => {
  expect(nodes('See [[Note]] and [[folder/Note#Heading|alias]].', 'Wikilink')).toStrictEqual([
    '[[Note]]',
    '[[folder/Note#Heading|alias]]',
  ])
  // Not an ordinary link whose text is in brackets.
  expect(nodes('[[Note]](https://example.com)', 'Link')).toStrictEqual([])
})

test('brackets that do not make a wikilink are left alone', () => {
  expect(nodes('[[]] [[a\nb]] [[a[b]] [single]', 'Wikilink')).toStrictEqual([])
})

test('a line of dashes under a paragraph does not make it a heading', () => {
  const headings = ['SetextHeading1', 'SetextHeading2']
  expect(nodes('Title\n---', ...headings)).toStrictEqual([])
  expect(nodes('Title\n===', ...headings)).toStrictEqual([])
  // What typing the first `-` of a list under a paragraph looks like.
  expect(nodes('Shopping\n-', ...headings)).toStrictEqual([])
})

/** What each fenced block of a note is drawn from; null for one that stays as code. */
function diagrams(text: string): (string | null)[] {
  const found: (string | null)[] = []
  noteParser.parse(text).iterate({
    enter(node) {
      if (node.name === 'FencedCode') found.push(diagramSource(node.node, (from, to) => text.slice(from, to)))
    },
  })
  return found
}

test('a mermaid block is a diagram', () => {
  expect(diagrams('```mermaid\nflowchart TD\n  A --> B\n```')).toStrictEqual(['flowchart TD\n  A --> B'])
  expect(diagrams('~~~Mermaid\npie\n~~~\n\ntext')).toStrictEqual(['pie'])
  // Whatever follows the language is for other tools.
  expect(diagrams('```mermaid title="Flow"\npie\n```')).toStrictEqual(['pie'])
})

test('other code is not a diagram', () => {
  expect(diagrams('```ts\nconst a = 1\n```')).toStrictEqual([null])
  expect(diagrams('```mermaids\npie\n```')).toStrictEqual([null])
  expect(diagrams('```\nmermaid\n```')).toStrictEqual([null])
})

test('an unclosed or empty block stays as code', () => {
  // Unclosed, it runs to the end of the note.
  expect(diagrams('```mermaid\nflowchart TD\n\n# Heading')).toStrictEqual([null])
  expect(diagrams('```mermaid\n```')).toStrictEqual([null])
  expect(diagrams('```mermaid\n   \n```')).toStrictEqual([null])
})
