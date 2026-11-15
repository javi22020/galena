import {
  ArrowDown,
  ArrowUp,
  Check,
  ChevronDown,
  GitMerge,
  LoaderCircle,
  RefreshCw,
  Undo2,
} from 'lucide-react'
import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@/components/ui/context-menu'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import { noteName, parentOf } from '../../shared/links'
import type { GitFile, GitStatus } from '../../shared/types'
import { gitNote, openGitFile, runGit, saveSettings, showGitFile, useStore } from '../store'
import { ConfirmDialog, type Confirmation } from './ConfirmDialog'
import { IconButton } from './IconButton'

const MARKS: Record<GitFile['status'], { letter: string; label: string; color: string }> = {
  modified: { letter: 'M', label: 'Modified', color: 'text-warning' },
  added: { letter: 'A', label: 'New', color: 'text-success' },
  deleted: { letter: 'D', label: 'Deleted', color: 'text-destructive' },
  renamed: { letter: 'R', label: 'Renamed', color: 'text-brand' },
  conflict: { letter: '!', label: 'Conflict', color: 'text-destructive' },
}

/** The vault's repository: what changed since the last commit, and syncing with a remote. */
export function GitPanel() {
  const git = useStore((s) => s.git)
  const settings = useStore((s) => s.settings)
  if (!git) return null
  switch (git.state) {
    case 'unavailable':
      return (
        <Notice>
          Git is not installed, or is not on the PATH. Install it and start Galena again to keep this vault
          under version control.
        </Notice>
      )
    case 'none':
      return (
        <Notice action="Initialize repository" onAction={() => runGit('init')}>
          This vault is not a Git repository yet.
        </Notice>
      )
    case 'parent':
      return (
        <Notice
          action="Use this repository"
          onAction={() => saveSettings({ ...settings, git: { ...settings.git, parentRepo: true } })}
        >
          This vault is a folder of the repository at{' '}
          <span className="font-mono text-xs wrap-anywhere text-foreground">{git.root}</span>. Galena would
          only commit what is inside the vault.
        </Notice>
      )
    case 'busy':
      return <Notice>A rebase or another Git operation is under way. Finish it in a terminal.</Notice>
    case 'error':
      return (
        <Notice>
          Git could not read this repository:{' '}
          <span className="wrap-anywhere text-foreground">{git.message}</span>
        </Notice>
      )
    default:
      return <Repository git={git} />
  }
}

/** What to ask before a file goes back to its last commit. */
export function discardRequest(file: GitFile): Confirmation {
  return {
    title: `Discard the changes to "${noteName(file.path)}"?`,
    description:
      file.status === 'added'
        ? 'It was never committed, so it is moved to .galena/trash.'
        : 'It goes back to its last commit. What it has now is kept in .galena/trash.',
    action: 'Discard',
    run: () => void runGit('discard', { paths: [file.path] }),
  }
}

function Repository({ git }: { git: GitStatus }) {
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null)
  const merging = git.state === 'merging'

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      {merging ? (
        <MergeBar git={git} onConfirm={setConfirmation} />
      ) : (
        <CommitBox git={git} />
      )}
      {git.tracksGalena && (
        <Callout action="Stop tracking" onAction={() => runGit('untrack')}>
          Galena&apos;s own <span className="font-mono">.galena</span> folder is in the repository.
        </Callout>
      )}
      {!git.remote && !merging && <RemoteForm />}

      <nav className="-mx-1 flex min-h-0 flex-1 flex-col gap-px overflow-y-auto px-1 text-[13px]">
        {git.files.map((file) => (
          <FileRow
            key={file.path}
            file={file}
            onDiscard={merging ? undefined : () => setConfirmation(discardRequest(file))}
          />
        ))}
        {!git.files.length && (
          <p className="p-3 text-center text-muted-foreground">Nothing changed since the last commit.</p>
        )}
      </nav>

      <ConfirmDialog request={confirmation} onClose={() => setConfirmation(null)} />
    </div>
  )
}

