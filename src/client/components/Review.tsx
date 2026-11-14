import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { CodeBlock, CodeBlockActions, CodeBlockHeader, CodeBlockTitle } from '@/components/ui/code-block'
import { api } from '../api'
import { openNote, setModal, showError, useStore } from '../store'
import { Diff } from './Diff'
import { Modal } from './Modal'

/** Per-file diff of what agents wrote, to accept or reject. */
export function Review() {
  return (
    <Modal name="review" title="Review agent changes" className="sm:max-w-4xl">
      <ReviewBody />
    </Modal>
  )
}

function ReviewBody() {
  const changes = useStore((s) => s.changes)
  const tabs = useStore((s) => s.tabs)

  const resolve = (action: 'accept' | 'reject', paths?: string[]) =>
    api.resolveChanges(action, paths).catch(showError)

  const open = (path: string) => {
    openNote(path)
    setModal(null)
  }

  return (
    <div className="flex min-h-0 flex-col gap-3 overflow-y-auto p-4">
      {!changes.length && <p className="py-6 text-center text-muted-foreground">Nothing to review.</p>}
      {changes.length > 1 && (
        <div className="flex shrink-0 justify-end gap-2">
          <Button variant="outline" onClick={() => resolve('reject')}>
            Reject all
          </Button>
          <Button onClick={() => resolve('accept')}>Accept all</Button>
        </div>
      )}
      {changes.map(({ path, before, after }) => (
        <CodeBlock key={path} className="shrink-0">
          <CodeBlockHeader>
            <CodeBlockTitle>
              <button
                className="font-mono text-xs outline-none hover:underline focus-visible:underline"
                onClick={() => open(path)}
              >
                {path}
              </button>
            </CodeBlockTitle>
            {before === null && <Badge variant="secondary">new</Badge>}
            {tabs.some((tab) => tab.path === path && tab.conflict) && (
              <Badge
                variant="outline"
                className="border-warning/50 text-warning"
                title="The note has unsaved edits in the editor"
              >
                conflict
              </Badge>
            )}
            <CodeBlockActions className="text-foreground">
              <Button variant="outline" size="sm" onClick={() => resolve('reject', [path])}>
                Reject
              </Button>
              <Button size="sm" onClick={() => resolve('accept', [path])}>
                Accept
              </Button>
            </CodeBlockActions>
          </CodeBlockHeader>
          <Diff before={before ?? ''} after={after} className="max-h-[50vh]" />
        </CodeBlock>
      ))}
    </div>
  )
}
