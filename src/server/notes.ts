import { noteName, resolveLink } from '../shared/links'
import type { Graph, LineMatch } from '../shared/types'
import type { Vault } from './vault'

interface Note {
  text: string
  /** Raw wikilink targets, e.g. `folder/Note` for `[[folder/Note#Heading|alias]]`. */
  links: string[]
  tags: string[]
}

const WIKILINK = /\[\[([^\]\n|#]+)(?:#[^\]\n|]*)?(?:\|[^\]\n]*)?\]\]/g
// A tag needs at least one non-digit, so `#123` is not one.
const TAG = /(?:^|\s)#([\p{L}\d_/-]*[\p{L}_][\p{L}\d_/-]*)/gu
const FENCED_CODE = /^(```|~~~)[\s\S]*?^\1/gm
const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---/
const FRONTMATTER_TAGS = /^tags:[ \t]*(.*(?:\r?\n[ \t]*-.*)*)/m

/** In-memory index of every note: wikilinks, tags and text for searching. */
export class NoteIndex {
  private notes = new Map<string, Note>()
  /** Lowercase note name -> paths, for resolving links; rebuilt lazily. */
  private names?: Map<string, string[]>

  constructor(private vault: Vault) {}

  async build(): Promise<void> {
    for (const entry of await this.vault.list()) {
      if (entry.type === 'file') await this.update(entry.path)
    }
  }

  /** (Re)indexes a note from disk; a note that vanished meanwhile is dropped. */
  async update(path: string): Promise<void> {
    const text = await this.vault.readIfExists(path)
    if (text === null) return this.remove(path)
    if (!this.notes.has(path)) this.names = undefined
    this.notes.set(path, parse(text))
  }

  remove(path: string): void {
    if (this.notes.delete(path)) this.names = undefined
  }

  backlinks(path: string): LineMatch[] {
    const matches: LineMatch[] = []
    for (const [source, note] of this.notes) {
      if (source === path || !note.links.some((link) => this.resolve(link) === path)) continue
      // Code is blanked rather than dropped, so that the lines after it keep their numbers.
      const shown = note.text.replace(FENCED_CODE, (code) => code.replace(/[^\n]/g, ''))
      shown.split('\n').forEach((text, index) => {
        const links = [...text.matchAll(WIKILINK)]
        if (links.some((m) => this.resolve(m[1]!) === path)) {
          matches.push({ path: source, line: index + 1, text: text.trim() })
        }
      })
    }
    return matches
  }

  graph(): Graph {
    const links = new Map<string, Graph['links'][number]>()
    for (const [source, note] of this.notes) {
      for (const link of note.links) {
        const target = this.resolve(link)
        if (target && target !== source) links.set(`${source}\n${target}`, { source, target })
      }
    }
    return {
      nodes: [...this.notes].map(([path, note]) => ({ path, tags: note.tags })),
      links: [...links.values()],
    }
  }

  /** Notes whose path matches the query, best first. */
  searchNames(query: string, limit = 50): string[] {
    const wanted = query.trim().toLowerCase()
    const paths = [...this.notes.keys()]
    if (!wanted) return paths.sort().slice(0, limit)
    return paths
      .map((path) => ({ path, rank: rank(path.slice(0, -3).toLowerCase(), wanted) }))
      .filter((hit) => hit.rank !== null)
      .sort((a, b) => a.rank! - b.rank! || a.path.length - b.path.length)
      .slice(0, limit)
      .map((hit) => hit.path)
  }

  /** Lines containing the query, ignoring case. */
  searchText(query: string, limit = 200): LineMatch[] {
    const wanted = query.trim().toLowerCase()
    const matches: LineMatch[] = []
    if (!wanted) return matches
    for (const [path, note] of this.notes) {
      if (!note.text.toLowerCase().includes(wanted)) continue
      const lines = note.text.split('\n')
      for (let i = 0; i < lines.length && matches.length < limit; i++) {
        const text = lines[i]!
        if (text.toLowerCase().includes(wanted)) matches.push({ path, line: i + 1, text: text.trim() })
      }
      if (matches.length >= limit) break
    }
    return matches
  }

  /** Only notes named like the target can match, which keeps resolution fast. */
  private resolve(target: string): string | undefined {
    return resolveLink(target, this.byName().get(noteName(target).toLowerCase()) ?? [])
  }

  private byName(): Map<string, string[]> {
    if (this.names) return this.names
    this.names = new Map()
    for (const path of this.notes.keys()) {
      const name = noteName(path).toLowerCase()
      this.names.set(name, [...(this.names.get(name) ?? []), path])
    }
    return this.names
  }
}

function parse(text: string): Note {
  const body = text.replace(FENCED_CODE, '')
  const tags = [...body.matchAll(TAG)].map((m) => m[1]!)
  const declared = FRONTMATTER.exec(text)?.[1]?.match(FRONTMATTER_TAGS)?.[1]
  if (declared) {
    // Either `tags: [a, b]` / `tags: a, b` or a YAML list, one `- tag` per line.
    for (const line of declared.split(/\r?\n/)) {
      const items = line.replace(/^\s*-/, '').replace(/[[\]"']/g, '').split(',')
      tags.push(...items.map((tag) => tag.trim().replace(/^#/, '')).filter(Boolean))
    }
  }
  return {
    text,
    links: [...new Set([...body.matchAll(WIKILINK)].map((m) => m[1]!.trim()))],
    tags: [...new Set(tags)],
  }
}

/** Lower is better; null when `query` is not even a subsequence of `path`. */
function rank(path: string, query: string): number | null {
  const name = path.slice(path.lastIndexOf('/') + 1)
  if (name.includes(query)) return name.indexOf(query)
  if (path.includes(query)) return 100 + path.indexOf(query)
  let found = 0
  for (const char of path) if (char === query[found]) found++
  return found === query.length ? 1000 : null
}
