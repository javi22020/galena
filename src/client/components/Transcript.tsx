import {
  Brain,
  Circle,
  CircleCheck,
  CircleDot,
  Eye,
  File,
  FileText,
  FolderInput,
  Globe,
  ListTodo,
  LoaderCircle,
  Pencil,
  Search,
  ShieldQuestion,
  Terminal,
  Trash2,
  Wrench,
} from 'lucide-react'
import { motion } from 'motion/react'
import { memo, useMemo, useState, type ComponentProps, type ReactNode } from 'react'
import { Streamdown, useIsCodeFenceIncomplete, type Components, type ExtraProps } from 'streamdown'
import {
  Attachment,
  AttachmentActions,
  AttachmentContent,
  AttachmentMedia,
  AttachmentTitle,
} from '@/components/ui/attachment'
import { Bubble, BubbleContent } from '@/components/ui/bubble'
import { Button } from '@/components/ui/button'
import {
  CodeBlock,
  CodeBlockActions,
  CodeBlockContent,
  CodeBlockCopyButton,
  CodeBlockHeader,
  CodeBlockLine,
  CodeBlockTitle,
} from '@/components/ui/code-block'
import { Item, ItemActions, ItemContent, ItemMedia, ItemTitle } from '@/components/ui/item'
import { Message, MessageContent } from '@/components/ui/message'
import { MessageScrollerItem } from '@/components/ui/message-scroller'
import {
  Trace,
  TraceCollapsible,
  TraceCollapsibleContent,
  TraceCollapsibleTrigger,
  TraceDescription,
  TraceIcon,
  TraceLine,
  TraceTitle,
} from '@/components/ui/trace'
import { useHighlightedCode } from '@/hooks/use-highlighted-code'
import { enter } from '@/lib/motion'
import { noteName } from '../../shared/links'
import { blockText } from '../../shared/transcript'
import type { ChatItem, ChatState, ContextRef, PermissionRequest } from '../../shared/types'
import { api } from '../api'
import { showError, useStore } from '../store'
import { Diff } from './Diff'

type ItemOf<Type extends ChatItem['type']> = Extract<ChatItem, { type: Type }>

/** Something the agent did on the way to its answer; drawn as a line of a trace. */
type Step = ItemOf<'thought' | 'tool' | 'plan'>

/** Part of an agent's turn: some text, or the steps taken between two texts. */
type Part = { index: number; text: string } | { index: number; steps: { index: number; item: Step }[] }

/** A row of the scroller: a message of the user, or all the agent did in reply. */
type Row = { index: number; user: ItemOf<'user'> } | { index: number; parts: Part[] }

/** Groups the flat list of items into rows. Every `index` is the position of an item, used as a key. */
function toRows(items: ChatItem[]): Row[] {
  const rows: Row[] = []
  items.forEach((item, index) => {
    if (item.type === 'user') return void rows.push({ index, user: item })
    let row = rows.at(-1)
    if (!row || 'user' in row) rows.push((row = { index, parts: [] }))
    if (item.type === 'agent') return void row.parts.push({ index, text: item.text })
    let part = row.parts.at(-1)
    if (!part || 'text' in part) row.parts.push((part = { index, steps: [] }))
    part.steps.push({ index, item })
  })
  return rows
}

const MotionItem = motion.create(MessageScrollerItem)

interface TranscriptProps {
  chat: ChatState
  sessionId: string | null
  running: boolean
}

/**
 * The conversation of one chat, as the rows of a `MessageScrollerContent`.
 * Mount it anew for every chat.
 */
export function Transcript({ chat, sessionId, running }: TranscriptProps) {
  // What the chat already held when it was opened appears at once; only what
  // arrives afterwards animates in.
  const [loaded] = useState(chat.items.length)
  const rows = useMemo(() => toRows(chat.items), [chat.items])
  const last = chat.items.length - 1

  return (
    <>
      {rows.map((row, position) => {
        const id = String(row.index)
        if ('user' in row) {
          // The user's message anchors the turn: it settles near the top and
          // the reply streams in below it.
          return (
            <MotionItem
              key={id}
              messageId={id}
              scrollAnchor
              variants={enter}
              initial={row.index >= loaded && 'hidden'}
              animate="show"
            >
              <Message align="end">
                <MessageContent className="gap-1.5">
                  <Bubble align="end">
                    <BubbleContent className="whitespace-pre-wrap">{row.user.text}</BubbleContent>
                  </Bubble>
                  {row.user.context.length > 0 && (
                    <div className="flex flex-wrap justify-end gap-1">
                      {row.user.context.map((context, index) => (
                        <ContextChip key={index} context={context} />
                      ))}
                    </div>
                  )}
                  {row.user.activeNote && (
                    <span
                      className="flex items-center justify-end gap-1 text-xs text-muted-foreground"
                      title={row.user.activeNote}
                    >
                      <Eye className="size-3 shrink-0" />
                      <span className="truncate">{noteName(row.user.activeNote)}</span>
                    </span>
                  )}
                </MessageContent>
              </Message>
            </MotionItem>
          )
        }
        // Only the last turn can still be going.
        const live = running && position === rows.length - 1
        return (
          <MessageScrollerItem key={id} messageId={id}>
            <Message>
              <MessageContent className="gap-3">
                {row.parts.map((part) =>
                  'text' in part ? (
                    <Entrance key={part.index} fresh={part.index >= loaded}>
                      <Rendered text={part.text} streaming={live && part.index === last} />
                    </Entrance>
                  ) : (
                    <Trace key={part.index}>
                      {part.steps.map(({ index, item }) => (
                        <Entrance key={index} fresh={index >= loaded}>
                          <StepLine item={item} live={live} streaming={live && index === last} />
                        </Entrance>
                      ))}
                    </Trace>
                  ),
                )}
              </MessageContent>
            </Message>
          </MessageScrollerItem>
        )
      })}
      {sessionId &&
        chat.permissions.map((request) => (
          <MessageScrollerItem key={request.id}>
            <Permission sessionId={sessionId} request={request} />
          </MessageScrollerItem>
        ))}
    </>
  )
}

