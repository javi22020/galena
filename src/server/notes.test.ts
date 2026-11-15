import { expect, test } from 'vitest'
import type { Entry } from '../shared/types'
import { NoteIndex } from './notes'
import type { Vault } from './vault'

const lines = (...text: string[]) => text.join('\n')

/** An index over notes held in memory; changing `notes` is changing the disk. */
async function indexOf(notes: Record<string, string>): Promise<NoteIndex> {
  const vault = {
    list: async (): Promise<Entry[]> => Object.keys(notes).map((path) => ({ path, type: 'file' })),
    readIfExists: async (path: string) => notes[path] ?? null,
  }
  const index = new NoteIndex(vault as unknown as Vault)
  await index.build()
  return index
}

async function tagsOf(text: string): Promise<string[]> {
  const index = await indexOf({ 'note.md': text })
  return index.graph().nodes[0]!.tags.sort()
}

test('tags are words after a hash, but numbers, anchors and headings are not', async () => {
  const text = lines(
    '# Heading',
    'An #idea from #2024, in its #v2.',
    'See page#section, issue #123 and a # alone.',
    '#project/galena starts a line',
  )
  expect(await tagsOf(text)).toStrictEqual(['idea', 'project/galena', 'v2'])
})

test('tags take letters of any alphabet', async () => {
  expect(await tagsOf('#teoría y #数学')).toStrictEqual(['teoría', '数学'])
})

test('what is inside a code block is neither a tag nor a link', async () => {
  const text = lines('#real', '```sh', '#comment [[Target]]', '```', '~~~', '#other', '~~~')
  const index = await indexOf({ 'note.md': text, 'Target.md': '' })
  expect(index.graph().nodes[0]!.tags).toStrictEqual(['real'])
  expect(index.graph().links).toStrictEqual([])
  expect(index.backlinks('Target.md')).toStrictEqual([])
})

test('tags are read from the front matter, however the list is written', async () => {
  expect(await tagsOf(lines('---', 'tags: [alpha, "beta"]', '---'))).toStrictEqual(['alpha', 'beta'])
  expect(await tagsOf(lines('---', 'tags: alpha, #beta', '---'))).toStrictEqual(['alpha', 'beta'])
  expect(await tagsOf(lines('---', 'title: Note', 'tags:', '  - alpha', "  - '#beta'", 'date: 2024', '---'))).toStrictEqual([
    'alpha',
    'beta',
  ])
  // A note saved on Windows.
  expect(await tagsOf('---\r\ntags:\r\n  - alpha\r\n  - beta\r\n---\r\n')).toStrictEqual(['alpha', 'beta'])
})

test('a tag given twice counts once, and `tags:` outside the front matter is text', async () => {
  expect(await tagsOf(lines('---', 'tags: [alpha]', '---', 'About #alpha and #alpha.'))).toStrictEqual(['alpha'])
  expect(await tagsOf(lines('Some text', 'tags: alpha'))).toStrictEqual([])
})

test('backlinks are the lines that link to a note, whatever heading or alias they use', async () => {
  const index = await indexOf({
    'Target.md': 'Links to itself: [[Target]]',
    'a.md': lines('Intro', 'See [[Target]] first', 'nothing here', '  and [[target#Part|again]] indented  '),
    'b.md': 'About [[Other]] only',
  })
  expect(index.backlinks('Target.md')).toStrictEqual([
    { path: 'a.md', line: 2, text: 'See [[Target]] first' },
    { path: 'a.md', line: 4, text: 'and [[target#Part|again]] indented' },
  ])
})

test('a name shared by several notes links to the nearest, unless the link gives a path', async () => {
  const index = await indexOf({
    'x/deep/T.md': '',
    'y/T.md': '',
    'by-name.md': '[[T]]',
    'by-path.md': '[[deep/T]]',
  })
  expect(index.backlinks('y/T.md').map((match) => match.path)).toStrictEqual(['by-name.md'])
  expect(index.backlinks('x/deep/T.md').map((match) => match.path)).toStrictEqual(['by-path.md'])
})

test('the graph has one link for each pair of notes, and none to itself or to nothing', async () => {
  const index = await indexOf({
    'a.md': '[[b]] [[B|again]] [[folder/b]] [[a]] [[missing]]',
    'folder/b.md': '#tag',
  })
  expect(index.graph()).toStrictEqual({
    nodes: [
      { path: 'a.md', tags: [] },
      { path: 'folder/b.md', tags: ['tag'] },
    ],
    links: [{ source: 'a.md', target: 'folder/b.md' }],
  })
})

test('links follow notes as they are created, renamed and deleted', async () => {
  const notes: Record<string, string> = { 'a.md': '[[b]]' }
  const index = await indexOf(notes)
  expect(index.graph().links).toStrictEqual([])

  notes['b.md'] = ''
  await index.update('b.md')
  expect(index.graph().links).toStrictEqual([{ source: 'a.md', target: 'b.md' }])

  // Moved: the watcher reports the new file and the old one gone.
  notes['folder/b.md'] = notes['b.md']
  delete notes['b.md']
  await index.update('folder/b.md')
  await index.update('b.md')
  expect(index.graph().links).toStrictEqual([{ source: 'a.md', target: 'folder/b.md' }])

  delete notes['folder/b.md']
  await index.update('folder/b.md')
  expect(index.graph()).toStrictEqual({ nodes: [{ path: 'a.md', tags: [] }], links: [] })
})

test('an edited note is indexed again', async () => {
  const notes: Record<string, string> = { 'a.md': '[[b]] #old', 'b.md': '', 'c.md': '' }
  const index = await indexOf(notes)
  notes['a.md'] = '[[c]] #new'
  await index.update('a.md')
  expect(index.backlinks('b.md')).toStrictEqual([])
  expect(index.backlinks('c.md')).toStrictEqual([{ path: 'a.md', line: 1, text: '[[c]] #new' }])
  expect(index.graph().nodes[0]).toStrictEqual({ path: 'a.md', tags: ['new'] })
})

test('searching by name ranks the name over the folder, and both over scattered letters', async () => {
  const index = await indexOf({
    'p/l/a/n.md': '',
    'plans/notes.md': '',
    'My plan.md': '',
    'Plan B.md': '',
    'other.md': '',
    'Plan.md': '',
  })
  expect(index.searchNames('plan')).toStrictEqual(['Plan.md', 'Plan B.md', 'My plan.md', 'plans/notes.md', 'p/l/a/n.md'])
  expect(index.searchNames(' PLAN ', 2)).toStrictEqual(['Plan.md', 'Plan B.md'])
})

test('searching by name with nothing typed lists the notes in order', async () => {
  const index = await indexOf({ 'c.md': '', 'a.md': '', 'b.md': '' })
  expect(index.searchNames('', 2)).toStrictEqual(['a.md', 'b.md'])
})

test('searching text finds each line that has it, whatever its case', async () => {
  const index = await indexOf({
    'a.md': lines('Alpha', '  the BETA line  ', 'beta again'),
    'b.md': 'nothing here',
    'c.md': 'Beta',
  })
  expect(index.searchText('beta')).toStrictEqual([
    { path: 'a.md', line: 2, text: 'the BETA line' },
    { path: 'a.md', line: 3, text: 'beta again' },
    { path: 'c.md', line: 1, text: 'Beta' },
  ])
  // The limit counts lines, not notes.
  expect(index.searchText('beta', 1)).toStrictEqual([{ path: 'a.md', line: 2, text: 'the BETA line' }])
  expect(index.searchText('  ')).toStrictEqual([])
})
