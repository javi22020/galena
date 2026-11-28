import { ChevronsUpDown, FolderPlus, GitBranch, Plus, RefreshCw, Search } from 'lucide-react'
import { useMemo, useRef, useState } from 'react'
import { Kbd } from '@/components/ui/kbd'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { shortcutLabel } from '../shortcuts'
import { refreshGit, setModal, useStore } from '../store'
import { Explorer, type ExplorerHandle } from './Explorer'
import { GitPanel } from './GitPanel'
import { IconButton } from './IconButton'
import { Logo } from './Logo'

/** The left column: the vault, search, and the notes or their Git changes. */
export function Sidebar() {
  const vault = useStore((s) => s.vault)
  const entries = useStore((s) => s.entries)
  const notes = useMemo(() => entries.filter((entry) => entry.type === 'file').length, [entries])
  const git = useStore((s) => s.git)
  const [tab, setTab] = useState('files')
  const explorer = useRef<ExplorerHandle>(null)
  const changed = git?.files.length ?? 0
  const inRepo = git?.state === 'ready' || git?.state === 'merging' || git?.state === 'busy'

  return (
    <Tabs value={tab} onValueChange={setTab} className="h-full gap-3 p-3">
      <button
        className="flex h-11 shrink-0 items-center gap-2.5 rounded-md p-1.5 text-left transition-colors outline-none hover:bg-accent focus-visible:bg-accent"
        title={`${vault?.path}\nOpen another vault`}
        onClick={() => useStore.setState({ phase: 'home' })}
      >
        <Logo className="size-7 shrink-0" />
        <span className="flex min-w-0 flex-1 flex-col leading-tight">
          <span className="truncate text-[13px] font-semibold">{vault?.name}</span>
          <span className="truncate text-xs text-muted-foreground">{vault?.path}</span>
        </span>
        <ChevronsUpDown className="size-4 shrink-0 text-muted-foreground" />
      </button>

      <button
        className="flex h-9 shrink-0 items-center gap-2 rounded-md border border-input bg-background px-2.5 text-[13px] text-muted-foreground shadow-xs transition-colors outline-none hover:text-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
        onClick={() => setModal('palette')}
      >
        <Search className="size-[15px]" />
        <span className="flex-1 text-left">Search notes…</span>
        <Kbd className="pointer-coarse:hidden">{shortcutLabel('palette')}</Kbd>
      </button>

      <div className="-mb-1 flex shrink-0 items-center pt-1">
        <TabsList className="rounded-lg">
          <TabsTrigger value="files" className="rounded-[7px] px-2.5 text-[13px]">
            Files
          </TabsTrigger>
          <TabsTrigger value="git" className="rounded-[7px] px-2.5 text-[13px]">
            Git
            {changed > 0 && (
              <span className="rounded-full bg-brand-soft px-1.5 text-[11px] leading-4 text-brand">{changed}</span>
            )}
          </TabsTrigger>
        </TabsList>
        <span className="flex-1" />
        {tab === 'files' ? (
          <>
            <IconButton size="icon-sm" label="New note" onClick={() => explorer.current?.create('file')}>
              <Plus />
            </IconButton>
            <IconButton size="icon-sm" label="New folder" onClick={() => explorer.current?.create('dir')}>
              <FolderPlus />
            </IconButton>
          </>
        ) : (
          <IconButton size="icon-sm" label="Refresh" onClick={refreshGit}>
            <RefreshCw />
          </IconButton>
        )}
      </div>

      {/* Each stays mounted behind the other: open folders and a half-written commit message are kept. */}
      <TabsContent value="files" forceMount className="flex min-h-0 flex-col data-[state=inactive]:hidden">
        <Explorer ref={explorer} />
      </TabsContent>
      <TabsContent value="git" forceMount className="flex min-h-0 flex-col data-[state=inactive]:hidden">
        <GitPanel />
      </TabsContent>

      <div className="flex shrink-0 items-center gap-2 rounded-lg border bg-card p-2.5 text-xs text-muted-foreground">
        <span className="size-2 shrink-0 rounded-full bg-success" />
        <span className="flex-1 truncate">
          Watching {notes} {notes === 1 ? 'note' : 'notes'}
        </span>
        {inRepo ? (
          <span className="flex min-w-0 items-center gap-1 font-mono" title="Branch; commits to push and to pull">
            <GitBranch className="size-3 shrink-0" />
            <span className="truncate">{git.branch ?? 'detached'}</span>
            {git.ahead > 0 && <span>↑{git.ahead}</span>}
            {git.behind > 0 && <span>↓{git.behind}</span>}
          </span>
        ) : (
          <span className="font-mono">{location.hostname}</span>
        )}
      </div>
    </Tabs>
  )
}