interface EntranceProps {
  /** False for content that was already there, which skips the animation. */
  fresh?: boolean
  className?: string
  children: ReactNode
}

function Entrance({ fresh = true, className, children }: EntranceProps) {
  return (
    <motion.div variants={enter} initial={fresh && 'hidden'} animate="show" className={className}>
      {children}
    </motion.div>
  )
}

/** Where a selection is: `L12` or `L12–18`. */
function where({ lines }: ContextRef): string {
  if (!lines) return '(selection)'
  return lines.from === lines.to ? `L${lines.from}` : `L${lines.from}–${lines.to}`
}

/** A note, folder or selection attached to a message. Children go where its actions are. */
export function ContextChip({ context, children }: { context: ContextRef; children?: ReactNode }) {
  return (
    <Attachment size="xs" className="min-w-0" title={context.selection ?? context.path}>
      <AttachmentMedia>
        <File />
      </AttachmentMedia>
      <AttachmentContent>
        <AttachmentTitle>
          {noteName(context.path)}
          {context.selection !== undefined && <span className="text-muted-foreground"> {where(context)}</span>}
        </AttachmentTitle>
      </AttachmentContent>
      {children && <AttachmentActions>{children}</AttachmentActions>}
    </Attachment>
  )
}

const components: Components = { code: Code }

/** Markdown written by an agent, which may still be writing it. */
function Rendered({ text, streaming }: { text: string; streaming: boolean }) {
  return (
    <Streamdown controls={false} components={components} isAnimating={streaming}>
      {text}
    </Streamdown>
  )
}

function Code({ node: _, className, children, ...props }: ComponentProps<'code'> & ExtraProps) {
  // Streamdown marks fenced code with data-block. Everything else is inline.
  if (!('data-block' in props)) {
    return (
      <code className="rounded-sm bg-muted px-1 py-0.5 font-mono text-[0.9em]" {...props}>
        {children}
      </code>
    )
  }
  return (
    <Fenced
      code={typeof children === 'string' ? children : ''}
      language={/language-(\S+)/.exec(className ?? '')?.[1] ?? ''}
    />
  )
}

function Fenced({ code, language }: { code: string; language: string }) {
  // True while the closing fence has not arrived yet.
  const incomplete = useIsCodeFenceIncomplete()
  const lines = useHighlightedCode(code, language)
  return (
    <CodeBlock size="sm">
      <CodeBlockActions>
        <CodeBlockCopyButton value={code} disabled={incomplete} />
      </CodeBlockActions>
      <CodeBlockContent>
        {lines.map((line, index) => (
          <CodeBlockLine key={index}>{line}</CodeBlockLine>
        ))}
      </CodeBlockContent>
    </CodeBlock>
  )
}

interface StepLineProps {
  item: Step
  /** The turn this step belongs to is still going. */
  live: boolean
  /** This step is the one being written right now. */
  streaming: boolean
}

const StepLine = memo(function StepLine({ item, live, streaming }: StepLineProps) {
  switch (item.type) {
    case 'thought':
      return <Reasoning text={item.text} running={streaming} />
    case 'tool':
      return <ToolCall item={item} live={live} />
    case 'plan':
      return <Plan entries={item.entries} live={live} />
  }
})

/** Open while the agent thinks and closed once it is done, unless the user says otherwise. */
function Reasoning({ text, running }: { text: string; running: boolean }) {
  const [open, setOpen] = useState<boolean>()
  return (
    <TraceCollapsible open={open ?? running} onOpenChange={setOpen}>
      <TraceCollapsibleTrigger>
        <TraceLine status={running ? 'running' : undefined}>
          <TraceIcon>{running ? <LoaderCircle className="animate-spin" /> : <Brain />}</TraceIcon>
          <TraceTitle>{running ? 'Thinking' : 'Thought'}</TraceTitle>
        </TraceLine>
      </TraceCollapsibleTrigger>
      <TraceCollapsibleContent>
        <Rendered text={text} streaming={running} />
      </TraceCollapsibleContent>
    </TraceCollapsible>
  )
}

