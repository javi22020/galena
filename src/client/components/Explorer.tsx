import { ChevronRight, File, FileImage } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import {
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type MouseEvent,
  type Ref,
} from 'react'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@/components/ui/context-menu'
import { collapse, enter, stagger } from '@/lib/motion'
import { cn } from '@/lib/utils'
import { noteName, parentOf } from '../../shared/links'
import type { Entry, NewEntryType } from '../../shared/types'
import { ancestors, createEntry, movePath, openNote, removePath, showError, showImage, useStore } from '../store'
import { ConfirmDialog, type Confirmation } from './ConfirmDialog'

/** What deleting an entry of each type moves to the trash. */
const DELETED: Record<Entry['type'], string> = {
  dir: 'folder and everything in it are',
  file: 'note is',
  asset: 'image is',
}

interface Node {
  entry: Entry
  name: string
  children: Node[]
}

/** What the inline text field is for: a new entry inside `parent`, or a rename. */
type Draft = { parent: string; type: NewEntryType } | { rename: Entry }

const indent = (depth: number) => ({ paddingLeft: 8 + depth * 16 })

/** What the sidebar's own buttons can ask of the tree. */
export interface ExplorerHandle {
  /** Starts naming a new note or folder at the vault root. */
  create(type: NewEntryType): void
}

/**
 * Folder and note tree with create, rename, move (drag and drop) and delete.
 * Images are listed too, but not renamed or moved: nothing would update the
 * links to them.
 */
export function Explorer({ ref }: { ref?: Ref<ExplorerHandle> }) {
  const entries = useStore((s) => s.entries)
  const activePath = useStore((s) => s.tabs.find((t) => t.id === s.active)?.path)
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set())
  const [draft, setDraft] = useState<Draft | null>(null)
  /** The entry the context menu is for; null is the empty area (the vault root). */
  const [target, setTarget] = useState<Entry | null>(null)
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null)
  const nameInput = useRef<HTMLInputElement>(null)
  const tree = useMemo(() => buildTree(entries), [entries])

  const expand = (paths: string[]) => setExpanded((current) => new Set([...current, ...paths]))
  const toggle = (path: string) =>
    setExpanded((current) => {
      const next = new Set(current)
      if (!next.delete(path)) next.add(path)
      return next
    })

  // Keep the note being edited visible in the tree.
  useEffect(() => {
    if (activePath) expand(ancestors(activePath))
  }, [activePath])

  const startCreate = (parent: string, type: NewEntryType) => {
    if (parent) expand([...ancestors(parent), parent])
    setDraft({ parent, type })
  }

  useImperativeHandle(ref, () => ({ create: (type) => startCreate('', type) }))

  const commit = async (name: string) => {
    const current = draft
    setDraft(null)
    name = name.trim()
    if (!current || !name) return
    try {
      if ('rename' in current) {
        const { path, type } = current.rename
        await movePath(path, join(parentOf(path), type === 'file' ? `${name}.md` : name))
      } else {
        const file = current.type === 'file'
        await createEntry(join(current.parent, file ? `${name}.md` : name), current.type)
      }
    } catch (error) {
      showError(error)
    }
  }

  const remove = (entry: Entry) =>
    setConfirmation({
      title: `Delete "${noteName(entry.path)}"?`,
      description: `The ${DELETED[entry.type]} moved to .galena/trash.`,
      action: 'Delete',
      run: () => removePath(entry.path).catch(showError),
    })

  const onDrop = (event: DragEvent, folder: string) => {
    event.preventDefault()
    event.stopPropagation()
    const from = event.dataTransfer.getData('text/galena-path')
    // A folder cannot be moved into itself.
    if (!from || folder === from || folder.startsWith(`${from}/`)) return
    movePath(from, join(folder, from.slice(from.lastIndexOf('/') + 1))).catch(showError)
  }

  // Runs before the menu opens, so its items act on the row under the pointer.
  const onContextMenu = (event: MouseEvent) => {
    const path = (event.target as Element).closest<HTMLElement>('[data-path]')?.dataset.path
    setTarget(entries.find((entry) => entry.path === path) ?? null)
  }

  const renderDraft = (depth: number) => (
    <NameInput
      ref={nameInput}
      depth={depth}
      initial={draft && 'rename' in draft ? noteName(draft.rename.path) : ''}
      onDone={commit}
    />
  )

  const renderNodes = (nodes: Node[], parent: string, depth: number) => (
    <>
      {draft && 'parent' in draft && draft.parent === parent && renderDraft(depth)}
      {nodes.map(({ entry, name, children }) => {
        const { path, type } = entry
        if (draft && 'rename' in draft && draft.rename.path === path) {
          return <div key={path}>{renderDraft(depth)}</div>
        }
        const dir = type === 'dir'
        const asset = type === 'asset'
        const open = expanded.has(path)
        const active = path === activePath
        return (
          <motion.div key={path} variants={enter}>
            <div
              data-path={path}
              className={cn(
                'flex h-[30px] cursor-pointer items-center gap-2 rounded-sm pr-2 transition-colors hover:bg-accent',
                active ? 'bg-accent' : !dir && 'text-muted-foreground',
                (active || dir) && 'font-medium',
              )}
              style={indent(depth)}
              draggable={!asset}
              onDragStart={(e) => e.dataTransfer.setData('text/galena-path', path)}
              onDragOver={dir ? (e) => e.preventDefault() : undefined}
              onDrop={dir ? (e) => onDrop(e, path) : undefined}
              onClick={() => (dir ? toggle(path) : asset ? showImage(path) : openNote(path))}
            >
              {dir ? (
                <ChevronRight
                  className={cn(
                    'size-3.5 shrink-0 text-muted-foreground transition-transform duration-300 ease-out-expo',
                    open && 'rotate-90',
                  )}
                />
              ) : asset ? (
                <FileImage className="size-3.5 shrink-0 text-muted-foreground" />
              ) : (
                <File className="size-3.5 shrink-0 text-muted-foreground" />
              )}
              <span className="flex-1 truncate">{name}</span>
            </div>
            <AnimatePresence initial={false}>
              {dir && open && (
                <motion.div {...collapse} className="overflow-hidden">
                  {renderNodes(children, path, depth + 1)}
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        )
      })}
    </>
  )

  const folder = target ? (target.type === 'dir' ? target.path : parentOf(target.path)) : ''

  return (
    <>
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <motion.nav
            className="-mx-1 flex min-h-0 flex-1 flex-col gap-px overflow-y-auto px-1 text-[13px]"
            variants={stagger()}
            initial="hidden"
            animate="show"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => onDrop(e, '')}
            onContextMenu={onContextMenu}
          >
            {renderNodes(tree, '', 0)}
            {!entries.length && !draft && (
              <p className="p-3 text-center text-muted-foreground">This vault has no notes yet.</p>
            )}
          </motion.nav>
        </ContextMenuTrigger>
        <ContextMenuContent
          className="w-40"
          // A closing menu hands the focus back to where it was; the name field
          // that one of its items has just opened needs it instead.
          onCloseAutoFocus={(event) => {
            if (!nameInput.current) return
            event.preventDefault()
            nameInput.current.focus()
          }}
        >
          <ContextMenuItem onSelect={() => startCreate(folder, 'file')}>New note</ContextMenuItem>
          <ContextMenuItem onSelect={() => startCreate(folder, 'dir')}>New folder</ContextMenuItem>
          {target && (
            <>
              <ContextMenuSeparator />
              {target.type !== 'asset' && (
                <ContextMenuItem onSelect={() => setDraft({ rename: target })}>Rename</ContextMenuItem>
              )}
              <ContextMenuItem variant="destructive" onSelect={() => remove(target)}>
                Delete
              </ContextMenuItem>
            </>
          )}
        </ContextMenuContent>
      </ContextMenu>

      <ConfirmDialog request={confirmation} onClose={() => setConfirmation(null)} />
    </>
  )
}

