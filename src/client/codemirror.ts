// CodeMirror setup for notes: Markdown with YAML frontmatter, math and
// wikilinks, a live preview, and a theme driven by the app's CSS variables.

import {
  autocompletion,
  closeBrackets,
  closeBracketsKeymap,
  pickedCompletion,
  type Completion,
  type CompletionContext,
  type CompletionResult,
} from '@codemirror/autocomplete'
import { indentWithTab } from '@codemirror/commands'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { yamlFrontmatter } from '@codemirror/lang-yaml'
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { languages } from '@codemirror/language-data'
import { unifiedMergeView } from '@codemirror/merge'
import { search, searchKeymap } from '@codemirror/search'
import { Compartment, EditorSelection, type Extension } from '@codemirror/state'
import { EditorView, keymap, type ViewUpdate } from '@codemirror/view'
import { classHighlighter, tags as t } from '@lezer/highlight'
import { minimalSetup } from 'codemirror'
import { noteName } from '../shared/links'
import { indentListItems, outdentListItems } from './lists'
import { livePreview } from './preview'
import { createSearchPanel } from './search-panel'
import { addToChatButton, type PickedText } from './selection'
import { useStore } from './store'
import { mathSyntax, noSetextHeadings, wikilinkSyntax } from './syntax'

/** Holds `EditorView.lineWrapping` or nothing, depending on the settings. */
export const lineWrap = new Compartment()

export function noteExtensions(
  onUpdate: (update: ViewUpdate) => void,
  onAddToChat: (picked: PickedText | null) => void,
): Extension {
  return [
    minimalSetup,
    yamlFrontmatter({ content: noteLanguage }),
    syntaxHighlighting(highlightStyle),
    // Code tokens get `tok-*` classes, coloured in styles.css.
    syntaxHighlighting(classHighlighter),
    lineWrap.of(EditorView.lineWrapping),
    closeBrackets(),
    autocompletion({ override: [completeWikilink], icons: false }),
    search({ top: true, createPanel: createSearchPanel }),
    keymap.of([
      ...closeBracketsKeymap,
      ...searchKeymap,
      // List items nest and renumber; anything else is plainly indented.
      { key: 'Tab', run: indentListItems, shift: outdentListItems },
      indentWithTab,
    ]),
    livePreview,
    lineClick,
    addToChatButton(onAddToChat),
    theme,
    EditorView.updateListener.of(onUpdate),
  ]
}

/**
 * Triple click selects the clicked line up to its end, without the line break
 * CodeMirror adds by default, so the caret stays on that line. Dragging
 * extends the selection by whole lines.
 */
const lineClick = EditorView.mouseSelectionStyle.of((view, start) => {
  if (start.button != 0 || start.detail < 3) return null
  const lineAt = (event: MouseEvent) => {
    const { from, to } = view.lineBlockAt(view.posAtCoords({ x: event.clientX, y: event.clientY }, false))
    return { from, to }
  }
  let first = lineAt(start)
  let startSel = view.state.selection
  return {
    update(update) {
      if (!update.docChanged) return
      first = { from: update.changes.mapPos(first.from), to: update.changes.mapPos(first.to) }
      startSel = startSel.map(update.changes)
    },
    get(event, extend, multiple) {
      const line = lineAt(event)
      const range = extend
        ? EditorSelection.range(line.from, line.to)
        : line.from < first.from
          ? EditorSelection.range(first.to, line.from)
          : EditorSelection.range(first.from, line.to)
      if (extend) return startSel.replaceRange(startSel.main.extend(range.from, range.to))
      if (multiple) return startSel.addRange(range)
      return EditorSelection.create([range])
    },
  }
})

/**
 * A note as plain source, for settling a conflict. `original` is one side and
 * the document the other; wherever they differ, the original's text is shown
 * above the document's, with a button to keep each. There is no live preview:
 * what is being compared is the text itself.
 */
export function mergeExtensions(original: string, onUpdate: (update: ViewUpdate) => void): Extension {
  return [
    minimalSetup,
    yamlFrontmatter({ content: noteLanguage }),
    syntaxHighlighting(highlightStyle),
    syntaxHighlighting(classHighlighter),
    EditorView.lineWrapping,
    EditorView.darkTheme.of(document.documentElement.classList.contains('dark')),
    theme,
    mergeTheme,
    unifiedMergeView({ original, mergeControls: chunkButton, gutter: false }),
    EditorView.updateListener.of(onUpdate),
  ]
}

/** The buttons over each difference: accepting keeps the document's text, rejecting the original's. */
function chunkButton(type: 'accept' | 'reject', action: (event: MouseEvent) => void): HTMLElement {
  const button = document.createElement('button')
  button.textContent = type === 'accept' ? 'Use incoming' : 'Keep local'
  button.onmousedown = action
  return button
}

