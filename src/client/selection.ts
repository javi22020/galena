// "Add to chat" over selected text, and Mod-L to do the same from the
// keyboard. The button is a CodeMirror tooltip derived from the editor state,
// as https://codemirror.net/examples/tooltip/ recommends: a state field holds
// it and provides it to `showTooltip`.

import { Prec, StateEffect, StateField, type EditorState, type Extension } from '@codemirror/state'
import { EditorView, keymap, showTooltip, ViewPlugin, type Tooltip } from '@codemirror/view'
import { shortcut } from './lib/platform'

/** Text selected in a note, with the lines it spans (counted from 1). */
export interface PickedText {
  text: string
  lines: { from: number; to: number }
}

/** The main selection, or null when it is empty or only whitespace. */
export function pickedText(state: EditorState): PickedText | null {
  const { from, to } = state.selection.main
  const text = state.sliceDoc(from, to)
  if (!text.trim()) return null
  const first = state.doc.lineAt(from).number
  // A selection that ends at the start of a line does not take that line.
  const end = state.doc.lineAt(to)
  const last = end.from === to ? end.number - 1 : end.number
  return { text, lines: { from: first, to: last } }
}

/** Set while the mouse button is down, so the button waits until a drag ends. */
const setDragging = StateEffect.define<boolean>()

interface ButtonState {
  dragging: boolean
  tooltip: Tooltip | null
}

/**
 * Adds a button over selected text and binds Mod-L. `add` gets the selection,
 * or null to just go to the message box. The button shows only while the
 * editor has the focus (see the theme in codemirror.ts).
 */
export function addToChatButton(add: (picked: PickedText | null) => void): Extension {
  const run = (view: EditorView) => {
    add(pickedText(view.state))
    return true
  }

  const field = StateField.define<ButtonState>({
    create: (state) => ({ dragging: false, tooltip: tooltipFor(state, run) }),
    update(value, tr) {
      let dragging = value.dragging
      for (const effect of tr.effects) if (effect.is(setDragging)) dragging = effect.value
      if (tr.isUserEvent('select.pointer')) dragging = true
      if (dragging === value.dragging && !tr.selection && !tr.docChanged) return value
      return { dragging, tooltip: dragging ? null : tooltipFor(tr.state, run) }
    },
    provide: (f) => showTooltip.from(f, (value) => value.tooltip),
  })

  // The mouse may be released outside the editor, so this listens on the window.
  const dragEnd = ViewPlugin.define((view) => {
    const onUp = () => {
      if (view.state.field(field).dragging) view.dispatch({ effects: setDragging.of(false) })
    }
    window.addEventListener('mouseup', onUp)
    return { destroy: () => window.removeEventListener('mouseup', onUp) }
  })

  return [field, dragEnd, Prec.high(keymap.of([{ key: 'Mod-l', run, preventDefault: true }]))]
}

/** The button over the end of the selection the user moved, on the side away from the text. */
function tooltipFor(state: EditorState, run: (view: EditorView) => boolean): Tooltip | null {
  if (!pickedText(state)) return null
  const { head, anchor } = state.selection.main
  return {
    pos: head,
    above: head < anchor,
    create(view) {
      const dom = document.createElement('div')
      dom.className = 'cm-add-to-chat'
      const button = document.createElement('button')
      button.type = 'button'
      button.setAttribute('aria-keyshortcuts', 'Control+L Meta+L')
      const label = document.createElement('span')
      label.textContent = 'Add to chat'
      const key = document.createElement('kbd')
      key.textContent = shortcut('L')
      button.append(label, key)
      // Keeps the focus, and so the selection, in the editor.
      button.onmousedown = (event) => event.preventDefault()
      button.onclick = () => run(view)
      dom.append(button)
      return { dom }
    },
  }
}
