import { EditorState, type ChangeSpec, type Text } from '@codemirror/state'
import { EditorView, type ViewUpdate } from '@codemirror/view'
import { api } from './api'
import { lineWrap, noteExtensions } from './codemirror'
import type { PickedText } from './selection'
import { addToChat, closeTab, editorHooks, onFsEvent, patchTab, showError, useStore, type FsEvent } from './store'

const AUTOSAVE_MS = 800

/**
 * Drives the single CodeMirror view behind the tab bar. Each tab keeps its own
 * editor state (and so its undo history); the note on screen is saved shortly
 * after every edit and kept in sync with changes made on disk.
 */
export class NoteEditor {
  private view: EditorView
  private extensions = noteExtensions(
    (update) => this.onUpdate(update),
    (picked) => this.addToChat(picked),
  )
  /** Editor state of every loaded tab that is not on screen. */
  private states = new Map<number, EditorState>()
  /** What each loaded tab is known to contain on disk. */
  private saved = new Map<number, Text>()
  /** The tab whose state is in the view. */
  private shown: number | null = null
  /** The tab that should end up on screen; differs from `shown` while it loads. */
  private wanted: number | null = null
  private saveTimer?: number
  private unsubscribe: (() => void)[]

  constructor(parent: HTMLElement) {
    this.view = new EditorView({ parent })
    editorHooks.flush = () => this.save()
    editorHooks.insert = (text) => this.insert(text)
    this.unsubscribe = [
      onFsEvent((event) => void this.onFsEvent(event)),
      useStore.subscribe((state, previous) => {
        if (state.active !== previous.active) void this.show(state.active)
        if (state.tabs !== previous.tabs) this.forgetClosedTabs()
        if (state.reveal !== previous.reveal) this.reveal()
        if (state.settings.editor !== previous.settings.editor) this.applySettings()
      }),
    ]
    void this.show(useStore.getState().active)
  }

  destroy(): void {
    void this.save()
    for (const unsubscribe of this.unsubscribe) unsubscribe()
    this.view.destroy()
  }

  /** Attaches the selected text, if any, to the message being written and goes there. */
  private addToChat(picked: PickedText | null): void {
    const path = tabById(this.shown)?.path
    if (!path) return
    addToChat(picked ? { path, selection: picked.text, lines: picked.lines } : undefined)
  }

  /** Writes the note on screen to disk if it has unsaved edits. */
  async save(): Promise<void> {
    clearTimeout(this.saveTimer)
    const id = this.shown
    const tab = tabById(id)
    const previous = id === null ? undefined : this.saved.get(id)
    if (id === null || !tab || !previous || tab.conflict) return
    const doc = this.view.state.doc
    if (doc.eq(previous)) return

    // Recorded before the request, so the file event it causes is known to be ours.
    this.saved.set(id, doc)
    try {
      await api.write(tab.path, doc.toString())
    } catch (error) {
      if (this.saved.get(id) === doc) this.saved.set(id, previous)
      showError(error)
    }
    this.syncDirty(id)
  }

  /**
   * Types `text` at the cursor of the note on screen, over the selection, with
   * a space between it and the words around it. Only while the note has the
   * focus, so that text never lands where the user is not writing; and not
   * while it waits for a conflict to be settled, whose edits could be lost.
   */
  insert(text: string): boolean {
    const id = this.shown
    if (id === null || id !== useStore.getState().active || !this.view.hasFocus || tabById(id)?.conflict) return false
    const { state } = this.view
    const { from, to } = state.selection.main
    const glue = (char: string) => (char && !/\s/.test(char) ? ' ' : '')
    const insert = glue(state.sliceDoc(Math.max(0, from - 1), from)) + text + glue(state.sliceDoc(to, to + 1))
    this.view.dispatch({
      changes: { from, to, insert },
      selection: { anchor: from + insert.length },
      scrollIntoView: true,
      userEvent: 'input.dictate',
    })
    return true
  }

  /** Settles a conflict by keeping the editor's version or the one on disk. */
  async resolveConflict(id: number, keep: 'mine' | 'disk'): Promise<void> {
    const tab = tabById(id)
    if (!tab) return
    if (keep === 'disk') this.load(id, await api.read(tab.path))
    patchTab(id, { conflict: false })
    if (keep === 'mine') await this.save()
  }