const noteLanguage = markdown({
  base: markdownLanguage,
  // Grammars for fenced code blocks; each one is loaded the first time it is used.
  codeLanguages: languages,
  extensions: [mathSyntax, wikilinkSyntax, noSetextHeadings],
})

/** Markup characters (`#`, `**`, `>`, `---`, ...) step back so the text stands out. */
const markup = 'color-mix(in oklab, var(--muted-foreground) 60%, transparent)'

// The fonts picked in the settings; see components/Workspace.tsx.
const headingFont = 'var(--editor-font-heading, var(--font-sans))'
const textFont = 'var(--editor-font-text, var(--font-sans))'
const codeFont = 'var(--editor-font-code, var(--font-mono))'

const highlightStyle = HighlightStyle.define([
  { tag: t.heading1, fontFamily: headingFont, fontSize: '2.25em', fontWeight: '600', letterSpacing: '-0.025em', lineHeight: '1.2' },
  { tag: t.heading2, fontFamily: headingFont, fontSize: '1.35em', fontWeight: '600', letterSpacing: '-0.015em', lineHeight: '1.4' },
  { tag: t.heading3, fontFamily: headingFont, fontSize: '1.15em', fontWeight: '600' },
  { tag: [t.heading4, t.heading5, t.heading6], fontFamily: headingFont, fontWeight: '600' },
  { tag: t.strong, fontWeight: '600' },
  { tag: t.emphasis, fontStyle: 'italic' },
  { tag: t.strikethrough, textDecoration: 'line-through' },
  { tag: [t.link, t.url], color: 'var(--brand)' },
  { tag: t.monospace, fontFamily: codeFont, fontSize: '0.9em' },
  { tag: t.quote, color: 'var(--muted-foreground)' },
  { tag: [t.processingInstruction, t.meta, t.contentSeparator, t.comment], color: markup },
])

