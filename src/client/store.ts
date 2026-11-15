import { toast } from 'sonner'
import { create } from 'zustand'
import { parentOf, resolveLink } from '../shared/links'
import { applyEvent } from '../shared/transcript'
import {
  defaultSettings,
  type AgentInfo,
  type AppState,
  type Change,
  type ChatState,
  type ContextRef,
  type Entry,
  type GitAction,
  type GitFile,
  type GitStatus,
  type ServerEvent,
  type SessionMeta,
  type Settings,
} from '../shared/types'
import { api, type GitBody } from './api'
import { AGENT_OVERLAY } from './lib/layout'

/** Where the window layout is kept; read here for whether the agent panel is open. */
export const LAYOUT_KEY = 'galena.layout'

/** An open note. The id stays the same when the note is renamed or moved. */
export interface Tab {
  id: number
  path: string
  /** Has edits that are not on disk yet. */
  dirty: boolean
  /** Changed on disk while it had unsaved edits. */
  conflict: boolean
}

/** Something attached to the message being written. `mention` is the `@label` that keeps it there. */
export type AttachedRef = ContextRef & { mention?: string }

export type FsEvent = Extract<ServerEvent, { type: 'fs' }>
type ChatMessage = Extract<ServerEvent, { type: 'chat' }>

interface State {
  phase: 'loading' | 'home' | 'workspace'
  vault: AppState['vault']
  recents: string[]
  entries: Entry[]
  /** Bumped whenever the vault changes on disk, to refresh derived views. */
  fsTick: number
  settings: Settings
  /** Agents published in the ACP registry. */
  agents: AgentInfo[]
  changes: Change[]
  /** The vault's repository; null until the server has looked at it. */
  git: GitStatus | null
  /** A Git action is running. */
  gitBusy: boolean
  /** The changed file whose diff or conflict is on screen. */
  gitFile: string | null

  tabs: Tab[]
  active: number | null
  /** A line the editor should scroll to once the tab is shown. */
  reveal: { id: number; line: number } | null

  sessions: SessionMeta[]
  /** Agent used for the next new chat. */
  agentId: string
  /** The session shown in the agent panel, often the agent's draft; null when there is none. */
  chatId: string | null
  /** Transcript of `chatId`; null while it loads. */
  chat: (ChatState & { seq: number }) | null
  /** Attachments of the message being written. */
  attached: readonly AttachedRef[]
  /** The agent panel is open, where it fits beside the editor. */
  agentOpen: boolean
  /** The side panel laid over the editor, on windows too narrow for it to fit beside. */
  drawer: Drawer | null
  /** Bumped to move the focus to the message box. */
  composerFocus: number

  modal: ModalName | null
}

export type Drawer = 'explorer' | 'agent'

export type ModalName = 'palette' | 'graph' | 'settings' | 'review' | 'folders' | 'new-vault' | 'diff' | 'conflict'

const emptyChat = { seq: 0, items: [], permissions: [] }

const emptyVault = {
  entries: [],
  changes: [],
  git: null,
  gitBusy: false,
  gitFile: null,
  tabs: [],
  active: null,
  reveal: null,
  sessions: [],
  chatId: null,
  chat: emptyChat,
  attached: [],
  drawer: null,
  modal: null,
} satisfies Partial<State>

export const useStore = create<State>(() => ({
  phase: 'loading',
  vault: null,
  recents: [],
  fsTick: 0,
  settings: defaultSettings,
  agents: [],
  agentId: '',
  agentOpen: readAgentOpen(),
  composerFocus: 0,
  ...emptyVault,
}))

const { getState: get, setState: set } = useStore

/** Lets the store reach the editor, which lives outside React state. */
export const editorHooks = {
  /** Saves pending edits of the note on screen. */
  flush: async (): Promise<void> => {},
}

const fsListeners = new Set<(event: FsEvent) => void>()

/** Subscribes to file changes in the vault; returns the unsubscribe function. */
export function onFsEvent(listener: (event: FsEvent) => void): () => void {
  fsListeners.add(listener)
  return () => fsListeners.delete(listener)
}

