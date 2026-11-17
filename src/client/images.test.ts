import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { ensureSyntaxTree } from '@codemirror/language'
import { EditorState } from '@codemirror/state'
import { expect, test } from 'vitest'
import { imageSrc, relativeUrl, shownImage } from './images'

/** What the preview shows for every image link in a note; null for one it leaves as text. */
function shown(doc: string): (string | null)[] {
  const state = EditorState.create({ doc, extensions: markdown({ base: markdownLanguage }) })
  const found: (string | null)[] = []
  ensureSyntaxTree(state, doc.length, 5000)!.iterate({
    enter(node) {
      if (node.name === 'Image') found.push(shownImage(state, node.node))
    },
  })
  return found
}

test('a pasted image is linked relative to the note', () => {
  expect(relativeUrl('', 'assets/a-1234abcd.png')).toBe('assets/a-1234abcd.png')
  expect(relativeUrl('notes', 'assets/a.png')).toBe('../assets/a.png')
  expect(relativeUrl('notes/deep', 'assets/a.png')).toBe('../../assets/a.png')
  expect(relativeUrl('assets', 'assets/a.png')).toBe('a.png')
  expect(relativeUrl('assets/old', 'assets/a.png')).toBe('../a.png')
  // A folder whose name only starts like another is not that folder.
  expect(relativeUrl('assetsX', 'assets/a.png')).toBe('../assets/a.png')
})

test('an image link is loaded from the vault, relative to the note', () => {
  const vault = (path: string) => `/api/image?${new URLSearchParams({ path })}`
  expect(imageSrc('../assets/a.png', 'notes/Note.md')).toBe(vault('assets/a.png'))
  expect(imageSrc('pic.png', 'Note.md')).toBe(vault('pic.png'))
  expect(imageSrc('my%20pic.png', 'My notes/Note.md')).toBe(vault('My notes/my pic.png'))
  expect(imageSrc('<my pic.png>', 'a#b/Note.md')).toBe(vault('a#b/my pic.png'))
  expect(imageSrc('/assets/a.png?raw#top', 'notes/Note.md')).toBe(vault('assets/a.png'))
})

test('a web image is loaded as it is, and other addresses not at all', () => {
  expect(imageSrc('https://example.com/a.png', 'Note.md')).toBe('https://example.com/a.png')
  expect(imageSrc('file:///etc/a.png', 'Note.md')).toBe(null)
  expect(imageSrc('bad%zz.png', 'Note.md')).toBe(null)
  expect(imageSrc('data:image/png;base64,AAAA', 'Note.md')).toBe(null)
  expect(imageSrc('javascript:alert(1)', 'Note.md')).toBe(null)
})

test('the preview shows the images it can load, wherever they are in the text', () => {
  expect(shown('![](assets/a.png)')).toStrictEqual(['assets/a.png'])
  expect(shown('Text ![alt](<a b.png>) and ![](http://example.com/a.png)')).toStrictEqual([
    '<a b.png>',
    'http://example.com/a.png',
  ])
  expect(shown('- ![](a.png)\n\n> ![](b.png)')).toStrictEqual(['a.png', 'b.png'])
  expect(shown('[![](badge.png)](https://example.com)')).toStrictEqual(['badge.png'])
})

test('an image the preview cannot show stays as text', () => {
  expect(shown('![](data:image/png;base64,AAAA) ![](bad%zz.png) ![]()')).toStrictEqual([null, null, null])
  // A reference has no address of its own.
  expect(shown('![alt][ref]\n\n[ref]: a.png')).toStrictEqual([null])
  // A table is rendered without images, so hiding the link would leave nothing.
  expect(shown('| a | b |\n| - | - |\n| ![](a.png) | **![](b.png)** |')).toStrictEqual([null, null])
})