  private async show(id: number | null): Promise<void> {
    void this.save()
    if (this.shown !== null) this.states.set(this.shown, this.view.state)
    this.shown = null
    this.wanted = id
    const tab = tabById(id)
    if (id === null || !tab) return

    if (!this.states.has(id)) {
      try {
        const state = this.createState(await api.read(tab.path))
        this.states.set(id, state)
        this.saved.set(id, state.doc)
      } catch (error) {
        showError(error)
        return void closeTab(id)
      }
      if (this.wanted !== id) return // another tab was selected meanwhile
    }

    this.view.setState(this.states.get(id)!)
    this.states.delete(id)
    this.shown = id
    this.applySettings()
    this.reveal()
    this.view.focus()
  }

  private createState(content: string): EditorState {
    return EditorState.create({ doc: content, extensions: this.extensions })
  }

  private onUpdate(update: ViewUpdate): void {
    if (!update.docChanged || this.shown === null) return
    this.syncDirty(this.shown)
    clearTimeout(this.saveTimer)
    this.saveTimer = window.setTimeout(() => void this.save(), AUTOSAVE_MS)
  }

  private async onFsEvent({ event, path }: FsEvent): Promise<void> {
    const tab = useStore.getState().tabs.find((t) => t.path === path)
    if (!tab) return
    // A deleted note closes, unless unsaved edits would be lost with it.
    if (event === 'unlink') return void (tab.dirty || closeTab(tab.id))

    const saved = this.saved.get(tab.id)
    if (!saved) return // not loaded yet, so there is nothing to keep in sync
    const disk = await api.read(path).catch(() => null)
    // Nothing to do if the file is gone, was saved again meanwhile, or the event is our own save.
    if (disk === null || this.saved.get(tab.id) !== saved || disk === saved.toString()) return

    const doc = this.docOf(tab.id)
    if (!doc) return
    if (doc.eq(saved) || doc.toString() === disk) this.load(tab.id, disk)
    else patchTab(tab.id, { conflict: true })
  }

  /** Replaces a tab's content with what is on disk. */
  private load(id: number, content: string): void {
    if (id !== this.shown) {
      const state = this.createState(content)
      this.states.set(id, state)
      this.saved.set(id, state.doc)
    } else {
      const change = minimalChange(this.view.state.doc.toString(), content)
      const transaction = this.view.state.update({ changes: change })
      this.saved.set(id, transaction.state.doc)
      this.view.dispatch(transaction)
    }
    this.syncDirty(id)
  }

  private docOf(id: number): Text | undefined {
    return id === this.shown ? this.view.state.doc : this.states.get(id)?.doc
  }

  private syncDirty(id: number): void {
    const doc = this.docOf(id)
    const saved = this.saved.get(id)
    const tab = tabById(id)
    if (!doc || !saved || !tab) return
    const dirty = !doc.eq(saved)
    if (dirty !== tab.dirty) patchTab(id, { dirty })
  }

  private forgetClosedTabs(): void {
    for (const id of this.saved.keys()) {
      if (tabById(id)) continue
      this.states.delete(id)
      this.saved.delete(id)
    }
  }

  /** Scrolls to the line requested by `openNote(path, line)`. */
  private reveal(): void {
    const { reveal } = useStore.getState()
    if (!reveal || reveal.id !== this.shown) return
    const { doc } = this.view.state
    const line = doc.line(Math.min(Math.max(reveal.line, 1), doc.lines))
    this.view.dispatch({
      selection: { anchor: line.from },
      effects: EditorView.scrollIntoView(line.from, { y: 'center' }),
    })
    useStore.setState({ reveal: null })
  }

  private applySettings(): void {
    const { lineWrap: wrap } = useStore.getState().settings.editor
    this.view.dispatch({ effects: lineWrap.reconfigure(wrap ? EditorView.lineWrapping : []) })
  }
}

function tabById(id: number | null) {
  return useStore.getState().tabs.find((tab) => tab.id === id)
}

/**
 * The smallest single replacement turning `from` into `to`. Replacing only what
 * differs keeps the cursor and scroll position when a note changes on disk.
 */
function minimalChange(from: string, to: string): ChangeSpec {
  let start = 0
  const limit = Math.min(from.length, to.length)
  while (start < limit && from[start] === to[start]) start++
  let fromEnd = from.length
  let toEnd = to.length
  while (fromEnd > start && toEnd > start && from[fromEnd - 1] === to[toEnd - 1]) {
    fromEnd--
    toEnd--
  }
  return { from: start, to: fromEnd, insert: to.slice(start, toEnd) }
}
