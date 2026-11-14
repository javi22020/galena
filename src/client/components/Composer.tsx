import { ArrowUp, Eye, EyeOff, File, Folder, Square, X } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useRef, useState, type ChangeEvent, type FormEvent, type KeyboardEvent } from 'react'
import { AttachmentAction } from '@/components/ui/attachment'
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupTextarea } from '@/components/ui/input-group'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { quick } from '@/lib/motion'
import { cn } from '@/lib/utils'
import { noteName } from '../../shared/links'
import { hasMention, mentionLabel, pruneMentions, rankMentions, removeMention } from '../../shared/mentions'
import type { Entry, SessionMeta } from '../../shared/types'
import { api } from '../api'
import { attach, editorHooks, setAttached, showError, startChat, useStore, type AttachedRef } from '../store'
import { ConfigOptions } from './ConfigOptions'
import { ContextChip } from './Transcript'

/** `@query` right before the caret. */
const MENTION = /(?:^|\s)@([^\s@]*)$/

/**
 * Message box with @-mentions and the agent's options. Selected text is
 * attached from the editor (see selection.ts), and the note on screen goes
 * with each message as a path, unless the user leaves it out.
 */
export function Composer({ session }: { session: SessionMeta | undefined }) {
  const disabled = !session
  const entries = useStore((s) => s.entries)
  const attached = useStore((s) => s.attached)
  const focusTick = useStore((s) => s.composerFocus)
  const activePath = useStore((s) => s.tabs.find((t) => t.id === s.active)?.path)
  const [text, setText] = useState('')
  const [mention, setMention] = useState<{ query: string; index: number } | null>(null)
  // The open note the user chose not to send; showing another note sends it again.
  const [hidden, setHidden] = useState<string | null>(null)
  const [sending, setSending] = useState(false)
  const input = useRef<HTMLTextAreaElement>(null)
  const running = session?.status === 'running'
  const activeNote = activePath !== undefined && activePath !== hidden ? activePath : undefined

  const candidates = mention ? rankMentions(entries, mention.query) : []

  // Selected text was just added from the editor.
  useEffect(() => {
    if (focusTick) input.current?.focus()
  }, [focusTick])

  /** Sets the text and drops the notes whose mention it no longer has. */
  const write = (value: string) => {
    setText(value)
    const kept = pruneMentions(value, useStore.getState().attached)
    if (kept !== useStore.getState().attached) setAttached(kept)
  }

  const onChange = (event: ChangeEvent<HTMLTextAreaElement>) => {
    const { value, selectionStart } = event.target
    write(value)
    const match = MENTION.exec(value.slice(0, selectionStart))
    setMention(match ? { query: match[1]!, index: 0 } : null)
  }

  const pick = (entry: Entry) => {
    const field = input.current!
    const caret = field.selectionStart
    const label = mentionLabel(entry.path, entries)
    const before = text.slice(0, caret).replace(/@[^\s@]*$/, `@${label} `)
    setText(before + text.slice(caret))
    attach({ path: entry.path, mention: label })
    setMention(null)
    field.focus()
    // The caret goes after the mention, not to the end of the text.
    requestAnimationFrame(() => field.setSelectionRange(before.length, before.length))
  }

  /** Detaches a note, taking its mentions out of the text too. */
  const detach = (ref: AttachedRef) => {
    let rest = text
    while (ref.mention !== undefined && hasMention(rest, ref.mention)) rest = removeMention(rest, ref.mention)
    setText(rest)
    setAttached(attached.filter((other) => other !== ref))
  }

  const send = async () => {
    const prompt = text.trim()
    if (!prompt || sending || running || !session) return
    setSending(true)
    try {
      // So the agent finds on disk what the user sees.
      await editorHooks.flush()
      const context = attached.map(({ mention: _, ...ref }) => ref)
      await api.prompt(session.id, prompt, context, activeNote)
      setText('')
      setAttached([])
      setHidden(null)
    } catch (error) {
      showError(error) // the message stays in the box to be sent again
    } finally {
      setSending(false)
    }
  }

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.nativeEvent.isComposing) return
    if (mention && candidates.length) {
      const move = { ArrowDown: 1, ArrowUp: -1 }[event.key]
      if (move) {
        event.preventDefault()
        const index = (mention.index + move + candidates.length) % candidates.length
        return setMention({ ...mention, index })
      }
      if (event.key === 'Enter' || event.key === 'Tab') {
        event.preventDefault()
        return pick(candidates[mention.index]!)
      }
      if (event.key === 'Escape') {
        // Only the list closes, not the agent panel laid over the editor.
        event.preventDefault()
        return setMention(null)
      }
    }
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      void send()
    }
  }

  const onSubmit = (event: FormEvent) => {
    event.preventDefault()
    void send()
  }

  return (
    <form className="relative" onSubmit={onSubmit}>
      <AnimatePresence>
        {mention && candidates.length > 0 && (
          <motion.ul
            className="absolute inset-x-0 bottom-[calc(100%+6px)] z-10 origin-bottom rounded-lg border bg-popover p-1 text-[13px] shadow-lg"
            initial={{ opacity: 0, y: 6, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 6, scale: 0.97 }}
            transition={quick}
          >
            {candidates.map((entry, index) => (
              <li
                key={entry.path}
                className={cn(
                  'flex cursor-pointer items-center gap-2 rounded-md px-2 py-1 [&>svg]:size-3.5 [&>svg]:shrink-0 [&>svg]:text-muted-foreground',
                  index === mention.index && 'bg-accent',
                )}
                onMouseDown={(e) => {
                  e.preventDefault() // keep the focus in the text box
                  pick(entry)
                }}
              >
                {entry.type === 'dir' ? <Folder /> : <File />}
                <span className="truncate">{entry.path}</span>
              </li>
            ))}
          </motion.ul>
        )}
      </AnimatePresence>

      <InputGroup className="rounded-xl bg-background shadow-xs">
        {attached.length > 0 && (
          <InputGroupAddon align="block-start" className="flex-wrap gap-1">
            {attached.map((ref, index) => (
              <ContextChip key={index} context={ref}>
                <AttachmentAction aria-label={`Remove ${noteName(ref.path)}`} onClick={() => detach(ref)}>
                  <X />
                </AttachmentAction>
              </ContextChip>
            ))}
          </InputGroupAddon>
        )}

        <InputGroupTextarea
          ref={input}
          aria-label="Message the agent"
          value={text}
          onChange={onChange}
          onKeyDown={onKeyDown}
          onFocus={() => session && startChat(session)}
          onBlur={() => setMention(null)}
          placeholder="Ask about your vault, @ to mention a note…"
          disabled={disabled}
          className="max-h-[40vh] min-h-14 px-3"
        />

        {/* One line: the open note takes what room is left and is cut short first. */}
        <InputGroupAddon align="block-end" className="gap-1">
          <div className="flex min-w-0 flex-1 items-center">
            {activePath !== undefined && (
              <OpenNote
                path={activePath}
                sent={activeNote !== undefined}
                onToggle={() => setHidden(activeNote === undefined ? null : activePath)}
              />
            )}
          </div>
          <div className="flex min-w-0 items-center justify-end gap-1">
            {session && <ConfigOptions session={session} />}
            {running ? (
              <InputGroupButton
                aria-label="Stop"
                variant="outline"
                size="icon-sm"
                onClick={() => api.cancel(session.id).catch(showError)}
              >
                <Square className="size-3 fill-current" />
              </InputGroupButton>
            ) : (
              <InputGroupButton
                type="submit"
                aria-label="Send"
                variant="default"
                size="icon-sm"
                disabled={!text.trim() || sending || disabled}
              >
                <ArrowUp strokeWidth={2.2} />
              </InputGroupButton>
            )}
          </div>
        </InputGroupAddon>
      </InputGroup>
    </form>
  )
}

interface OpenNoteProps {
  path: string
  /** The agent is told about this note with the next message. */
  sent: boolean
  onToggle: () => void
}

/** The note on screen, which the agent is told about; a click leaves it out. */
function OpenNote({ path, sent, onToggle }: OpenNoteProps) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <InputGroupButton
          size="xs"
          aria-pressed={sent}
          className={cn('min-w-0 max-w-full shrink text-muted-foreground', !sent && 'line-through opacity-60')}
          onClick={onToggle}
        >
          {sent ? <Eye /> : <EyeOff />}
          <span className="truncate">{noteName(path)}</span>
        </InputGroupButton>
      </TooltipTrigger>
      <TooltipContent>
        {sent ? 'The agent sees which note you have open. Click to leave it out.' : 'Left out. Click to include it.'}
      </TooltipContent>
    </Tooltip>
  )
}
