import type { AuthMethod } from '@agentclientprotocol/sdk'
import { History, KeyRound, PenLine, Trash2 } from 'lucide-react'
import { motion } from 'motion/react'
import { useState, type ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { Kbd } from '@/components/ui/kbd'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemFooter,
  ItemMedia,
  ItemTitle,
} from '@/components/ui/item'
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from '@/components/ui/message-scroller'
import { enterProps, outExpo } from '@/lib/motion'
import { cn } from '@/lib/utils'
import type { SessionMeta } from '../../shared/types'
import { api } from '../api'
import { shortcutLabel } from '../shortcuts'
import { newChat, pickAgent, selectChat, showError, useStore } from '../store'
import { Composer } from './Composer'
import { ModelPicker, modelOption } from './ConfigOptions'
import { ConfirmDialog } from './ConfirmDialog'
import { IconButton } from './IconButton'
import { Picker } from './Picker'
import { Transcript } from './Transcript'

/** Chat with the selected agent: header, transcript, status and composer. */
export function AgentPanel() {
  const sessions = useStore((s) => s.sessions)
  const chatId = useStore((s) => s.chatId)
  const chat = useStore((s) => s.chat)
  const agentId = useStore((s) => s.agentId)
  const enabled = useStore((s) => s.settings.agents)
  const registry = useStore((s) => s.agents)
  const [deleting, setDeleting] = useState(false)
  const session = sessions.find((s) => s.id === chatId)
  const model = session && modelOption(session)
  const running = session?.status === 'running'
  // Empty chats are not history: there is one per agent, and it is the one "New chat" shows.
  const history = sessions.filter((s) => !s.draft)

  const agentName = (id: string) => registry.find((agent) => agent.id === id)?.name ?? id
  const agentIds = Object.keys(enabled)

  return (
    <div className="flex h-full flex-col">
      <header className="flex h-[52px] shrink-0 items-center gap-1.5 border-b pr-2.5 pl-2">
        <div className="flex min-w-0 flex-1 items-center gap-2 text-[13px]">
          {session && !session.draft ? (
            // A session keeps its agent, even one that was later disabled in the settings.
            <>
              <StatusDot status={session.status} className="ml-2.5" />
              <span className="shrink-0 font-medium">{agentName(session.agentId)}</span>
              <span className="truncate text-muted-foreground">{session.title}</span>
            </>
          ) : agentIds.length ? (
            <Picker
              label="Agent"
              variant="ghost"
              value={session?.agentId ?? agentId}
              options={agentIds.map((id) => ({ value: id, label: agentName(id) }))}
              onChange={pickAgent}
            >
              <StatusDot status={session?.status} />
            </Picker>
          ) : (
            <span className="px-2.5 text-muted-foreground">No agent</span>
          )}
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <IconButton label="Chats">
              <History />
            </IconButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-72">
            <DropdownMenuLabel>Chats</DropdownMenuLabel>
            {!history.length && <DropdownMenuItem disabled>No chats yet</DropdownMenuItem>}
            <DropdownMenuRadioGroup value={chatId ?? ''} onValueChange={(id) => void selectChat(id)}>
              {history.map((s) => (
                <DropdownMenuRadioItem key={s.id} value={s.id}>
                  <StatusDot status={s.status} />
                  <span className="truncate">{s.title}</span>
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
            {session && !session.draft && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive" onSelect={() => setDeleting(true)}>
                  <Trash2 />
                  Delete this chat
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
        <IconButton label="New chat" onClick={() => void newChat()}>
          <PenLine />
        </IconButton>
      </header>

      <div className="relative flex min-h-0 flex-1">
        {/*
          The model of the chat, floating over the top of it, once the agent says which it offers.
          The chat leaves room for it either way, so it does not move when the model comes or goes.
        */}
        {session && model && (
          <div className="absolute top-3 left-1/2 z-10 -translate-x-1/2 rounded-full border bg-background shadow-xs">
            <ModelPicker session={session} option={model} />
          </div>
        )}
        {chat ? (
          // Follows the reply as it streams, unless the user has scrolled up
          // to read. A saved chat opens at its last question.
          <MessageScrollerProvider key={chatId ?? 'new'} autoScroll defaultScrollPosition="last-anchor">
            <MessageScroller>
              <MessageScrollerViewport>
                <MessageScrollerContent aria-busy={running} className="px-4 pt-16 pb-5">
                  <Transcript chat={chat} sessionId={chatId} running={running} />
                  {!chat.items.length && (
                    <MessageScrollerItem className="m-auto">
                      <Hint>
                        {agentIds.length ? (
                          <>
                            Ask the agent about your notes. Type @ to mention a note or folder, or select text
                            in a note{' '}
                            <span className="pointer-coarse:hidden">
                              and press <Kbd>{shortcutLabel('addToChat')}</Kbd>{' '}
                            </span>
                            to add it.
                          </>
                        ) : (
                          'No agent is enabled. Add one in Settings.'
                        )}
                      </Hint>
                    </MessageScrollerItem>
                  )}
                  {session && <Status session={session} />}
                </MessageScrollerContent>
              </MessageScrollerViewport>
              <MessageScrollerButton />
            </MessageScroller>
          </MessageScrollerProvider>
        ) : (
          <Hint>Loading…</Hint>
        )}
      </div>

      <div className="flex shrink-0 flex-col px-3 pb-3">
        <Composer session={session} />
      </div>

      <ConfirmDialog
        request={
          deleting && session
            ? {
                title: 'Delete this chat?',
                description: `"${session.title}" and its transcript are removed for good.`,
                action: 'Delete',
                run: () => api.deleteSession(session.id).catch(showError),
              }
            : null
        }
        onClose={() => setDeleting(false)}
      />
    </div>
  )
}

const statusColor: Record<SessionMeta['status'], string> = {
  stopped: 'text-muted-foreground/50',
  starting: 'text-warning',
  ready: 'text-success',
  running: 'text-success',
  auth: 'text-warning',
}

/** What a session's agent is doing; ripples while it is busy. */
function StatusDot({ status = 'stopped', className }: { status?: SessionMeta['status']; className?: string }) {
  const busy = status === 'starting' || status === 'running'
  return (
    <span
      title={status}
      className={cn('relative size-[7px] shrink-0 rounded-full bg-current', statusColor[status], className)}
    >
      {busy && (
        <motion.span
          className="absolute -inset-[3px] rounded-full border-2 border-current"
          animate={{ opacity: [0.5, 0], scale: [0.6, 1.6] }}
          transition={{ duration: 2, ease: outExpo, repeat: Infinity }}
        />
      )}
    </span>
  )
}

function Hint({ children }: { children: ReactNode }) {
  return <p className="m-auto max-w-64 text-center text-[13px] text-muted-foreground">{children}</p>
}

/** What the agent is up to, as the last rows of the conversation. */
function Status({ session }: { session: SessionMeta }) {
  const { status, error, authMethods } = session
  return (
    <>
      {status === 'starting' && (
        <MessageScrollerItem className="text-[13px] text-muted-foreground">Starting the agent…</MessageScrollerItem>
      )}
      {status === 'running' && (
        <MessageScrollerItem>
          <Working />
        </MessageScrollerItem>
      )}
      {status === 'auth' && (
        <MessageScrollerItem>
          <Authentication sessionId={session.id} methods={authMethods ?? []} />
        </MessageScrollerItem>
      )}
      {error && (
        <MessageScrollerItem className="text-[13px] wrap-anywhere whitespace-pre-wrap text-destructive">
          {error}
        </MessageScrollerItem>
      )}
    </>
  )
}

/** Three dots that hop in turn while the agent works. */
function Working() {
  return (
    <div role="status" aria-label="Working" className="flex gap-1 px-0.5 py-1">
      {[0, 1, 2].map((dot) => (
        <motion.span
          key={dot}
          className="size-[5px] rounded-full bg-muted-foreground"
          animate={{ opacity: [0.25, 1, 0.25, 0.25], y: [0, -3, 0, 0] }}
          transition={{ duration: 1.2, times: [0, 0.4, 0.8, 1], ease: 'easeInOut', repeat: Infinity, delay: dot * 0.15 }}
        />
      ))}
    </div>
  )
}

/** Galena stores no credentials: the agent says how it wants to be signed in. */
function Authentication({ sessionId, methods }: { sessionId: string; methods: AuthMethod[] }) {
  const [busy, setBusy] = useState(false)

  const authenticate = async (methodId: string) => {
    setBusy(true)
    await api.authenticate(sessionId, methodId).catch(showError)
    setBusy(false)
  }

  return (
    <motion.div {...enterProps}>
      <Item variant="outline" size="sm">
        <ItemMedia variant="icon">
          <KeyRound />
        </ItemMedia>
        <ItemContent>
          <ItemTitle>This agent needs you to sign in</ItemTitle>
          {!methods.length && (
            <ItemDescription>Sign in with the agent's own CLI, then send your message.</ItemDescription>
          )}
        </ItemContent>
        {methods.map((method) => (
          <ItemFooter key={method.id}>
            <ItemContent>
              <ItemTitle>{method.name}</ItemTitle>
              {method.description && <ItemDescription>{method.description}</ItemDescription>}
            </ItemContent>
            <ItemActions>
              <Button variant="outline" size="sm" disabled={busy} onClick={() => authenticate(method.id)}>
                Authenticate
              </Button>
            </ItemActions>
          </ItemFooter>
        ))}
      </Item>
    </motion.div>
  )
}
