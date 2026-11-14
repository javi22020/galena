import {
  File,
  FileDiff,
  FilePlus,
  FolderOpen,
  PenLine,
  Search,
  Settings2,
  Share2,
  SunMoon,
  type LucideIcon,
} from 'lucide-react'
import { motion } from 'motion/react'
import { Fragment, useEffect, useState, type KeyboardEvent } from 'react'
import { Kbd } from '@/components/ui/kbd'
import { outExpo } from '@/lib/motion'
import { cn } from '@/lib/utils'
import { noteName, parentOf } from '../../shared/links'
import { api } from '../api'
import { newChat, newNote, openNote, setModal, showError, useStore } from '../store'
import { toggleTheme } from '../theme'
import { Modal } from './Modal'

interface Item {
  key: string
  group: 'Notes' | 'Commands'
  icon: LucideIcon
  title: string
  detail?: string
  run: () => void
}

const commands: Item[] = [
  { title: 'New note', icon: FilePlus, run: () => void newNote().catch(showError) },
  { title: 'Open graph', icon: Share2, run: () => setModal('graph') },
  { title: 'Toggle theme', icon: SunMoon, run: toggleTheme },
  { title: 'Review agent changes', icon: FileDiff, run: () => setModal('review') },
  { title: 'Open settings', icon: Settings2, run: () => setModal('settings') },
  { title: 'New chat', icon: PenLine, run: () => void newChat() },
  { title: 'Open another vault', icon: FolderOpen, run: () => useStore.setState({ phase: 'home' }) },
].map((command) => ({ ...command, key: `command:${command.title}`, group: 'Commands' }))

const modes = [
  { id: 'go', label: 'Go to', placeholder: 'Go to a note or run a command…' },
  { id: 'search', label: 'Text', placeholder: 'Search text in the vault…' },
] as const

type Mode = (typeof modes)[number]['id']

/** Quick switcher: notes and commands by name, or full-text search. */
export function Palette() {
  return (
    <Modal name="palette" title="Command palette" bare className="top-[min(120px,12vh)] translate-y-0 sm:max-w-[620px]">
      <PaletteBody />
    </Modal>
  )
}

