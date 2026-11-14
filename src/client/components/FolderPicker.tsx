import { ChevronRight, CornerLeftUp, Folder, HardDrive, LoaderCircle } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { collapse, quick } from '@/lib/motion'
import type { FolderListing } from '../../shared/types'
import { api } from '../api'
import { setModal } from '../store'
import { IconButton } from './IconButton'
import { Modal } from './Modal'

type FolderPickerProps =
  /** Receives the absolute path of the chosen folder, once the dialog has closed. */
  | { mode: 'open'; onPick: (path: string) => void }
  /** Makes and opens the new vault; the dialog stays open, showing the error, if it fails. */
  | { mode: 'create'; onCreate: (parent: string, name: string) => Promise<void> }

/**
 * Browses the folders of this machine to choose the one to open as a vault,
 * or the one to make a new vault in.
 */
export function FolderPicker(props: FolderPickerProps) {
  const create = props.mode === 'create'
  return (
    <Modal
      name={create ? 'new-vault' : 'folders'}
      title={create ? 'Create a vault' : 'Choose a folder'}
      className="sm:max-w-[560px]"
    >
      <FolderPickerBody {...props} />
    </Modal>
  )
}

function FolderPickerBody(props: FolderPickerProps) {
  /** The folder on screen; null until the first answer. */
  const [listing, setListing] = useState<FolderListing | null>(null)
  /** The path field, which follows `listing` until it is edited. */
  const [draft, setDraft] = useState('')
  const [error, setError] = useState('')
  /** The name of the new vault, in create mode. */
  const [vaultName, setVaultName] = useState('')
  const [creating, setCreating] = useState(false)
  const latest = useRef(0)
  const list = useRef<HTMLDivElement>(null)
  /** Where focus goes when there are no rows to move to. */
  const last = useRef<HTMLButtonElement & HTMLInputElement>(null)
  /** Whether the last move began in the list, so that focus stays there. */
  const fromList = useRef(false)

  /** Shows a folder; without a path, the home folder. A failure keeps the current one. */
  const go = async (path?: string) => {
    const request = ++latest.current
    try {
      const next = await api.folders(path)
      if (request !== latest.current) return // a later move has overtaken this one
      setListing(next)
      setDraft(next.path)
      setError('')
    } catch (cause) {
      if (request === latest.current) setError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  useEffect(() => void go(), [])

  // Entering a folder removes the row that had focus; move on to the new rows,
  // or to the button when there is nowhere further to go.
  useEffect(() => {
    if (!fromList.current) return
    fromList.current = false
    ;(list.current?.querySelector('button') ?? last.current)?.focus()
  }, [listing])

  const onSubmit = (event: FormEvent) => {
    event.preventDefault()
    void go(draft.trim() || undefined)
  }

  const onListKeyDown = (event: KeyboardEvent) => {
    const side = ({ ArrowDown: 'nextElementSibling', ArrowUp: 'previousElementSibling' } as const)[event.key]
    const row = side && document.activeElement?.[side]
    if (row instanceof HTMLElement) {
      event.preventDefault()
      row.focus()
    }
  }

  const onCreate = async (event: FormEvent) => {
    event.preventDefault()
    if (props.mode !== 'create' || !listing || creating) return
    setCreating(true)
    setError('')
    try {
      await props.onCreate(listing.path, vaultName.trim())
      setModal(null)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setCreating(false)
    }
  }

  const atDrives = listing?.path === ''
  /** The folder's own name, which a long path pushes out of the field. */
  const name = listing?.path.split(/[\\/]/).filter(Boolean).pop() ?? listing?.path
  const RowIcon = atDrives ? HardDrive : Folder

  return (
    <>
      <div className="shrink-0 border-b px-3 py-2.5">
        <form onSubmit={onSubmit} className="flex items-center gap-1.5">
          <IconButton
            type="button"
            label="Parent folder"
            disabled={!listing || listing.parent === null}
            onClick={() => void go(listing?.parent ?? undefined)}
          >
            <CornerLeftUp />
          </IconButton>
          <Input
            autoFocus
            aria-label="Folder path"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Type a path and press Enter"
            spellCheck={false}
            autoComplete="off"
            className="font-mono text-[13px] md:text-[13px]"
          />
        </form>
        <AnimatePresence>
          {error && (
            <motion.p {...collapse} className="overflow-hidden px-1 text-[13px] wrap-anywhere text-destructive">
              <span className="block pt-2">{error}</span>
            </motion.p>
          )}
        </AnimatePresence>
      </div>

      <div className="h-[380px] min-h-24">
        {listing && (
          // Keyed by folder, so each one starts scrolled to the top.
          <motion.div
            key={listing.path}
            ref={list}
            className="h-full overflow-y-auto p-1.5"
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={quick}
            onKeyDown={onListKeyDown}
          >
            {listing.folders.map((folder, i) => (
              <button
                key={folder.path}
                // One stop for Tab; the arrow keys move between the rows.
                tabIndex={i === 0 ? 0 : -1}
                className="group flex h-9 w-full items-center gap-2.5 rounded-md px-2.5 text-left transition-colors outline-none hover:bg-accent focus-visible:bg-accent"
                onClick={() => {
                  fromList.current = true
                  void go(folder.path)
                }}
              >
                <RowIcon className="size-[15px] shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate">{folder.name}</span>
                <ChevronRight className="size-4 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100 pointer-coarse:opacity-100" />
              </button>
            ))}
            {!listing.folders.length && (
              <p className="py-9 text-center text-muted-foreground">No folders in here</p>
            )}
          </motion.div>
        )}
      </div>

      {props.mode === 'open' ? (
        <div className="flex shrink-0 items-center gap-3 border-t bg-sidebar px-4 py-3">
          <span className="min-w-0 flex-1 truncate text-[13px] text-muted-foreground">{name}</span>
          <Button
            ref={last}
            disabled={!listing || atDrives}
            onClick={() => {
              setModal(null)
              props.onPick(listing!.path)
            }}
          >
            Open this folder
          </Button>
        </div>
      ) : (
        <form onSubmit={onCreate} className="flex shrink-0 items-center gap-3 border-t bg-sidebar px-4 py-3">
          <Input
            ref={last}
            aria-label="Name of the new vault"
            value={vaultName}
            onChange={(e) => setVaultName(e.target.value)}
            placeholder={name ? `New vault in ${name}` : 'Name of the new vault'}
            spellCheck={false}
            autoComplete="off"
            className="min-w-0 flex-1"
          />
          <Button type="submit" disabled={!listing || atDrives || !vaultName.trim() || creating}>
            {creating && <LoaderCircle className="animate-spin" />}
            Create vault
          </Button>
        </form>
      )}
    </>
  )
}