const toolIcon: Partial<Record<ItemOf<'tool'>['kind'], ReactNode>> = {
  read: <FileText />,
  edit: <Pencil />,
  delete: <Trash2 />,
  move: <FolderInput />,
  search: <Search />,
  execute: <Terminal />,
  think: <Brain />,
  fetch: <Globe />,
}

function ToolCall({ item, live }: { item: ItemOf<'tool'>; live: boolean }) {
  const root = useStore((s) => s.vault?.path)
  const relative = (path: string) => (root && path.startsWith(`${root}/`) ? path.slice(root.length + 1) : path)
  const active = item.status === 'pending' || item.status === 'in_progress'
  // A call left unfinished by a cancelled or failed turn will never complete.
  const stopped = active && !live

  const line = (
    <TraceLine status={item.status === 'failed' ? 'error' : stopped ? 'pending' : active ? 'running' : undefined}>
      <TraceIcon>{toolIcon[item.kind] ?? <Wrench />}</TraceIcon>
      <TraceTitle>{item.title || item.kind}</TraceTitle>
      {item.status === 'failed' && <TraceDescription>Failed</TraceDescription>}
      {stopped && <TraceDescription>Stopped</TraceDescription>}
    </TraceLine>
  )
  // Nothing to open until the call has something to show.
  if (!item.content.some((content) => content.type === 'content' || content.type === 'diff')) return line

  return (
    <TraceCollapsible>
      <TraceCollapsibleTrigger>{line}</TraceCollapsibleTrigger>
      <TraceCollapsibleContent className="flex flex-col gap-2">
        {item.content.map((content, index) => {
          if (content.type === 'content') {
            return (
              <CodeBlock key={index} size="sm">
                <CodeBlockContent wrap className="max-h-64">
                  {blockText(content.content)}
                </CodeBlockContent>
              </CodeBlock>
            )
          }
          if (content.type === 'diff') {
            return (
              <CodeBlock key={index} size="sm">
                <CodeBlockHeader>
                  <CodeBlockTitle>{relative(content.path)}</CodeBlockTitle>
                </CodeBlockHeader>
                <Diff before={content.oldText ?? ''} after={content.newText} className="max-h-64" />
              </CodeBlock>
            )
          }
          return null
        })}
      </TraceCollapsibleContent>
    </TraceCollapsible>
  )
}

function Plan({ entries, live }: { entries: ItemOf<'plan'>['entries']; live: boolean }) {
  const done = entries.filter((entry) => entry.status === 'completed').length
  return (
    <TraceCollapsible defaultOpen>
      <TraceCollapsibleTrigger>
        <TraceLine status={live && done < entries.length ? 'running' : undefined}>
          <TraceIcon>
            <ListTodo />
          </TraceIcon>
          <TraceTitle>Plan</TraceTitle>
          <TraceDescription>
            {done} of {entries.length} done
          </TraceDescription>
        </TraceLine>
      </TraceCollapsibleTrigger>
      <TraceCollapsibleContent>
        <Trace>
          {entries.map((entry, index) => {
            const doing = entry.status === 'in_progress'
            return (
              // Entries are sentences, so they wrap instead of being cut short.
              <TraceLine
                key={index}
                status={entry.status === 'pending' ? 'pending' : doing && live ? 'running' : undefined}
                className="items-start"
              >
                <TraceIcon className="mt-0.5">
                  {entry.status === 'completed' ? <CircleCheck /> : doing ? <CircleDot /> : <Circle />}
                </TraceIcon>
                <TraceTitle className="whitespace-normal">{entry.content}</TraceTitle>
              </TraceLine>
            )
          })}
        </Trace>
      </TraceCollapsibleContent>
    </TraceCollapsible>
  )
}

/** A question for the user rather than a step of the agent, so it stays out of the trace. */
function Permission({ sessionId, request }: { sessionId: string; request: PermissionRequest }) {
  const answer = (optionId: string) =>
    api.answerPermission(sessionId, request.id, optionId).catch(showError)

  return (
    <Entrance>
      <Item variant="outline" size="sm">
        <ItemMedia variant="icon">
          <ShieldQuestion />
        </ItemMedia>
        {/* Wide enough to read: in a narrow panel the answers go on a line of their own. */}
        <ItemContent className="basis-40">
          {/* Shown whole: it is what the user is asked to allow. */}
          <ItemTitle className="line-clamp-none wrap-anywhere">{request.title}</ItemTitle>
        </ItemContent>
        <ItemActions className="flex-wrap">
          {request.options.map((option) => (
            <Button
              key={option.optionId}
              size="sm"
              variant={option.kind.startsWith('allow') ? 'default' : 'outline'}
              onClick={() => answer(option.optionId)}
            >
              {option.name}
            </Button>
          ))}
        </ItemActions>
      </Item>
    </Entrance>
  )
}
