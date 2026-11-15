// Puts the find-and-replace panel (components/SearchPanel.tsx) where
// CodeMirror's own would go. CodeMirror's search extension still holds the
// query and does the searching; see `search()` in codemirror.ts.

import { getSearchQuery } from '@codemirror/search'
import type { EditorState } from '@codemirror/state'
import type { EditorView, Panel } from '@codemirror/view'
import { flushSync } from 'react-dom'
import { createRoot } from 'react-dom/client'
import { SearchPanel, type Snapshot } from '@/components/SearchPanel'
import { TooltipProvider } from '@/components/ui/tooltip'
import { countMatches } from './search'

function snapshotOf(state: EditorState): Snapshot {
  const query = getSearchQuery(state)
  return { query, matches: countMatches(state, query), readOnly: state.readOnly }
}

/** Builds the panel when it opens; for `search({ createPanel })`. */
export function createSearchPanel(view: EditorView): Panel {
  let snapshot = snapshotOf(view.state)
  const listeners = new Set<() => void>()
  const store = {
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => void listeners.delete(listener)
    },
    get: () => snapshot,
  }

  const dom = document.createElement('div')
  const root = createRoot(dom)
  // Rendered at once, so that the find field is there to focus when the panel mounts.
  flushSync(() =>
    root.render(
      <TooltipProvider delayDuration={400}>
        <SearchPanel view={view} store={store} />
      </TooltipProvider>,
    ),
  )

  return {
    dom,
    top: true,
    mount() {
      // `openSearchPanel` looks for `main-field` too, when the panel is open already.
      const field = dom.querySelector<HTMLInputElement>('[main-field]')
      field?.focus()
      field?.select()
    },
    update(update) {
      const { state } = update
      const changed =
        update.docChanged ||
        update.selectionSet ||
        getSearchQuery(state) !== snapshot.query ||
        state.readOnly !== snapshot.readOnly
      if (!changed) return
      snapshot = snapshotOf(state)
      for (const listener of listeners) listener()
    },
    // The panel may be closing from one of its own buttons, while React handles the click.
    destroy: () => queueMicrotask(() => root.unmount()),
  }
}
