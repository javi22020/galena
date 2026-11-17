import { Ellipsis, Moon, PanelLeft, PanelRight, Settings2, Sun, Waypoints } from 'lucide-react'
import { motion } from 'motion/react'
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type PointerEvent, type ReactNode } from 'react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { AGENT_OVERLAY, EXPLORER_OVERLAY, useMediaQuery } from '@/lib/layout'
import { smooth } from '@/lib/motion'
import { cn } from '@/lib/utils'
import { codeFonts, textFonts } from '../../shared/fonts'
import { editorHooks, LAYOUT_KEY, setAgentOpen, setDrawer, setModal, toggleAgent, useStore } from '../store'
import { toggleTheme, useTheme } from '../theme'
import { AgentPanel } from './AgentPanel'
import { Editor } from './Editor'
import { GitDiff } from './GitDiff'
import { GraphView } from './Graph'
import { IconButton } from './IconButton'
import { ImageView } from './ImageView'
import { MergeResolver } from './MergeResolver'
import { Palette } from './Palette'
import { Settings } from './Settings'
import { Sidebar } from './Sidebar'
import { ThemeToggle } from './ThemeToggle'

type Side = 'left' | 'right'

interface Layout {
  left: number
  right: number
  showLeft: boolean
}

const defaultLayout: Layout = { left: 264, right: 384, showLeft: true }

function readLayout(): Layout {
  try {
    return { ...defaultLayout, ...JSON.parse(localStorage.getItem(LAYOUT_KEY) ?? '{}') }
  } catch {
    return defaultLayout
  }
}

/** The most of the window a panel beside the editor takes, so the editor is never squeezed. */
const share: Record<Side, number> = { left: 0.33, right: 0.35 }

/** A panel's width as shown beside the editor, between 200 and 720 pixels and within its share. */
const fit = (side: Side, width: number) =>
  Math.min(720, innerWidth * share[side], Math.max(200, width))

/**
 * The main screen: sidebar, editor and agent panel side by side. A panel that
 * does not fit beside the editor is laid over it instead, and opened on demand.
 */
export function Workspace() {
  const fontSize = useStore((s) => s.settings.editor.fontSize)
  const fonts = useStore((s) => s.settings.editor.fonts)
  // The agent panel's state is in the store, which opens it to add a selection.
  const showRight = useStore((s) => s.agentOpen)
  const drawer = useStore((s) => s.drawer)
  const explorerOverlay = useMediaQuery(EXPLORER_OVERLAY)
  const agentOverlay = useMediaQuery(AGENT_OVERLAY)
  const [layout, setLayout] = useState<Layout>(readLayout)
  const update = (patch: Partial<Layout>) => setLayout((current) => ({ ...current, ...patch }))
  // From the width on screen, which a narrower window may have cut below the one kept.
  const resize = (side: Side, dx: number) =>
    setLayout((current) => ({ ...current, [side]: fit(side, fit(side, current[side]) + dx) }))

  const explorerOpen = explorerOverlay ? drawer === 'explorer' : layout.showLeft
  const agentShown = agentOverlay ? drawer === 'agent' : showRight
  const toggleExplorer = () =>
    explorerOverlay ? setDrawer(explorerOpen ? null : 'explorer') : update({ showLeft: !layout.showLeft })

  useEffect(() => {
    const { left, right, showLeft } = layout
    localStorage.setItem(LAYOUT_KEY, JSON.stringify({ left, right, showLeft, showRight }))
  }, [layout, showRight])

  // A panel laid over the editor that now fits beside it stays open there.
  // Before painting, so that it is never drawn shut in between.
  useLayoutEffect(() => {
    if (drawer === 'explorer' && !explorerOverlay) {
      update({ showLeft: true })
      setDrawer(null)
    } else if (drawer === 'agent' && !agentOverlay) {
      setAgentOpen(true)
      setDrawer(null)
    }
  }, [drawer, explorerOverlay, agentOverlay])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey)) return
      if (event.key === 'k') {
        event.preventDefault()
        setModal('palette')
      } else if (event.key === 's') {
        event.preventDefault()
        void editorHooks.flush()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <div
      className="flex h-full"
      style={
        {
          '--editor-font-size': `${fontSize}px`,
          '--editor-font-heading': textFonts[fonts.heading].family,
          '--editor-font-text': textFonts[fonts.text].family,
          '--editor-font-code': codeFonts[fonts.code].family,
        } as CSSProperties
      }
    >
      {/* While a panel is open over the editor, the rest of the page is out of
          reach, so Tab and screen readers stay in the panel as in a dialog. */}
      <SidePanel
        side="left"
        open={explorerOpen}
        overlay={explorerOverlay}
        covered={drawer === 'agent'}
        width={layout.left}
        onResize={(dx) => resize('left', dx)}
      >
        <Sidebar />
      </SidePanel>
      <Editor
        inert={drawer !== null}
        leading={
          <>
            <IconButton label="Toggle explorer" active={explorerOpen} onClick={toggleExplorer}>
              <PanelLeft />
            </IconButton>
            <Divider />
          </>
        }
        trailing={
          <>
            <span className="flex items-center gap-1 max-md:hidden">
              <IconButton label="Graph" onClick={() => setModal('graph')}>
                <Waypoints />
              </IconButton>
              <IconButton label="Settings" onClick={() => setModal('settings')}>
                <Settings2 />
              </IconButton>
              <ThemeToggle />
            </span>
            <MoreMenu />
            <Divider />
            <IconButton label="Toggle agent panel" active={agentShown} onClick={toggleAgent}>
              <PanelRight />
            </IconButton>
          </>
        }
      />
      <SidePanel
        side="right"
        open={agentShown}
        overlay={agentOverlay}
        covered={drawer === 'explorer'}
        width={layout.right}
        onResize={(dx) => resize('right', -dx)}
      >
        <AgentPanel />
      </SidePanel>

      <Palette />
      <GraphView />
      <Settings />
      <GitDiff />
      <MergeResolver />
      <ImageView />
    </div>
  )
}