interface NameInputProps {
  ref: Ref<HTMLInputElement>
  depth: number
  initial: string
  /** Called once with the typed name, or with an empty string when cancelled. */
  onDone: (name: string) => void
}

function NameInput({ ref, depth, initial, onDone }: NameInputProps) {
  // Escape removes the field, which may still fire a blur afterwards.
  const done = useRef(false)
  const finish = (name: string) => {
    if (done.current) return
    done.current = true
    onDone(name)
  }
  return (
    <div className="flex h-[30px] items-center pr-1" style={indent(depth)}>
      <input
        ref={ref}
        autoFocus
        defaultValue={initial}
        placeholder="Name"
        spellCheck={false}
        className="h-6 min-w-0 flex-1 rounded-sm border border-ring bg-background px-1.5 ring-3 ring-ring/50 outline-none placeholder:text-muted-foreground"
        onFocus={(e) => e.target.select()}
        onBlur={(e) => finish(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur()
          if (e.key === 'Escape') {
            // Only the renaming stops, not the explorer laid over the editor.
            e.preventDefault()
            finish('')
          }
        }}
      />
    </div>
  )
}

const join = (folder: string, name: string) => (folder ? `${folder}/${name}` : name)

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

/** Nests the flat entry list (parents always come before their children). */
function buildTree(entries: Entry[]): Node[] {
  const root: Node[] = []
  const folders = new Map<string, Node[]>([['', root]])
  for (const entry of entries) {
    const node: Node = { entry, name: noteName(entry.path), children: [] }
    folders.get(parentOf(entry.path))?.push(node)
    if (entry.type === 'dir') folders.set(entry.path, node.children)
  }
  // Folders first, then by name.
  for (const nodes of folders.values()) {
    nodes.sort(
      (a, b) =>
        Number(a.entry.type !== 'dir') - Number(b.entry.type !== 'dir') ||
        collator.compare(a.name, b.name),
    )
  }
  return root
}
