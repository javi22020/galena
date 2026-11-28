// The app's keyboard shortcuts, all in one place: their keys, what they are
// called, and how they are written in the interface, so that what a tooltip
// says is always what works.
//
// One listener on the window catches them before the editor or any field
// does. Keys that only mean something to what has the focus (Enter in a
// list, Escape in a dialog, Tab in a note, the editor's search keys) stay
// with that component.

import { useEffect, useRef } from 'react'
import { mac } from './lib/platform'

export interface Keys {
  /** ⌘ on a Mac, Ctrl elsewhere. */
  mod?: boolean
  /** Ctrl everywhere, where ⌘ is taken on a Mac (⌘Space is Spotlight). */
  ctrl?: boolean
  shift?: boolean
  alt?: boolean
  /** A letter, matched whatever the case; or a key by its `KeyboardEvent.code`, such as `Space`. */
  key: string
}

export const shortcuts = {
  palette: { keys: { mod: true, key: 'k' }, name: 'Search the vault' },
  save: { keys: { mod: true, key: 's' }, name: 'Save the note' },
  dictate: { keys: { ctrl: true, shift: true, key: 'Space' }, name: 'Start or end a dictation' },
  /** Bound in the editor (selection.ts), as it acts on the selection; listed here for its label. */
  addToChat: { keys: { mod: true, key: 'l' }, name: 'Add the selection to the chat' },
} as const satisfies Record<string, { keys: Keys; name: string }>

export type ShortcutId = keyof typeof shortcuts

/**
 * Whether a key press is the given keys. A letter is matched by what it types,
 * as the browser's own shortcuts are, whatever the case (Caps Lock); on a
 * layout whose letters are not Latin, by where it is on the keyboard.
 */
export function matches(event: KeyboardEvent, keys: Keys, onMac = mac): boolean {
  const ctrl = !!keys.ctrl || (!!keys.mod && !onMac)
  const meta = !!keys.mod && onMac
  if (event.ctrlKey !== ctrl || event.metaKey !== meta) return false
  if (event.shiftKey !== !!keys.shift || event.altKey !== !!keys.alt) return false
  if (keys.key.length > 1) return event.code === keys.key
  const typed = event.key.toLowerCase()
  if (typed === keys.key) return true
  return !/^[a-z]$/.test(typed) && event.code === `Key${keys.key.toUpperCase()}`
}

/** How a shortcut is written for people: "⌘K" or "Ctrl K", "⌃⇧Space" or "Ctrl Shift Space". */
export function shortcutLabel(id: ShortcutId, onMac = mac): string {
  const keys: Keys = shortcuts[id].keys
  const key = keys.key.length > 1 ? keys.key : keys.key.toUpperCase()
  if (onMac) {
    return [keys.ctrl && '⌃', keys.alt && '⌥', keys.shift && '⇧', keys.mod && '⌘', key].filter(Boolean).join('')
  }
  return [(keys.ctrl || keys.mod) && 'Ctrl', keys.alt && 'Alt', keys.shift && 'Shift', key].filter(Boolean).join(' ')
}

/** The shortcut as `aria-keyshortcuts` wants it: "Control+Shift+Space". */
export function ariaShortcut(id: ShortcutId, onMac = mac): string {
  const keys: Keys = shortcuts[id].keys
  const key = keys.key.length > 1 ? keys.key : keys.key.toUpperCase()
  const ctrl = keys.ctrl || (keys.mod && !onMac)
  return [ctrl && 'Control', keys.mod && onMac && 'Meta', keys.alt && 'Alt', keys.shift && 'Shift', key]
    .filter(Boolean)
    .join('+')
}

/** The shortcut as a CodeMirror key binding: "Mod-l". */
export function codeMirrorKey(id: ShortcutId): string {
  const keys: Keys = shortcuts[id].keys
  return [keys.mod && 'Mod', keys.ctrl && 'Ctrl', keys.alt && 'Alt', keys.shift && 'Shift', keys.key].filter(Boolean).join('-')
}

/** What each shortcut does right now; one handler per shortcut, the last one set. */
const handlers = new Map<ShortcutId, () => void>()

/**
 * Has the shortcut run `run` while the component is mounted and `enabled`.
 * The handler may change from render to render without being set again.
 */
export function useShortcut(id: ShortcutId, run: () => void, enabled = true): void {
  const latest = useRef(run)
  useEffect(() => {
    latest.current = run
  })
  useEffect(() => {
    if (!enabled) return
    const handler = () => latest.current()
    handlers.set(id, handler)
    return () => {
      if (handlers.get(id) === handler) handlers.delete(id)
    }
  }, [id, enabled])
}

/**
 * Listens for the shortcuts; called once at startup. In the capture phase,
 * so that a field or the editor cannot take them first. A shortcut with no
 * handler at the moment is left alone, for the browser or the editor.
 */
export function listenForShortcuts(): void {
  window.addEventListener(
    'keydown',
    (event) => {
      if (event.isComposing) return
      for (const [id, run] of handlers) {
        if (!matches(event, shortcuts[id].keys)) continue
        event.preventDefault()
        event.stopPropagation()
        // A press, not a hold: a key kept down does not run it again.
        if (!event.repeat) run()
        return
      }
    },
    true,
  )
}