const Divider = () => <span className="mx-1.5 h-[18px] w-px shrink-0 bg-border" />

/** The header's less used buttons, gathered in a menu on narrow windows. */
function MoreMenu() {
  const dark = useTheme((s) => s.theme === 'dark')
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <IconButton label="More" className="md:hidden">
          <Ellipsis />
        </IconButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-44">
        <DropdownMenuItem onSelect={() => setModal('graph')}>
          <Waypoints />
          Graph
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => setModal('settings')}>
          <Settings2 />
          Settings
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={toggleTheme}>
          {dark ? <Sun /> : <Moon />}
          {dark ? 'Light theme' : 'Dark theme'}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

interface SidePanelProps {
  side: Side
  open: boolean
  /** Laid over the editor instead of beside it, for windows too narrow to fit it. */
  overlay: boolean
  /** The other panel is open over this one, which is out of reach meanwhile. */
  covered: boolean
  width: number
  /** Called with the pixels the edge facing the editor was dragged by. */
  onResize: (dx: number) => void
  children: ReactNode
}

/**
 * A column beside the editor, or a panel that slides over it. Either way it is
 * the same element, so its content stays mounted and keeps its state, also
 * while it is shut and when the window crosses from one layout to the other.
 */
function SidePanel({ side, open, overlay, covered, width, onResize, children }: SidePanelProps) {
  const panel = useRef<HTMLElement>(null)
  /** What had the focus before the panel opened over the editor, to give it back. */
  const opener = useRef<HTMLElement | null>(null)
  const resizer = !overlay && open && <Resizer onResize={onResize} />
  const shut = side === 'left' ? '-100%' : '100%'
  // Opening and closing slide; crossing from one layout to the other snaps,
  // so the panel never shows part of itself on the way. The render that
  // crosses moves it at once, and the next one takes the new layout as settled.
  const [settled, setSettled] = useState(overlay)
  const crossing = settled !== overlay
  useLayoutEffect(() => setSettled(overlay), [overlay])

  // Like a dialog: the focus goes into the panel when it opens over the
  // editor, and back where it was when it closes. A layout effect, so that it
  // runs before the message box takes the focus to add a selection.
  useLayoutEffect(() => {
    const element = panel.current!
    const focused = document.activeElement instanceof HTMLElement ? document.activeElement : null
    if (!overlay) {
      opener.current = null
    } else if (open) {
      opener.current = focused && !element.contains(focused) ? focused : null
      if (!element.contains(focused)) element.focus({ preventScroll: true })
    } else if (opener.current && (!focused || focused === document.body || element.contains(focused))) {
      opener.current.focus({ preventScroll: true })
      opener.current = null
    }
  }, [overlay, open])

  // Escape closes it wherever the focus is, even on the page itself once what
  // had it is gone. Popups in it, and dialogs opened from it, claim their
  // Escape first by preventing its default.
  useEffect(() => {
    if (!overlay || !open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.defaultPrevented) setDrawer(null)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [overlay, open])

  return (
    <>
      {overlay && (
        <motion.div
          aria-hidden="true"
          className="fixed inset-0 z-40 bg-overlay"
          // Inherited when open, so a menu that blocks the body blocks this too
          // and the tap that opened it does not land here and close the panel.
          style={{ pointerEvents: open ? undefined : 'none' }}
          initial={false}
          animate={{ opacity: open ? 1 : 0 }}
          transition={smooth}
          onClick={() => setDrawer(null)}
        />
      )}
      {side === 'right' && resizer}
      <motion.aside
        ref={panel}
        tabIndex={-1}
        className={cn(
          'shrink-0 overflow-hidden bg-sidebar outline-none',
          overlay && 'fixed inset-y-0 z-40',
          overlay && (side === 'left' ? 'left-0' : 'right-0'),
          overlay && open && 'shadow-xl',
        )}
        initial={false}
        animate={overlay ? { width: 'auto', x: open ? 0 : shut } : { width: open ? 'auto' : 0, x: 0 }}
        transition={crossing ? { duration: 0 } : smooth}
        inert={!open || covered}
      >
        <div
          className={cn(
            'h-full',
            side === 'left' ? 'border-r' : 'border-l',
            // Laid over the editor, the agent panel leaves a strip of it in sight.
            overlay && (side === 'left' ? 'w-[min(320px,85vw)]' : 'w-[min(420px,calc(100vw-24px))]'),
          )}
          style={overlay ? undefined : { width, maxWidth: `${share[side] * 100}vw` }}
        >
          {children}
        </div>
      </motion.aside>
      {side === 'left' && resizer}
    </>
  )
}

/** A draggable strip over a panel's edge; reports horizontal movement in pixels. */
function Resizer({ onResize }: { onResize: (dx: number) => void }) {
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) onResize(event.movementX)
  }
  return (
    <div
      className="z-10 -mx-[3px] w-1.5 shrink-0 cursor-col-resize touch-none transition-colors hover:bg-brand/40 active:bg-brand/40"
      onPointerDown={(e) => e.currentTarget.setPointerCapture(e.pointerId)}
      onPointerMove={onPointerMove}
    />
  )
}
