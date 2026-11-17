import { useEffect, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { CodeBlock, CodeBlockActions, CodeBlockHeader, CodeBlockTitle } from '@/components/ui/code-block'
import type { GitDiff as FileDiff } from '../../shared/types'
import { api } from '../api'
import { gitNote, openGitFile, setModal, showError, useStore } from '../store'
import { ConfirmDialog, type Confirmation } from './ConfirmDialog'
import { Diff } from './Diff'
import { discardRequest } from './GitPanel'
import { Modal } from './Modal'

/** What a file has that its last commit did not. */
export function GitDiff() {
  return (
    <Modal name="diff" title="Changes since the last commit" className="sm:max-w-4xl">
      <GitDiffBody />
    </Modal>
  )
}

function GitDiffBody() {
  const file = useStore((s) => s.git?.files.find((candidate) => candidate.path === s.gitFile))
  const merging = useStore((s) => s.git?.state === 'merging')
  const fsTick = useStore((s) => s.fsTick)
  const [diff, setDiff] = useState<FileDiff | null>(null)
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null)
  const path = file?.path
  const status = file?.status
  const entries = useStore((s) => s.entries)

  // Once committed or discarded, the file has no changes left to show.
  useEffect(() => {
    if (!path) setModal(null)
  }, [path])

  useEffect(() => {
    if (!path) return
    let stale = false
    api.gitDiff(path).then(
      (loaded) => stale || setDiff(loaded),
      (error) => stale || showError(error),
    )
    return () => void (stale = true)
  }, [path, status, fsTick])

  if (!file) return null
  const isNote = gitNote(file.path, entries) !== undefined
  const open = () => {
    openGitFile(file.path)
    setModal(null)
  }

  return (
    <div className="flex min-h-0 flex-col overflow-y-auto p-4">
      <CodeBlock className="shrink-0">
        <CodeBlockHeader>
          <CodeBlockTitle>
            {isNote ? (
              <button
                className="font-mono text-xs outline-none hover:underline focus-visible:underline"
                onClick={open}
              >
                {file.path}
              </button>
            ) : (
              <span className="font-mono text-xs">{file.path}</span>
            )}
          </CodeBlockTitle>
          <Badge variant="secondary">{file.status === 'added' ? 'new' : file.status}</Badge>
          {!merging && (
            <CodeBlockActions className="text-foreground">
              <Button variant="outline" size="sm" onClick={() => setConfirmation(discardRequest(file))}>
                Discard
              </Button>
            </CodeBlockActions>
          )}
        </CodeBlockHeader>
        {diff?.image ? (
          <div className="flex flex-wrap items-end justify-center gap-4 p-4">
            {file.status !== 'added' && <GitImage path={file.path} side="before" version={fsTick} />}
            {file.status !== 'deleted' && <GitImage path={file.path} side="after" version={fsTick} />}
          </div>
        ) : diff?.binary ? (
          <p className="px-4 py-6 text-center text-muted-foreground">This file is not text.</p>
        ) : (
          diff && <Diff before={diff.before ?? ''} after={diff.after ?? ''} className="max-h-[60vh]" />
        )}
      </CodeBlock>
      <ConfirmDialog request={confirmation} onClose={() => setConfirmation(null)} />
    </div>
  )
}

/** One side of a changed image. `version` changes with the files on disk, so the browser loads it again. */
function GitImage({ path, side, version }: { path: string; side: 'before' | 'after'; version: number }) {
  return (
    <figure className="flex min-w-0 flex-col items-center gap-2">
      <img src={`${api.gitImageUrl(path, side)}&v=${version}`} alt="" className="max-h-[50vh] max-w-full" />
      <figcaption className="text-xs text-muted-foreground">{side === 'before' ? 'Last commit' : 'Now'}</figcaption>
    </figure>
  )
}
