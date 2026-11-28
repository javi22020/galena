import { expect, test } from 'vitest'
import { ariaShortcut, codeMirrorKey, matches, shortcutLabel, shortcuts } from './shortcuts'

/** A key press as the browser describes it; modifiers default to up. */
function press(key: string, code: string, mods: Partial<KeyboardEvent> = {}): KeyboardEvent {
  return { key, code, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, ...mods } as KeyboardEvent
}

const palette = shortcuts.palette.keys
const dictate = shortcuts.dictate.keys

test('Mod is Ctrl off a Mac and ⌘ on one, and not the other', () => {
  expect(matches(press('k', 'KeyK', { ctrlKey: true }), palette, false)).toBe(true)
  expect(matches(press('k', 'KeyK', { metaKey: true }), palette, false)).toBe(false)
  expect(matches(press('k', 'KeyK', { metaKey: true }), palette, true)).toBe(true)
  expect(matches(press('k', 'KeyK', { ctrlKey: true }), palette, true)).toBe(false)
})

test('a letter works with Caps Lock, and on a layout without Latin letters by its place', () => {
  expect(matches(press('K', 'KeyK', { ctrlKey: true }), palette, false)).toBe(true)
  // Russian: the K key types "л".
  expect(matches(press('л', 'KeyK', { ctrlKey: true }), palette, false)).toBe(true)
  // Dvorak: the key in QWERTY's K place types "t", so it is not Ctrl+K.
  expect(matches(press('t', 'KeyK', { ctrlKey: true }), palette, false)).toBe(false)
})

test('extra modifiers make it another shortcut', () => {
  expect(matches(press('K', 'KeyK', { ctrlKey: true, shiftKey: true }), palette, false)).toBe(false)
  expect(matches(press('k', 'KeyK', { ctrlKey: true, altKey: true }), palette, false)).toBe(false)
})

test('dictation is Ctrl+Shift+Space on every platform, by the key itself', () => {
  for (const mac of [false, true]) {
    expect(matches(press(' ', 'Space', { ctrlKey: true, shiftKey: true }), dictate, mac)).toBe(true)
    expect(matches(press(' ', 'Space', { metaKey: true, shiftKey: true }), dictate, mac)).toBe(false)
    expect(matches(press(' ', 'Space', { ctrlKey: true }), dictate, mac)).toBe(false)
  }
})

test('shortcuts are written the way each platform writes them', () => {
  expect(shortcutLabel('palette', false)).toBe('Ctrl K')
  expect(shortcutLabel('palette', true)).toBe('⌘K')
  expect(shortcutLabel('dictate', false)).toBe('Ctrl Shift Space')
  expect(shortcutLabel('dictate', true)).toBe('⌃⇧Space')
  expect(ariaShortcut('palette', false)).toBe('Control+K')
  expect(ariaShortcut('palette', true)).toBe('Meta+K')
  expect(ariaShortcut('dictate', true)).toBe('Control+Shift+Space')
  expect(codeMirrorKey('addToChat')).toBe('Mod-l')
})
