// @-mentions in the message box. The text decides what is attached: a note
// stays attached while its `@label` is in the message, and goes once it is not.

// The extension lets `node --test` load this file as it is.
import { noteName } from './links.ts'
import type { Entry } from './types'

/**
 * What a mention of `path` writes after the `@`: the note or folder's name,
 * or its path when another entry has the same name.
 */
export function mentionLabel(path: string, entries: readonly Entry[]): string {
  const name = noteName(path)
  const shared = entries.some((entry) => entry.path !== path && noteName(entry.path) === name)
  return shared ? path.replace(/\.md$/i, '') : name
}

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** `@label` as a whole token: after a space or the start, before a space, punctuation or the end. */
const token = (label: string) => new RegExp(`(^|\\s)@${escape(label)}(?=$|[\\s.,;:!?)\\]])`)

export function hasMention(text: string, label: string): boolean {
  return token(label).test(text)
}

/** Removes the first `@label` from the text, with the space that follows it. */
export function removeMention(text: string, label: string): string {
  const match = token(label).exec(text)
  if (!match) return text
  const start = match.index + match[1]!.length
  let end = start + 1 + label.length
  if (text[end] === ' ') end++
  return text.slice(0, start) + text.slice(end)
}

/** Drops the attachments whose mention is no longer in the text; others stay. */
export function pruneMentions<T extends { mention?: string }>(text: string, refs: readonly T[]): readonly T[] {
  const kept = refs.filter((ref) => ref.mention === undefined || hasMention(text, ref.mention))
  return kept.length === refs.length ? refs : kept
}

/**
 * Entries matching what was typed after `@`: names that start with it first,
 * then names that contain it, then paths that contain it. Notes come before
 * folders within each group.
 */
export function rankMentions(entries: readonly Entry[], query: string, limit = 8): Entry[] {
  const q = query.toLowerCase()
  const rank = (entry: Entry) => {
    const name = noteName(entry.path).toLowerCase()
    const group = name.startsWith(q) ? 0 : name.includes(q) ? 1 : entry.path.toLowerCase().includes(q) ? 2 : -1
    return group < 0 ? -1 : group * 2 + (entry.type === 'dir' ? 1 : 0)
  }
  return entries
    .map((entry) => ({ entry, rank: rank(entry) }))
    .filter(({ rank }) => rank >= 0)
    .sort((a, b) => a.rank - b.rank || a.entry.path.length - b.entry.path.length)
    .slice(0, limit)
    .map(({ entry }) => entry)
}
