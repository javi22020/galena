import { Check, Plus, X } from 'lucide-react'
import { AnimatePresence, motion, useAnimate } from 'motion/react'
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { Kbd } from '@/components/ui/kbd'
import { collapse, enterProps, outExpo, quick } from '@/lib/motion'
import { cn } from '@/lib/utils'
import { noteName } from '../../shared/links'
import type { LineMatch } from '../../shared/types'
import { api } from '../api'
import { NoteEditor } from '../editor'
import { shortcutLabel } from '../shortcuts'
import { closeTab, newNote, openNote, showError, useStore, type Tab } from '../store'
import { IconButton } from './IconButton'
import { Logo } from './Logo'

interface EditorProps {
  /** Buttons shown before and after the tabs. */
  leading: ReactNode
  trailing: ReactNode
  /** Out of reach, while a side panel is open over it. */
  inert?: boolean
}

/** Tab bar, the note editor and the backlinks of the note on screen. */
export function Editor({ leading, trailing, inert }: EditorProps) {
  const tabs = useStore((s) => s.tabs)
  const active = useStore((s) => s.active)
  const tab = tabs.find((t) => t.id === active)
  const scroller = useRef<HTMLDivElement>(null)
  const host = useRef<HTMLDivElement>(null)
  const editor = useRef<NoteEditor>(null)
  const [note, animate] = useAnimate<HTMLElement>()

  useEffect(() => {
    const instance = new NoteEditor(host.current!)
    editor.current = instance
    return () => instance.destroy()
  }, [])

  // Every note starts at its top and rises into place.
  useLayoutEffect(() => {
    if (active === null) return
    scroller.current!.scrollTop = 0
    animate(note.current, { opacity: [0, 1], y: [8, 0] }, { duration: 0.6, ease: outExpo })
  }, [active, animate, note])

  const resolve = (keep: 'mine' | 'disk') => {
    if (tab) editor.current?.resolveConflict(tab.id, keep).catch(showError)
  }

  return (
    // A container, so that the note's spacing follows the room the side panels leave it.
    <main className="@container flex min-w-0 flex-1 flex-col bg-background" inert={inert}>
      <header className="flex h-[52px] shrink-0 items-center gap-1 border-b px-2.5">
        {leading}
        {tabs.length > 0 && (
          <motion.div
            role="tablist"
            layoutScroll
            className="relative flex min-w-0 gap-0.5 overflow-x-auto rounded-lg bg-muted p-[3px] [scrollbar-width:none]"
          >
            <AnimatePresence initial={false} mode="popLayout">
              {tabs.map(({ id, path, dirty }) => (
                <motion.div
                  key={id}
                  layout="position"
                  role="tab"
                  aria-selected={id === active}
                  title={path}
                  className={cn(
                    'group relative flex h-7 max-w-48 shrink-0 cursor-pointer items-center gap-1.5 rounded-[7px] pr-1.5 pl-3 text-[13px] font-medium transition-colors select-none',
                    id === active ? 'text-foreground' : 'text-muted-foreground hover:text-foreground',
                  )}
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.9 }}
                  transition={quick}
                  onClick={() => useStore.setState({ active: id })}
                  onAuxClick={(e) => e.button === 1 && void closeTab(id)}
                >
                  {id === active && (
                    <motion.span
                      layoutId="active-tab"
                      className="absolute inset-0 rounded-[7px] bg-background shadow-xs ring-1 ring-border"
                      transition={{ duration: 0.35, ease: outExpo }}
                    />
                  )}
                  <span className="relative truncate">{noteName(path)}</span>
                  <button
                    aria-label="Close tab"
                    className={cn(
                      'relative flex size-[18px] shrink-0 items-center justify-center rounded-[5px] text-muted-foreground transition-[opacity,background-color,color] outline-none hover:bg-accent hover:text-foreground focus-visible:opacity-100',
                      // Without a mouse there is no hover to reveal it.
                      id !== active && !dirty && 'opacity-0 group-hover:opacity-100 pointer-coarse:opacity-100',
                    )}
                    onClick={(e) => {
                      e.stopPropagation()
                      void closeTab(id)
                    }}
                  >
                    {dirty ? (
                      <span className="size-1.5 rounded-full bg-current" />
                    ) : (
                      <X className="size-3" strokeWidth={2.2} />
                    )}
                  </button>
                </motion.div>
              ))}
            </AnimatePresence>
          </motion.div>
        )}
        <IconButton label="New note" onClick={() => newNote().catch(showError)}>
          <Plus />
        </IconButton>
        <span className="flex-1" />
        {tab && <SaveState tab={tab} />}
        {trailing}
      </header>

      <AnimatePresence initial={false}>
        {tab?.conflict && (
          <Banner key="conflict" className="text-warning">
            This note changed on disk while you had unsaved edits.
            <Button variant="outline" size="sm" onClick={() => resolve('disk')}>
              Load disk version
            </Button>
            <Button variant="outline" size="sm" onClick={() => resolve('mine')}>
              Keep mine
            </Button>
          </Banner>
        )}
      </AnimatePresence>

      {/* The column scrolls as a whole; the editor inside grows with its note. */}
      <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto" hidden={!tab}>
        <article ref={note} className="mx-auto max-w-[720px] px-5 pt-8 pb-16 @2xl:px-10 @2xl:pt-12">
          {tab && <Breadcrumb path={tab.path} />}
          <div ref={host} />
          {tab && <Backlinks key={tab.path} path={tab.path} />}
        </article>
      </div>
      {!tab && (
        <motion.div
          {...enterProps}
          className="flex flex-1 flex-col items-center justify-center gap-1.5 p-6 text-center"
        >
          <Logo className="mb-2 size-9 text-muted-foreground/50" />
          <p className="font-medium">No note is open</p>
          <p className="text-[13px] text-muted-foreground">
            Pick one in the explorer
            <span className="pointer-coarse:hidden">
              , or press <Kbd>{shortcutLabel('palette')}</Kbd> to search
            </span>
            .
          </p>
        </motion.div>
      )}
    </main>
  )
}

