// Image links in notes: where the browser loads them from, which ones the
// preview shows, and how a pasted image is linked from the note it was
// pasted into.

import type { EditorState } from '@codemirror/state'
import type { SyntaxNode } from '@lezer/common'
import { parentOf } from '../shared/links'
import { api } from './api'

/** Stands for the vault root when resolving links as URLs. */
const VAULT = 'http://vault.invalid'

/**
 * Where the browser loads the image a link in a note points to: a path,
 * relative to the note's folder, through the server; a web address as it is;
 * null for anything else (`data:`, `file:`, a malformed address).
 */
export function imageSrc(url: string, note: string): string | null {
  const folder = parentOf(note)
  const base = `${VAULT}/${folder && `${folder.split('/').map(encodeURIComponent).join('/')}/`}`
  try {
    const target = new URL(url.replace(/^<(.*)>$/, '$1'), base)
    if (target.origin !== VAULT) return /^https?:$/.test(target.protocol) ? target.href : null
    return api.imageUrl(decodeURIComponent(target.pathname.slice(1)))
  } catch {
    return null // a malformed URL
  }
}

/**
 * The address of an `Image` node that the preview shows, as written in the
 * note; null for one that cannot be loaded, and inside a table, which is
 * rendered without images.
 */
export function shownImage(state: EditorState, node: SyntaxNode): string | null {
  for (let parent = node.parent; parent; parent = parent.parent) {
    if (parent.name === 'Table') return null
  }
  const url = node.getChild('URL')
  const text = url && state.sliceDoc(url.from, url.to)
  // Whether it can be loaded does not depend on the note it is in.
  return text && imageSrc(text, '') !== null ? text : null
}

/**
 * A vault path as a link from a folder: `assets/a.png` from `notes/deep` is
 * `../../assets/a.png`. The server names images with letters, digits, `-`
 * and `_` only, so their links need no escaping.
 */
export function relativeUrl(folder: string, path: string): string {
  const from = folder ? folder.split('/') : []
  const to = path.split('/')
  let common = 0
  while (common < from.length && common < to.length - 1 && from[common] === to[common]) common++
  return [...from.slice(common).map(() => '..'), ...to.slice(common)].join('/')
}