/** Suggests notes after `[[`. */
function completeWikilink(context: CompletionContext): CompletionResult | null {
  const open = context.matchBefore(/\[\[[^\]|#\n]*/)
  if (!open) return null
  const notes = useStore.getState().entries.filter((entry) => entry.type === 'file')
  const names = new Map<string, number>()
  for (const { path } of notes) names.set(noteName(path), (names.get(noteName(path)) ?? 0) + 1)
  return {
    from: open.from + 2,
    validFor: /^[^\]|#\n]*$/,
    options: notes.map(({ path }) => ({
      // A name shared by several notes is ambiguous, so link by path instead.
      label: names.get(noteName(path)) === 1 ? noteName(path) : path.slice(0, -3),
      detail: path,
      apply: insertWikilink,
    })),
  }
}

function insertWikilink(view: EditorView, completion: Completion, from: number, to: number): void {
  // `closeBrackets` has usually typed the closing brackets already.
  const closed = view.state.sliceDoc(to, to + 2) === ']]'
  view.dispatch({
    changes: { from, to, insert: completion.label + (closed ? '' : ']]') },
    selection: { anchor: from + completion.label.length + 2 },
    annotations: pickedCompletion.of(completion),
  })
}

const link = {
  color: 'var(--brand)',
  textDecoration: 'underline',
  textDecorationThickness: '1px',
  textUnderlineOffset: '3px',
}
const codeBorder = '1px solid var(--border)'
const popup = {
  backgroundColor: 'var(--popover)',
  color: 'var(--popover-foreground)',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius-lg)',
  boxShadow: 'var(--elevation-2)',
}

// The editor has no height of its own: it grows with the note and scrolls
// with the column around it (see components/Editor.tsx).
const theme = EditorView.theme({
  '&': {
    color: 'var(--foreground)',
    fontSize: 'var(--editor-font-size)',
    // CodeMirror stacks its layers with z-indexes up to 500 (its panels have 300).
    // Kept inside the editor, they stay under the app's tooltips, menus and dialogs.
    isolation: 'isolate',
  },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': { fontFamily: textFont, lineHeight: '1.75' },
  '.cm-content': { padding: '0', minHeight: '40vh', caretColor: 'var(--brand)' },
  // The room on the right is for the caret: at the end of a line that fills
  // the width, it would otherwise stick out and scroll the editor sideways.
  '.cm-line': { padding: '0 2px 0 0' },
  '.cm-cursor': { borderLeft: '2px solid var(--brand)' },
  '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground':
    { backgroundColor: 'var(--selection)' },
  '.cm-wikilink, .cm-link': link,
  '.cm-wikilink:hover, .cm-link:hover': { textDecorationThickness: '2px' },
  '.cm-list-prefix': { color: markup },
  '.cm-line.cm-code-line': {
    fontFamily: codeFont,
    fontSize: '0.87em',
    backgroundColor: 'var(--muted)',
    padding: '0 16px',
    borderLeft: codeBorder,
    borderRight: codeBorder,
  },
  '.cm-line.cm-code-first': {
    paddingTop: '10px',
    borderTop: codeBorder,
    borderRadius: 'var(--radius-lg) var(--radius-lg) 0 0',
  },
  '.cm-line.cm-code-last': {
    paddingBottom: '10px',
    borderBottom: codeBorder,
    borderRadius: '0 0 var(--radius-lg) var(--radius-lg)',
  },
  '.cm-line.cm-code-first.cm-code-last': { borderRadius: 'var(--radius-lg)' },
  // Vertical padding, not margin: block widgets must not have vertical margins.
  // The 2px at the sides absorb the sliver by which KaTeX's numbered equations
  // stick out, so only formulas that are really too wide get a scrollbar.
  // Wide formulas and tables scroll on their own: contained, their width does
  // not stretch the note, which would make the whole note scroll sideways.
  '.cm-math-block': { padding: '0.6em 2px', overflowX: 'auto', contain: 'inline-size' },
  '.cm-math-block .katex-display': { margin: '0' },
  '.cm-table': { padding: '0.5em 0', overflowX: 'auto', contain: 'inline-size' },
  '.cm-table table': { borderCollapse: 'collapse', whiteSpace: 'normal' },
  '.cm-table th, .cm-table td': {
    border: '1px solid var(--border)',
    padding: '4px 10px',
    verticalAlign: 'top',
    cursor: 'text',
    // Wrapped lines may break anywhere, which in a narrow table splits every
    // word: cells break between words, and the table scrolls when even that is too wide.
    overflowWrap: 'normal',
    wordBreak: 'normal',
  },
  '.cm-table th': { backgroundColor: 'var(--muted)', fontWeight: '600', textAlign: 'left' },
  '.cm-table code': {
    fontFamily: codeFont,
    fontSize: '0.9em',
    backgroundColor: 'var(--muted)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius-sm)',
    padding: '1px 4px',
  },
  // The search panel (search-panel.tsx) floats over the top of the note while it scrolls.
  '.cm-panels.cm-panels-top': { ...popup, top: '12px', marginBottom: '12px', fontSize: '13px' },
  '.cm-textfield, .cm-button': {
    fontSize: '12px',
    padding: '3px 8px',
    backgroundColor: 'var(--background)',
    backgroundImage: 'none',
    color: 'var(--foreground)',
    border: '1px solid var(--input)',
    borderRadius: 'var(--radius-sm)',
  },
  '.cm-searchMatch': { backgroundColor: 'var(--highlight)' },
  // The one the selection is on, where the arrows and Enter lead.
  '.cm-searchMatch.cm-searchMatch-selected': { backgroundColor: 'var(--highlight-current)' },
  '.cm-tooltip': { ...popup, overflow: 'hidden' },
  '.cm-tooltip.cm-tooltip-autocomplete > ul': { fontFamily: 'var(--font-sans)', padding: '4px' },
  '.cm-tooltip-autocomplete ul li': { borderRadius: 'var(--radius-sm)', padding: '2px 8px' },
  '.cm-tooltip-autocomplete ul li[aria-selected]': {
    backgroundColor: 'var(--accent)',
    color: 'var(--accent-foreground)',
  },
  '.cm-completionDetail': { opacity: '0.6', fontStyle: 'normal' },
  // "Add to chat" over selected text, only while the note has the focus.
  '&:not(.cm-focused) .cm-tooltip:has(> .cm-add-to-chat)': { display: 'none' },
  '.cm-add-to-chat': { padding: '3px' },
  '.cm-add-to-chat button': {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '2px 4px 2px 8px',
    fontFamily: 'var(--font-sans)',
    fontSize: '12px',
    fontWeight: '500',
    lineHeight: '20px',
    color: 'inherit',
    background: 'none',
    border: 'none',
    borderRadius: 'var(--radius-sm)',
    cursor: 'pointer',
  },
  '.cm-add-to-chat button:hover': { backgroundColor: 'var(--accent)', color: 'var(--accent-foreground)' },
  '.cm-add-to-chat kbd': {
    padding: '0 4px',
    fontFamily: 'var(--font-mono)',
    fontSize: '11px',
    color: 'var(--muted-foreground)',
    backgroundColor: 'var(--muted)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius-sm)',
  },
})

const mergeTheme = EditorView.theme({
  // The dialog around it decides how tall the editor is.
  '.cm-content': { minHeight: '0' },
  '.cm-deletedChunk': { padding: '0' },
  '.cm-deletedChunk .cm-chunkButtons': { insetInlineEnd: '0', display: 'flex', gap: '4px' },
  '.cm-deletedChunk button': {
    margin: '0',
    padding: '1px 8px',
    fontFamily: 'var(--font-sans)',
    fontSize: '12px',
    lineHeight: '1.5',
    color: 'var(--foreground)',
    backgroundColor: 'var(--background)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius-sm)',
  },
  '.cm-deletedChunk button:hover': { backgroundColor: 'var(--accent)' },
})
