import { getChunks } from '@codemirror/merge'
import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import type { GitConflict, GitResolution } from '../../shared/types'
import { api } from '../api'
import { mergeExtensions } from '../codemirror'
import { runGit, setModal, showError, useStore } from '../store'
import { Modal } from './Modal'

/** Settles a file that two branches changed in the same place. */
export function MergeResolver() {
  const path = useStore((s) => s.gitFile)
  return (
    <Modal name="conflict" title={`Resolve ${path ?? 'conflict'}`} className="sm:max-w-4xl">
      {path && <MergeResolverBody key={path} path={path} />}
    </Modal>
  )
}

function MergeResolverBody({ path }: { path: string }) {
  const busy = useStore((s) => s.gitBusy)
  const conflicted = useStore((s) =>
    s.git?.files.some((file) => file.path === path && file.status === 'conflict'),
  )
  const [conflict, setConflict] = useState<GitConflict | null>(null)

  // Resolved, here or from a terminal: there is nothing left to do.
  useEffect(() => {
    if (!conflicted) setModal(null)
  }, [conflicted])

  useEffect(() => {
    let stale = false
    api.gitConflict(path).then(
      (loaded) => stale || setConflict(loaded),
      (error) => {
        if (stale) return
        showError(error)
        setModal(null)
      },
    )
    return () => void (stale = true)
  }, [path])

  const resolve = (resolution: GitResolution) => void runGit('resolve', { path, ...resolution })

  if (!conflict) return <p className="p-6 text-center text-muted-foreground">Loading…</p>
  const { local, incoming } = conflict
  if (!conflict.binary && local !== null && incoming !== null) {
    return (
      <TextMerge local={local} incoming={incoming} settled={conflict.settled} busy={busy} onResolve={resolve} />
    )
  }

  // Nothing to merge by hand: one side deleted the file, or it is not text.
  const about = (side: string | null) => (conflict.binary ? '' : side === null ? ' (deleted)' : ' (changed)')
  return (
    <div className="flex flex-col gap-4 p-4">
      <p className="text-muted-foreground">
        {conflict.binary
          ? 'This file is not text, so it cannot be merged here. Keep one of the two versions.'
          : 'One side deleted this file and the other changed it. Keep one of the two.'}
      </p>
      <div className="flex justify-end gap-2">
        <Button variant="outline" disabled={busy} onClick={() => resolve({ side: 'local' })}>
          Keep local{about(local)}
        </Button>
        <Button variant="outline" disabled={busy} onClick={() => resolve({ side: 'incoming' })}>
          Use incoming{about(incoming)}
        </Button>
      </div>
    </div>
  )
}

interface TextMergeProps {
  local: string
  incoming: string
  /** The file was already settled by hand, outside this view. */
  settled: boolean
  busy: boolean
  onResolve: (resolution: GitResolution) => void
}

/**
 * The incoming version, with the local text shown wherever the two conflict.
 * Each conflict is settled with its buttons, or by editing the text.
 */
function TextMerge({ local, incoming, settled, busy, onResolve }: TextMergeProps) {
  const host = useRef<HTMLDivElement>(null)
  const view = useRef<EditorView>(null)
  // What still has two buttons on it: the conflicts, and any edit made here.
  const [left, setLeft] = useState(0)

  useEffect(() => {
    const count = (state: EditorState) => setLeft(getChunks(state)?.chunks.length ?? 0)
    const state = EditorState.create({
      doc: incoming,
      extensions: mergeExtensions(local, (update) => count(update.state)),
    })
    const editor = new EditorView({ state, parent: host.current! })
    view.current = editor
    count(state)
    return () => editor.destroy()
  }, [local, incoming])

  return (
    <>
      {settled && (
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b bg-sidebar px-4 py-2 text-[13px]">
          <span className="min-w-40 flex-1">
            The note has no conflict markers left: it was already edited by hand. What is below starts over
            from the two versions.
          </span>
          <Button variant="outline" size="sm" disabled={busy} onClick={() => onResolve({ side: 'disk' })}>
            Keep the note as it is
          </Button>
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
        <div ref={host} />
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-t px-4 py-3">
        <p className="min-w-40 flex-1 text-[13px] text-muted-foreground">
          {left
            ? `${left} ${left === 1 ? 'difference' : 'differences'} left to decide. Where you choose nothing, the incoming text stays.`
            : 'Nothing left to decide.'}
        </p>
        {/* Each side as a whole still has everything that merged without conflict. */}
        <Button variant="outline" disabled={busy} onClick={() => onResolve({ content: local })}>
          Keep all local
        </Button>
        <Button variant="outline" disabled={busy} onClick={() => onResolve({ content: incoming })}>
          Use all incoming
        </Button>
        <Button disabled={busy} onClick={() => onResolve({ content: view.current!.state.doc.toString() })}>
          Mark resolved
        </Button>
      </div>
    </>
  )
}
