/** `folder/My note.md` -> `My note` */
export function noteName(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1).replace(/\.md$/i, '')
}

/** `folder/My note.md` -> `folder`; empty for the vault root. */
export function parentOf(path: string): string {
  return path.slice(0, Math.max(path.lastIndexOf('/'), 0))
}

/**
 * `[[folder/Note#Heading|alias]]` inner text -> `folder/Note`.
 * Inside a table the pipe is escaped (`Note\|alias`), hence the backslash.
 */
export function linkTarget(inner: string): string {
  return inner.split('|')[0]!.replace(/\\$/, '').split('#')[0]!.trim()
}

/**
 * Resolves a wikilink target the way Obsidian does: an exact vault path wins,
 * otherwise the shortest note path that ends with the target.
 */
export function resolveLink(target: string, notes: Iterable<string>): string | undefined {
  const wanted = target.trim().replace(/\.md$/i, '').toLowerCase()
  let best: string | undefined
  for (const path of notes) {
    const bare = path.slice(0, -3).toLowerCase()
    if (bare === wanted) return path
    if (bare.endsWith(`/${wanted}`) && (!best || path.length < best.length)) best = path
  }
  return best
}