export function showError(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error)
  // The same message twice shows once.
  toast.error(message, { id: message })
}

export function setModal(modal: State['modal']): void {
  set({ modal })
}

// Startup and connection

/** Loads everything from the server; also used to recover after a reconnect. */
export async function sync(): Promise<void> {
  try {
    const state = await api.state()
    if (!state.vault) return set({ phase: 'home', ...state })
    connect()
    const [entries, settings, sessions, changes] = await Promise.all([
      api.tree(),
      api.settings(),
      api.sessions(),
      api.changes(),
    ])
    const agentId = get().agentId in settings.agents ? get().agentId : firstAgent(settings)
    set({ phase: 'workspace', ...state, entries, settings, sessions, changes, agentId })
    refreshGit()
  } catch {
    setTimeout(sync, 2000) // the server is unreachable; keep trying
    return
  }
  api.agents().then((agents) => set({ agents }), showError)
  // Back to the chat on screen, unless the server no longer has it (a restart drops drafts).
  const { chatId, sessions } = get()
  if (chatId && sessions.some((s) => s.id === chatId)) void selectChat(chatId)
  else void newChat()
}

let socket: WebSocket | undefined

function connect(): void {
  if (socket) return
  socket = new WebSocket(`ws://${location.host}/api/ws`)
  socket.onmessage = (message) => onServerEvent(JSON.parse(message.data))
  socket.onclose = () => {
    socket = undefined
    setTimeout(sync, 1000)
  }
}

let treeTimer: number | undefined

function onServerEvent(event: ServerEvent): void {
  switch (event.type) {
    case 'fs':
      for (const listener of fsListeners) listener(event)
      // A burst of file events (a git checkout, say) refreshes the tree once.
      clearTimeout(treeTimer)
      treeTimer = window.setTimeout(() => {
        api.tree().then((entries) => set({ entries, fsTick: get().fsTick + 1 }), showError)
      }, 80)
      break
    case 'changes':
      api.changes().then((changes) => set({ changes }), showError)
      break
    case 'git':
      set({ git: event.status })
      break
    case 'session': {
      const others = get().sessions.filter((s) => s.id !== event.meta.id)
      set({ sessions: [event.meta, ...others].sort((a, b) => b.updatedAt - a.updatedAt) })
      break
    }
    case 'session-deleted':
      set({ sessions: get().sessions.filter((s) => s.id !== event.id) })
      if (get().chatId === event.id) void newChat()
      break
    case 'chat':
      onChatMessage(event)
  }
}

// Vault and files

export async function openVault(path: string): Promise<void> {
  await api.openVault(path)
  set(emptyVault)
  await sync()
}

/** Makes a new folder inside `parent` and opens it as a vault. */
export async function createVault(parent: string, name: string): Promise<void> {
  await api.createVault(parent, name)
  set(emptyVault)
  await sync()
}

/** Takes a vault off the list of recent ones; its folder is left alone. */
export async function forgetVault(path: string): Promise<void> {
  await api.forgetVault(path)
  set({ recents: get().recents.filter((r) => r !== path) })
}

let nextTabId = 1

export function openNote(path: string, line?: number): void {
  let tab = get().tabs.find((t) => t.path === path)
  if (!tab) {
    tab = { id: nextTabId++, path, dirty: false, conflict: false }
    set({ tabs: [...get().tabs, tab] })
  }
  set({
    active: tab.id,
    reveal: line === undefined ? null : { id: tab.id, line },
    // The note is what the user wants to see next, not the explorer laid over it.
    ...(get().drawer === 'explorer' && { drawer: null }),
  })
}

export async function closeTab(id: number): Promise<void> {
  if (get().active === id) await editorHooks.flush()
  const { tabs, active } = get()
  const index = tabs.findIndex((t) => t.id === id)
  if (index < 0) return
  const rest = tabs.filter((t) => t.id !== id)
  const neighbour = rest[Math.min(index, rest.length - 1)]
  set({ tabs: rest, active: active === id ? (neighbour?.id ?? null) : active })
}