/** The commit message and the button that commits, pulls and pushes in one go. */
function CommitBox({ git }: { git: GitStatus }) {
  const busy = useStore((s) => s.gitBusy)
  const [message, setMessage] = useState('')
  const dirty = git.files.length > 0
  // Without a remote there is nothing to sync with, so the button just commits.
  const main = git.remote ? 'sync' : 'commit'
  const disabled = busy || (main === 'commit' && !dirty)

  const save = (action: 'commit' | 'sync') => void runGit(action, { message })

  // With nothing left to commit, the message has been used: also when the
  // commit went through and it was the push after it that failed.
  useEffect(() => {
    if (!dirty) setMessage('')
  }, [dirty])

  return (
    <div className="flex shrink-0 flex-col gap-2">
      <Textarea
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && !disabled) save(main)
        }}
        placeholder="Commit message (optional)"
        rows={2}
        className="min-h-[52px] rounded-lg text-[13px] md:text-[13px]"
      />
      <div className="flex gap-px">
        <Button
          className={cn('min-w-0 flex-1', git.remote && 'rounded-r-none')}
          disabled={disabled}
          onClick={() => save(main)}
        >
          {busy ? <LoaderCircle className="animate-spin" /> : git.remote ? <RefreshCw /> : <Check />}
          {git.remote ? 'Sync' : 'Commit'}
          {git.ahead > 0 && <Count icon={<ArrowUp />}>{git.ahead}</Count>}
          {git.behind > 0 && <Count icon={<ArrowDown />}>{git.behind}</Count>}
        </Button>
        {git.remote && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="icon" className="rounded-l-none" aria-label="More Git actions" disabled={busy}>
                <ChevronDown />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-36">
              <DropdownMenuItem disabled={!dirty} onSelect={() => save('commit')}>
                Commit
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => runGit('pull')}>Pull</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => runGit('push')}>Push</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => runGit('fetch')}>Fetch</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
    </div>
  )
}

const Count = ({ icon, children }: { icon: ReactNode; children: ReactNode }) => (
  <span className="flex items-center text-xs opacity-80 [&_svg]:size-3!">
    {icon}
    {children}
  </span>
)

/** Shown instead of the commit box while a merge waits for its conflicts. */
interface MergeBarProps {
  git: GitStatus
  /** Asks before the merge is thrown away. */
  onConfirm: (request: Confirmation) => void
}

function MergeBar({ git, onConfirm }: MergeBarProps) {
  const busy = useStore((s) => s.gitBusy)
  const conflicts = git.files.filter((file) => file.status === 'conflict').length
  const pending =
    conflicts === 1
      ? '1 file was changed on both sides. Open it to resolve the conflict.'
      : `${conflicts} files were changed on both sides. Open each one to resolve its conflict.`

  const abort = () =>
    onConfirm({
      title: 'Abort the merge?',
      description:
        'Your notes go back to how they were before the merge. The conflicts resolved so far are lost.',
      action: 'Abort merge',
      run: () => void runGit('abort'),
    })

  return (
    <div className="flex shrink-0 flex-col gap-2 rounded-lg border bg-card p-2.5">
      <p className="flex items-center gap-2 text-[13px] font-medium">
        <GitMerge className="size-4 text-warning" />
        Merge in progress
      </p>
      <p className="text-xs text-muted-foreground">
        {conflicts ? pending : 'Every conflict is resolved. Finish the merge, then sync to push it.'}
      </p>
      <div className="flex gap-2">
        <Button variant="outline" size="sm" className="flex-1" disabled={busy} onClick={abort}>
          Abort
        </Button>
        <Button
          size="sm"
          className="flex-1"
          disabled={busy || conflicts > 0}
          onClick={() => runGit('finish')}
        >
          Finish merge
        </Button>
      </div>
    </div>
  )
}

