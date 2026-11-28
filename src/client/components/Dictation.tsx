import { CircleAlert, LoaderCircle, Mic, Pause, Play, RotateCcw, Square, X } from 'lucide-react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { useEffect, useRef, type ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { smooth } from '@/lib/motion'
import { cn } from '@/lib/utils'
import {
  dictationLevel,
  discardDictation,
  pauseDictation,
  resumeDictation,
  retryDictation,
  startDictation,
  stopDictation,
  toggleDictation,
  useDictation,
  type DictationStatus,
} from '../dictation'
import { ariaShortcut, shortcutLabel, useShortcut } from '../shortcuts'
import { useStore } from '../store'

/**
 * The dictation bar, floating at the bottom of the editor while a note is
 * open and a key and a model for transcription are set. Once a recording
 * starts it stays until the recording is delivered or discarded, even if the
 * note is closed or the settings change, so the recording is never lost.
 */
export function Dictation() {
  const configured = useStore((s) => !!s.transcription?.configured && !!s.transcription.model)
  const hasNote = useStore((s) => s.active !== null)
  const status = useDictation((s) => s.status)

  // Leaving the vault throws the recording away with the editor.
  useEffect(() => () => discardDictation(), [])

  const shown = (configured && hasNote) || status !== 'idle'

  // Wherever the focus is, while the bar is there to show what it did.
  useShortcut('dictate', toggleDictation, shown)

  return (
    <AnimatePresence>
      {shown && (
        <motion.div
          key="dictation"
          role="toolbar"
          aria-label="Dictation"
          className={cn(
            'absolute inset-x-3 bottom-[max(0.75rem,env(safe-area-inset-bottom))] z-10 mx-auto flex h-12 items-center gap-1 rounded-full border bg-popover/95 p-1.5 text-popover-foreground shadow-lg backdrop-blur-sm',
            // Wide enough: a pill of its own size, in the middle. Narrow: the whole width, buttons as icons.
            '@lg:inset-x-6 @lg:w-fit @lg:max-w-[calc(100%-3rem)]',
          )}
          initial={{ opacity: 0, y: 12, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 12, scale: 0.98 }}
          transition={smooth}
        >
          <Contents status={status} />
        </motion.div>
      )}
    </AnimatePresence>
  )
}

function Contents({ status }: { status: DictationStatus }) {
  const elapsed = useDictation((s) => s.elapsed)
  const error = useDictation((s) => s.error)

  if (status === 'idle') {
    return (
      <Action
        label="Dictate"
        icon={<Mic />}
        onClick={() => void startDictation()}
        shortcut
        className="@max-lg:flex-1"
      />
    )
  }
  if (status === 'starting' || status === 'transcribing') {
    return (
      <>
        <span role="status" className="flex flex-1 items-center gap-2 px-2.5 text-[13px] text-muted-foreground">
          <LoaderCircle className="size-4 animate-spin" />
          {status === 'starting' ? 'Opening the microphone…' : 'Transcribing…'}
        </span>
        <Action label="Discard" icon={<X />} onClick={discardDictation} iconOnly />
      </>
    )
  }
  if (status === 'failed') {
    return (
      <>
        <span
          role="alert"
          title={error ?? undefined}
          className="flex min-w-0 flex-1 items-center gap-2 px-2.5 text-[13px] text-destructive @lg:max-w-96"
        >
          <CircleAlert className="size-4 shrink-0" />
          <span className="truncate">{error}</span>
        </span>
        <Action label="Retry" icon={<RotateCcw />} onClick={() => void retryDictation()} />
        <Action label="Discard" icon={<X />} onClick={discardDictation} iconOnly />
      </>
    )
  }

  const paused = status === 'paused'
  return (
    <>
      <span className="flex min-w-0 flex-1 items-center gap-2.5 pr-1 pl-3">
        <RecordingDot paused={paused} />
        <Waveform paused={paused} />
        <span className="font-mono text-xs text-muted-foreground tabular-nums">{clock(elapsed)}</span>
        <span role="status" className="sr-only">
          {paused ? 'Paused' : 'Recording'}
        </span>
      </span>
      {paused ? (
        <Action label="Resume" icon={<Play />} onClick={resumeDictation} />
      ) : (
        <Action label="Pause" icon={<Pause />} onClick={pauseDictation} />
      )}
      <Action
        label="Transcribe"
        icon={<Square className="fill-current" />}
        onClick={() => void stopDictation()}
        variant="default"
        shortcut
      />
      <Action label="Discard" icon={<X />} onClick={discardDictation} iconOnly />
    </>
  )
}