/** Opens the note a wikilink points to, creating it if it does not exist yet. */
export async function followLink(target: string): Promise<void> {
  const notes = get().entries.filter((e) => e.type === 'file').map((e) => e.path)
  const path = resolveLink(target, notes)
  if (path) openNote(path)
  else await createEntry(`${target.replace(/\.md$/i, '')}.md`, 'file').catch(showError)
}

export function patchTab(id: number, patch: Partial<Tab>): void {
  set({ tabs: get().tabs.map((tab) => (tab.id === id ? { ...tab, ...patch } : tab)) })
}

export async function createEntry(path: string, type: Entry['type']): Promise<void> {
  await api.create(path, type)
  if (type === 'file') openNote(path)
}

/** Creates an empty note at the vault root and opens it. */
export async function newNote(): Promise<void> {
  const taken = new Set(get().entries.map((entry) => entry.path))
  let name = 'Untitled'
  for (let n = 1; taken.has(`${name}.md`); n++) name = `Untitled ${n}`
  await createEntry(`${name}.md`, 'file')
}

/** Renames or moves a note or folder, keeping its open tabs. */
export async function movePath(from: string, to: string): Promise<void> {
  if (from === to) return
  // Pending edits must reach the old path before it moves.
  await editorHooks.flush()
  const before = get().tabs
  const moved = (path: string) =>
    path === from ? to : path.startsWith(`${from}/`) ? to + path.slice(from.length) : path
  set({ tabs: before.map((tab) => ({ ...tab, path: moved(tab.path) })) })
  try {
    await api.move(from, to)
  } catch (error) {
    set({ tabs: before })
    throw error
  }
}

export async function removePath(path: string): Promise<void> {
  await api.remove(path)
}

export async function saveSettings(settings: Settings): Promise<void> {
  set({ settings }) // optimistic; the server answers with the normalised version
  try {
    set({ settings: await api.saveSettings(settings) })
  } catch (error) {
    showError(error)
  }
  if (!(get().agentId in get().settings.agents)) {
    set({ agentId: firstAgent(get().settings) })
    // A chat from history stays on screen; an empty one follows the agent.
    const chat = get().sessions.find((s) => s.id === get().chatId)
    if (!chat || chat.draft) void newChat()
  }
}

function firstAgent(settings: Settings): string {
  return Object.keys(settings.agents)[0] ?? ''
}

// Git

/** Asks the server to look at the repository again. */
export function refreshGit(): void {
  // Quietly: this runs unasked, and a failure leaves the last known status.
  api.gitRun('refresh').then(
    (git) => set({ git }),
    () => {},
  )
}

// The server watches the repository, but file events do not arrive everywhere
// (network drives) and say nothing of what a terminal did meanwhile to files
// Galena does not show. Coming back to the window is a good moment to check.
window.addEventListener('focus', () => {
  if (get().phase === 'workspace') refreshGit()
})

/** Runs a Git action; false if it failed, in which case the error is on screen. */
export async function runGit<A extends GitAction>(action: A, ...body: GitBody<A>): Promise<boolean> {
  if (get().gitBusy) return false
  set({ gitBusy: true })
  try {
    // What is being typed must be on disk before it is committed or merged over.
    await editorHooks.flush()
    set({ git: await api.gitRun(action, ...body) })
    return true
  } catch (error) {
    showError(error)
    return false
  } finally {
    set({ gitBusy: false })
  }
}

/** Shows what happened to a changed file: its diff, or the conflict to resolve. */
export function showGitFile(file: GitFile): void {
  set({ gitFile: file.path, modal: file.status === 'conflict' ? 'conflict' : 'diff' })
}

/**
 * The note in the tree that Git named, if it is one: a changed file may be
 * anything, hidden folders included, and only the tree's notes can be opened.
 * Git may spell a path with other Unicode code points than the file system
 * does (macOS decomposes accents), so the tree's spelling is the one returned.
 */