/** Adds the remote to sync with, for a repository that has none. */
function RemoteForm() {
  const busy = useStore((s) => s.gitBusy)
  const [url, setUrl] = useState('')

  const add = async (event: FormEvent) => {
    event.preventDefault()
    if (url.trim() && (await runGit('remote', { url }))) setUrl('')
  }

  return (
    <form className="flex shrink-0 gap-2" onSubmit={add}>
      <Input
        aria-label="Remote URL"
        className="h-7 rounded-lg font-mono text-xs md:text-xs"
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        placeholder="Remote URL, to sync with"
        spellCheck={false}
      />
      <Button variant="outline" size="sm" disabled={busy || !url.trim()}>
        Add
      </Button>
    </form>
  )
}

interface FileRowProps {
  file: GitFile
  /** Left out while the file cannot be discarded. */
  onDiscard?: () => void
}

function FileRow({ file, onDiscard }: FileRowProps) {
  const { path, status } = file
  const { letter, label, color } = MARKS[status]
  const conflict = status === 'conflict'
  // Looked up as the row is drawn, rather than on every change to the store.
  const entries = useStore((s) => s.entries)
  const isNote = gitNote(path, entries) !== undefined
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          className="group flex h-[30px] shrink-0 cursor-pointer items-center gap-2 rounded-sm pr-1.5 pl-2 transition-colors hover:bg-accent"
          title={file.from ? `${file.from} → ${path}` : path}
          onClick={() => showGitFile(file)}
        >
          <span className={cn('truncate', status === 'deleted' && 'text-muted-foreground line-through')}>
            {noteName(path)}
          </span>
          <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{parentOf(path)}</span>
          {onDiscard && !conflict && (
            <IconButton
              size="icon-xs"
              label="Discard changes"
              className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100 pointer-coarse:opacity-100"
              onClick={(event) => {
                event.stopPropagation()
                onDiscard()
              }}
            >
              <Undo2 />
            </IconButton>
          )}
          <span className={cn('w-3.5 shrink-0 text-center font-mono text-xs font-semibold', color)} title={label}>
            <span aria-hidden="true">{letter}</span>
            <span className="sr-only">{label}</span>
          </span>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent className="w-44">
        <ContextMenuItem onSelect={() => showGitFile(file)}>
          {conflict ? 'Resolve conflict' : 'Show changes'}
        </ContextMenuItem>
        {isNote && (
          <ContextMenuItem onSelect={() => openGitFile(path)}>Open note</ContextMenuItem>
        )}
        {onDiscard && !conflict && (
          <>
            <ContextMenuSeparator />
            <ContextMenuItem variant="destructive" onSelect={onDiscard}>
              Discard changes
            </ContextMenuItem>
          </>
        )}
      </ContextMenuContent>
    </ContextMenu>
  )
}

interface NoticeProps {
  /** Label of a button offering the way forward. */
  action?: string
  onAction?: () => void
  children: ReactNode
}

/** A state of the repository in which there is nothing to list. */
function Notice({ action, onAction, children }: NoticeProps) {
  const busy = useStore((s) => s.gitBusy)
  return (
    <div className="flex flex-col items-center gap-3 px-2 py-6 text-center text-[13px] text-muted-foreground">
      <p>{children}</p>
      {action && (
        <Button variant="outline" size="sm" disabled={busy} onClick={onAction}>
          {action}
        </Button>
      )}
    </div>
  )
}

/** A remark about the repository, with the one thing to do about it. */
function Callout({ action, onAction, children }: Required<NoticeProps>) {
  const busy = useStore((s) => s.gitBusy)
  return (
    <div className="flex shrink-0 items-center gap-2 rounded-lg border bg-card p-2.5 text-xs text-muted-foreground">
      <span className="flex-1">{children}</span>
      <Button variant="outline" size="xs" disabled={busy} onClick={onAction}>
        {action}
      </Button>
    </div>
  )
}