interface ActionProps {
  label: string
  icon: ReactNode
  onClick: () => void
  variant?: 'ghost' | 'default'
  /** Always just the icon; the others show their label where there is room. */
  iconOnly?: boolean
  /** Whether the dictation shortcut does the same, to say so in its tooltip. */
  shortcut?: boolean
  className?: string
}

function Action({ label, icon, onClick, variant = 'ghost', iconOnly, shortcut, className }: ActionProps) {
  return (
    <Button
      variant={variant}
      aria-label={label}
      aria-keyshortcuts={shortcut ? ariaShortcut('dictate') : undefined}
      title={shortcut ? `${label} (${shortcutLabel('dictate')})` : label}
      onClick={onClick}
      // A click keeps the focus where it was: whether the cursor is in the note decides where the text goes.
      onMouseDown={(event) => event.preventDefault()}
      className={cn(
        'h-9 shrink-0 rounded-full',
        iconOnly ? 'w-9 px-0 text-muted-foreground' : '@max-lg:w-9 @max-lg:px-0 @lg:px-3.5',
        className,
      )}
    >
      {icon}
      {!iconOnly && <span className="@max-lg:sr-only">{label}</span>}
    </Button>
  )
}

/** Red and beating while recording; still and grey while paused, or for anyone who prefers less motion. */
function RecordingDot({ paused }: { paused: boolean }) {
  const reduced = useReducedMotion()
  return (
    <span className="relative flex size-2.5 shrink-0" aria-hidden>
      {!paused && !reduced && (
        <span className="absolute inset-0 animate-ping rounded-full bg-destructive opacity-60 [animation-duration:1.6s]" />
      )}
      <span
        className={cn(
          'relative size-2.5 rounded-full transition-colors',
          paused ? 'bg-muted-foreground' : 'bg-destructive',
        )}
      />
    </span>
  )
}

const BARS = 24
const SAMPLE_MS = 80
/** The height of a bar in silence, as a share of the full one. */
const MIN_BAR = 0.12

/**
 * The microphone's loudness over the last couple of seconds, as a row of bars
 * that moves left. Drawn outside React, straight on the bars, as it changes
 * many times a second. Left out for anyone who prefers less motion.
 */
function Waveform({ paused }: { paused: boolean }) {
  const reduced = useReducedMotion()
  const row = useRef<HTMLSpanElement>(null)
  const levels = useRef<number[]>(Array(BARS).fill(0))

  useEffect(() => {
    if (reduced || paused) return
    let frame = 0
    let last = 0
    const draw = (time: number) => {
      frame = requestAnimationFrame(draw)
      if (time - last < SAMPLE_MS) return
      last = time
      const level = dictationLevel()
      if (level === null) return
      // Speech is quiet in RMS terms: the square root spreads it over the height.
      levels.current = [...levels.current.slice(1), Math.min(1, Math.sqrt(level) * 1.8)]
      const bars = row.current?.children ?? []
      for (let i = 0; i < bars.length; i++) {
        ;(bars[i] as HTMLElement).style.transform = `scaleY(${Math.max(MIN_BAR, levels.current[i]!)})`
      }
    }
    frame = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(frame)
  }, [reduced, paused])

  if (reduced) return null
  return (
    <span ref={row} aria-hidden className="flex h-6 min-w-0 flex-1 items-center gap-[3px] overflow-hidden @lg:w-36 @lg:flex-none">
      {Array.from({ length: BARS }, (_, i) => (
        <span
          key={i}
          className={cn(
            'h-full w-[3px] shrink-0 origin-center rounded-full transition-[transform,background-color] duration-100 ease-linear',
            paused ? 'bg-muted-foreground/50' : 'bg-brand',
          )}
          // Only where it starts: from then on the effect sets it, and React leaves it alone.
          style={{ transform: `scaleY(${MIN_BAR})` }}
        />
      ))}
    </span>
  )
}

/** Seconds as `m:ss`, or `h:mm:ss` past an hour. */
function clock(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = String(seconds % 60).padStart(2, '0')
  return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`
}