export function gitNote(path: string, entries = get().entries): string | undefined {
  const wanted = path.normalize('NFC')
  return entries.find((entry) => entry.type === 'file' && entry.path.normalize('NFC') === wanted)?.path
}

/** Opens a note that Git named. */
export function openGitFile(path: string): void {
  const note = gitNote(path)
  if (note) openNote(note)
}

// Agent chat

/** Live events for a session whose snapshot is still loading. */
let buffered: ChatMessage[] = []

export async function selectChat(id: string): Promise<void> {
  buffered = []
  set({ chatId: id, chat: null })
  try {
    const detail = await api.session(id)
    if (get().chatId !== id) return
    set({ chat: detail })
    buffered.splice(0).forEach(onChatMessage)
  } catch (error) {
    showError(error)
    if (get().chatId === id) set({ chatId: null, chat: emptyChat })
  }
}

/** Shows the empty chat of the selected agent and starts the agent, so it is ready to type to. */
export async function newChat(): Promise<void> {
  const { agentId } = get()
  if (!agentId) return set({ chatId: null, chat: emptyChat })
  const meta = await api.draft(agentId).catch(showError)
  if (!meta || get().agentId !== agentId) return // failed, or another agent was picked meanwhile
  if (!get().sessions.some((s) => s.id === meta.id)) set({ sessions: [meta, ...get().sessions] })
  await selectChat(meta.id)
  try {
    await api.start(meta.id)
  } catch (error) {
    // The failure also shows in the chat; the toast is for someone still looking at it.
    if (get().chatId === meta.id) showError(error)
  }
}

export function pickAgent(agentId: string): void {
  set({ agentId })
  void newChat()
}

/** Opens the chat's ACP session if it is closed, as when a chat from history is about to be used. */
export function startChat(session: SessionMeta): void {
  if (session.status === 'stopped') void api.start(session.id).catch(showError)
}

// The message being written

const sameRef = (a: ContextRef, b: ContextRef) =>
  a.path === b.path && a.selection === b.selection && a.lines?.from === b.lines?.from

/** Attaches something to the message being written, once. */
export function attach(ref: AttachedRef): void {
  set(({ attached }) => (attached.some((other) => sameRef(other, ref)) ? {} : { attached: [...attached, ref] }))
}

export function setAttached(attached: readonly AttachedRef[]): void {
  set({ attached })
}

/**
 * Attaches text selected in a note, if any, and takes the user to the message
 * box, opening the agent panel when it is closed.
 */
export function addToChat(ref?: AttachedRef): void {
  if (ref) attach(ref)
  set(({ composerFocus }) => ({ ...showAgent(true), composerFocus: composerFocus + 1 }))
}

/** Opens or closes the agent panel: beside the editor where it fits, over it where it does not. */
export function toggleAgent(): void {
  const { drawer, agentOpen } = get()
  set(showAgent(matchMedia(AGENT_OVERLAY).matches ? drawer !== 'agent' : !agentOpen))
}

function showAgent(show: boolean): Partial<State> {
  if (!matchMedia(AGENT_OVERLAY).matches) return { agentOpen: show }
  return { drawer: show ? 'agent' : null }
}

export function setAgentOpen(agentOpen: boolean): void {
  set({ agentOpen })
}

export function setDrawer(drawer: Drawer | null): void {
  set({ drawer })
}

function readAgentOpen(): boolean {
  try {
    return JSON.parse(localStorage.getItem(LAYOUT_KEY) ?? '{}').showRight !== false
  } catch {
    return true
  }
}

function onChatMessage(message: ChatMessage): void {
  const { chatId, chat } = get()
  if (message.sessionId !== chatId) return
  if (!chat) return void buffered.push(message)
  // The snapshot already contains every event up to its own `seq`.
  if (message.seq <= chat.seq) return
  set({ chat: { ...applyEvent(chat, message.event), seq: message.seq } })
}

/** Folders that contain the given path, outermost first. */
export function ancestors(path: string): string[] {
  const parent = parentOf(path)
  return parent ? [...ancestors(parent), parent] : []
}