function PaletteBody() {
  const [mode, setMode] = useState<Mode>('go')
  const [query, setQuery] = useState('')
  const [items, setItems] = useState<Item[]>([])
  const [index, setIndex] = useState(0)
  /** The query the items on screen answer; trails `query` while a search runs. */
  const [answered, setAnswered] = useState('')

  useEffect(() => {
    let stale = false
    const show = (found: Item[]) => {
      if (stale) return
      setItems(found)
      setIndex(0)
      setAnswered(query)
    }
    const load = async () => {
      if (mode === 'search') {
        const matches = await api.searchText(query)
        show(
          matches.map((match) => ({
            key: `${match.path}:${match.line}`,
            group: 'Notes',
            icon: File,
            title: noteName(match.path),
            detail: match.text,
            run: () => openNote(match.path, match.line),
          })),
        )
      } else {
        const wanted = query.trim().toLowerCase()
        const notes = await api.searchNames(query)
        show([
          ...notes.map((path) => ({
            key: path,
            group: 'Notes' as const,
            icon: File,
            title: noteName(path),
            detail: parentOf(path),
            run: () => openNote(path),
          })),
          ...commands.filter((command) => command.title.toLowerCase().includes(wanted)),
        ])
      }
    }
    // Wait for a pause in typing before asking the server.
    const timer = setTimeout(() => load().catch(showError), 100)
    return () => {
      stale = true
      clearTimeout(timer)
    }
  }, [mode, query])

  const run = (item: Item | undefined) => {
    if (!item) return
    setModal(null) // first, so a command may open another modal
    item.run()
  }

  const onKeyDown = (event: KeyboardEvent) => {
    const move = { ArrowDown: 1, ArrowUp: -1 }[event.key]
    if (move && items.length) {
      event.preventDefault()
      setIndex((index + move + items.length) % items.length)
    } else if (event.key === 'Enter') {
      event.preventDefault()
      run(items[index])
    } else if (event.key === 'Tab') {
      event.preventDefault()
      setMode(mode === 'go' ? 'search' : 'go')
    }
  }

  return (
    <>
      <div className="flex h-14 shrink-0 items-center gap-2.5 border-b px-4">
        <Search className="size-[18px] shrink-0 text-muted-foreground" />
        <input
          autoFocus
          aria-label="Search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={modes.find((m) => m.id === mode)!.placeholder}
          spellCheck={false}
          autoComplete="off"
          className="h-full min-w-0 flex-1 bg-transparent text-[15px] outline-none placeholder:text-muted-foreground"
        />
        <div role="tablist" className="flex shrink-0 rounded-[9px] bg-muted p-[3px] text-xs font-medium">
          {modes.map(({ id, label }) => (
            <button
              key={id}
              role="tab"
              aria-selected={id === mode}
              tabIndex={-1}
              className={cn(
                'relative h-6 w-[62px] rounded-sm transition-colors outline-none',
                id === mode ? 'text-foreground' : 'text-muted-foreground hover:text-foreground',
              )}
              onClick={() => setMode(id)}
            >
              {id === mode && (
                <motion.span
                  layoutId="palette-mode"
                  className="absolute inset-0 rounded-sm bg-background shadow-xs ring-1 ring-border"
                  transition={{ duration: 0.35, ease: outExpo }}
                />
              )}
              <span className="relative">{label}</span>
            </button>
          ))}
        </div>
      </div>

      <motion.div layoutScroll role="listbox" className="max-h-[420px] min-h-0 overflow-y-auto p-1.5">
        {items.map((item, i) => (
          <Fragment key={item.key}>
            {item.group !== items[i - 1]?.group && (
              <div
                className={cn(
                  'px-2.5 pt-2 pb-1 text-xs font-medium text-muted-foreground',
                  i > 0 && '-mx-1.5 mt-1.5 border-t px-4 pt-3.5',
                )}
              >
                {item.group}
              </div>
            )}
            <motion.div
              role="option"
              aria-selected={i === index}
              className="relative flex h-10 cursor-pointer items-center gap-2.5 rounded-md px-2.5"
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, ease: outExpo, delay: Math.min(i, 10) * 0.03 }}
              ref={i === index ? (element) => element?.scrollIntoView({ block: 'nearest' }) : undefined}
              onMouseMove={() => i !== index && setIndex(i)}
              onClick={() => run(item)}
            >
              {/* One highlight that glides between the rows. */}
              {i === index && (
                <motion.span
                  layoutId="palette-highlight"
                  className="absolute inset-0 rounded-md bg-accent"
                  transition={{ duration: 0.28, ease: outExpo }}
                />
              )}
              <item.icon className="relative size-[15px] shrink-0 text-muted-foreground" />
              <span className={cn('relative shrink-0', item.group === 'Notes' && 'font-medium')}>{item.title}</span>
              <span className="relative min-w-0 flex-1 truncate text-[13px] text-muted-foreground">
                {item.detail}
              </span>
              {i === index && <Kbd className="relative bg-background">↵</Kbd>}
            </motion.div>
          </Fragment>
        ))}
        {!items.length && answered.trim() && (
          <p className="py-9 text-center text-muted-foreground">No results for “{answered.trim()}”</p>
        )}
      </motion.div>

      {/* Keyboard hints, which say nothing on a touch screen. */}
      <div className="flex h-10 shrink-0 items-center gap-4 border-t bg-sidebar px-4 text-xs text-muted-foreground pointer-coarse:hidden [&>span]:flex [&>span]:items-center [&>span]:gap-1.5">
        <span>
          <span className="font-mono">↑↓</span> Navigate
        </span>
        <span>
          <span className="font-mono">↵</span> Open
        </span>
        <span>
          <span className="font-mono">Tab</span> Switch mode
        </span>
      </div>
    </>
  )
}