/** Whether the note on screen is on disk yet. */
function SaveState({ tab }: { tab: Tab }) {
  const state = tab.conflict ? 'Conflict' : tab.dirty ? 'Unsaved' : 'Saved'
  return (
    <motion.span
      key={state}
      className="mr-2 flex items-center gap-1.5 text-xs text-muted-foreground max-sm:hidden"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.4 }}
    >
      {state === 'Saved' ? (
        <Check className="size-[13px] text-success" strokeWidth={2.4} />
      ) : (
        <span className={cn('size-1.5 rounded-full', tab.conflict ? 'bg-warning' : 'bg-muted-foreground')} />
      )}
      {state}
    </motion.span>
  )
}

function Banner({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <motion.div {...collapse} className="shrink-0 overflow-hidden border-b bg-sidebar">
      <div className={cn('flex flex-wrap items-center gap-2 px-4 py-2 text-[13px]', className)}>{children}</div>
    </motion.div>
  )
}

/** The folders a note is in, then its name. */
function Breadcrumb({ path }: { path: string }) {
  const folders = path.split('/').slice(0, -1)
  return (
    <div className="mb-5 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
      {folders.map((folder, index) => (
        <span key={index} className="contents">
          <span>{folder}</span>
          <span aria-hidden="true">/</span>
        </span>
      ))}
      <span className="text-foreground">{noteName(path)}</span>
    </div>
  )
}

/** Notes that link to the one on screen. */
function Backlinks({ path }: { path: string }) {
  const fsTick = useStore((s) => s.fsTick)
  const [links, setLinks] = useState<LineMatch[]>([])

  useEffect(() => {
    let stale = false
    api.backlinks(path).then(
      (found) => stale || setLinks(found),
      () => stale || setLinks([]),
    )
    return () => void (stale = true)
  }, [path, fsTick])

  if (!links.length) return null
  return (
    <motion.section {...enterProps} className="mt-14 border-t pt-5">
      <h3 className="mb-3 text-xs font-medium tracking-[0.02em] text-muted-foreground">
        {links.length} {links.length === 1 ? 'backlink' : 'backlinks'}
      </h3>
      <div className="grid grid-cols-1 gap-2.5 @lg:grid-cols-2">
        {links.map((link) => (
          <button
            key={`${link.path}:${link.line}`}
            className="rounded-xl border bg-card px-3.5 py-3 text-left shadow-xs transition-[translate,box-shadow] duration-350 ease-out-expo outline-none hover:-translate-y-px hover:shadow-lg focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
            onClick={() => openNote(link.path, link.line)}
          >
            <span className="block truncate text-[13px] font-medium">{noteName(link.path)}</span>
            <span className="mt-0.5 line-clamp-2 text-xs leading-normal text-muted-foreground">{link.text}</span>
          </button>
        ))}
      </div>
    </motion.section>
  )
}
