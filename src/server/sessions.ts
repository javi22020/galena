import { randomUUID } from 'node:crypto'
import { readdir, rm } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  RequestError,
  type ContentBlock,
  type PermissionOption,
  type ReadTextFileRequest,
  type ReadTextFileResponse,
  type RequestPermissionRequest,
  type RequestPermissionResponse,
  type SessionConfigOption,
  type SessionUpdate,
  type WriteTextFileRequest,
} from '@agentclientprotocol/sdk'
import { accepts } from '../shared/config'
import { applyEvent } from '../shared/transcript'
import type {
  ChatEvent,
  ChatItem,
  ChatState,
  ContextRef,
  SessionDetail,
  SessionMeta,
} from '../shared/types'
import { AgentHost } from './agents'
import { launchCommand } from './registry'
import { configDir, errorMessage, HttpError, readJson, writeJson } from './util'
import type { Workspace } from './workspace'

const AUTH_REQUIRED = -32000
/** An open chat the user has left alone this long has its ACP session closed. */
const IDLE_MS = 5 * 60_000
/** Model and effort last chosen for each agent, by agent id and config id. */
const DEFAULTS_FILE = path.join(configDir, 'agent-config.json')
/** Writes to `DEFAULTS_FILE`, one after another. */
let savingDefaults = Promise.resolve()

/** What the user is offered when an agent writes a note it did not ask permission for. */
const WRITE_OPTIONS: PermissionOption[] = [
  { optionId: 'allow_once', name: 'Allow', kind: 'allow_once' },
  { optionId: 'allow_always', name: 'Allow all edits in this chat', kind: 'allow_always' },
  { optionId: 'reject_once', name: 'Reject', kind: 'reject_once' },
]

type Values = Record<string, string | boolean>
type Defaults = Record<string, Record<string, string>>

/** What is kept on disk for a session, under `.galena/sessions`. */
interface Stored {
  meta: Pick<SessionMeta, 'id' | 'agentId' | 'title' | 'updatedAt'>
  acpSessionId?: string
  /** Option values the chat asked for; see `Session.chosen`. */
  chosen?: Values
  items: ChatItem[]
}

/** All chat sessions of a vault, live or from history, and the agent processes they use. */
export class Sessions {
  private sessions = new Map<string, Session>()
  /** One process per agent, started on first use and kept until the vault closes. */
  private hosts = new Map<string, Promise<AgentHost>>()
  private defaults: Defaults = {}
  private closed = false
  private dir: string

  constructor(readonly workspace: Workspace) {
    this.dir = path.join(workspace.vault.configDir, 'sessions')
  }

  async load(): Promise<void> {
    const files = await readdir(this.dir).catch(() => [])
    for (const file of files.filter((name) => name.endsWith('.json'))) {
      const stored = await readJson<Stored | null>(path.join(this.dir, file), null)
      if (stored?.meta?.id) this.add(stored)
    }
    this.defaults = await readJson(DEFAULTS_FILE, {})
  }

  list(): SessionMeta[] {
    return [...this.sessions.values()]
      .map((session) => session.meta)
      .sort((a, b) => b.updatedAt - a.updatedAt)
  }

  get(id: string): Session {
    const session = this.sessions.get(id)
    if (!session) throw new HttpError(404, 'Session not found')
    return session
  }

  /** The empty chat of an agent, created if it has none, with the agent's remembered options. */
  draft(agentId: string): Session {
    if (this.closed) throw new HttpError(409, 'The vault is closing')
    let session = [...this.sessions.values()].find((s) => s.meta.draft && s.meta.agentId === agentId)
    session ??= this.add({
      meta: { id: randomUUID(), agentId, title: 'New chat', updatedAt: Date.now() },
      items: [],
    })
    session.adopt(this.defaults[agentId] ?? {})
    return session
  }

  async delete(id: string): Promise<void> {
    const session = this.get(id)
    this.sessions.delete(id)
    void session.delete().catch((error) => console.error('Could not end the agent session:', error))
    await rm(session.file, { force: true })
    this.workspace.broadcast({ type: 'session-deleted', id })
  }

  async close(): Promise<void> {
    this.closed = true
    await Promise.all([...this.sessions.values()].map((session) => session.close()))
    for (const host of this.hosts.values()) void host.then((running) => running.kill(), ignoreFailedStart)
    this.hosts.clear()
  }

  /** The process of an agent, started if it is not running. */
  agent(agentId: string): Promise<AgentHost> {
    if (this.closed) return Promise.reject(new HttpError(409, 'The vault is closing'))
    const running = this.hosts.get(agentId)
    if (running) return running

    const { settings, vault } = this.workspace
    const host = launchCommand(agentId, settings.agents[agentId]?.command).then((launch) =>
      AgentHost.start(launch, vault.root, (exited, reason) => {
        this.forget(agentId, host)
        this.detach(exited, reason)
      }),
    )
    this.hosts.set(agentId, host)
    void host.catch(() => this.forget(agentId, host))
    return host
  }

  /** Stops an agent whose launch command changed; its chats reopen in a new process. */
  restart(agentId: string): void {
    const host = this.hosts.get(agentId)
    if (!host) return
    this.hosts.delete(agentId)
    void host.then((running) => {
      this.detach(running)
      running.kill()
    }, ignoreFailedStart)
  }

  /** Retries the chats that were waiting for the sign-in that just succeeded. */
  retryAuth(host: AgentHost): void {
    for (const session of this.sessions.values()) {
      if (session.host !== host || session.meta.status !== 'auth') continue
      // The chat's status shows how it went.
      void session.start().catch(() => {})
    }
  }

  /** Remembers a model or effort choice for the agent's next chats. */
  remember(agentId: string, configId: string, value: string): void {
    // Every Galena running shares the file, so only this value is written over what it holds.
    savingDefaults = savingDefaults
      .then(async () => {
        const defaults = await readJson<Defaults>(DEFAULTS_FILE, {})
        defaults[agentId] = { ...defaults[agentId], [configId]: value }
        this.defaults = defaults
        await writeJson(DEFAULTS_FILE, defaults)
      })
      .catch((error) => console.error('Could not save agent options:', error))
  }

  private add(stored: Stored): Session {
    const file = path.join(this.dir, `${stored.meta.id}.json`)
    const session = new Session(this, stored, file)
    this.sessions.set(session.meta.id, session)
    return session
  }

  private forget(agentId: string, host: Promise<AgentHost>): void {
    if (this.hosts.get(agentId) === host) this.hosts.delete(agentId)
  }

  private detach(host: AgentHost, reason?: string): void {
    for (const session of this.sessions.values()) if (session.host === host) session.detach(reason)
  }
}

/** A failed start was already reported to whoever was waiting for it. */
function ignoreFailedStart(): void {}

/**
 * One conversation with an agent: an ACP session in the agent's process. The
 * session is opened when the chat is used, closed after a while without use,
 * and resumed when the chat is used again.
 *
 * Opening, closing and changing options run one at a time, in order (see
 * `run`); a turn runs alongside them, as ACP allows changing options and
 * cancelling while the agent works.
 */
export class Session {
  readonly meta: SessionMeta
  /** The agent process this chat last opened its ACP session in. */
  host?: AgentHost
  private chat: ChatState
  private seq = 0
  private acpSessionId?: string
  /**
   * Option values this chat asked for, by config id: the user's choices and the
   * agent's remembered defaults. They are applied again whenever the ACP
   * session opens, as a resumed session may have lost some (effort, say).
   */
  private chosen: Values
  /** True while `session/load` replays history we already have. */
  private replaying = false
  private waiting = new Map<string, (optionId: string | null) => void>()
  /** Notes the agent was allowed to edit by its own permission request, each for one write. */
  private approved = new Set<string>()
  /** The user allowed every edit in this chat. */
  private allowEdits = false
  private queue: Promise<unknown> = Promise.resolve()
  /** Deleted, or its vault closed: nothing of it is published or saved any more. */
  private ended = false
  private idle?: NodeJS.Timeout

  constructor(
    private owner: Sessions,
    stored: Stored,
    readonly file: string,
  ) {
    this.meta = { ...stored.meta, status: 'stopped', draft: !stored.items.length }
    this.chat = { items: stored.items, permissions: [] }
    this.acpSessionId = stored.acpSessionId
    this.chosen = stored.chosen ?? {}
  }

  private get workspace(): Workspace {
    return this.owner.workspace
  }

  /** The agent process, if this chat's ACP session is open in it. */
  private get live(): AgentHost | undefined {
    const { host, acpSessionId } = this
    return host && acpSessionId && host.serves(acpSessionId, this) ? host : undefined
  }

  detail(): SessionDetail {
    return { meta: this.meta, seq: this.seq, ...this.chat }
  }

  /** Makes sure this chat's ACP session is open. */
  start(): Promise<AgentHost> {
    return this.run(async () => this.live ?? (await this.open()))
  }

  /** Starts a turn. Resolves once the agent has the prompt, not when it finishes. */
  async prompt(text: string, context: ContextRef[], activeNote?: string): Promise<void> {
    const host = await this.start()
    if (this.meta.status !== 'ready') throw new HttpError(409, 'The agent is busy')
    const prompt = this.promptBlocks(host, text, context, activeNote)
    // The agent may speak first, so only `draft` tells whether the user has written yet.
    if (this.meta.draft) this.meta.title = text.trim().slice(0, 80)
    this.meta.draft = false
    this.meta.updatedAt = Date.now()
    this.emit({ type: 'user', text, context, activeNote })
    this.setStatus('running')
    void this.runTurn(host, prompt)
  }

  async cancel(): Promise<void> {
    const host = this.live
    if (this.meta.status !== 'running' || !host) return
    // ACP requires pending permission requests to be answered as cancelled.
    this.cancelPermissions()
    await host.peer.notify('session/cancel', { sessionId: this.acpSessionId! })
  }

  /** Answers a permission request; `null` cancels it. */
  answerPermission(requestId: string, optionId: string | null): void {
    const resolve = this.waiting.get(requestId)
    if (!resolve) throw new HttpError(404, 'Permission request not found')
    this.waiting.delete(requestId)
    this.emit({ type: 'permission-done', requestId })
    resolve(optionId)
  }

  async authenticate(methodId: string): Promise<void> {
    const host = await this.run(async () => {
      const waiting = this.host
      if (this.meta.status !== 'auth' || !waiting) {
        throw new HttpError(409, 'The agent is not waiting for authentication')
      }
      await waiting.alive(waiting.peer.request('authenticate', { methodId }))
      return this.open()
    })
    // The sign-in belongs to the process, so it unblocks its other chats too.
    this.owner.retryAuth(host)
  }

  /** Changes an option on the user's behalf. */
  setConfig(configId: string, value: string | boolean): Promise<void> {
    return this.run(async () => {
      // Options stay on screen while the chat is idle; picking one uses the chat again.
      if (!this.live) await this.open()
      const option = this.meta.configOptions?.find((o) => o.id === configId)
      if (!option) throw new HttpError(400, `The agent has no option "${configId}"`)
      if (!accepts(option, value)) throw new HttpError(400, `Invalid value for ${option.name}`)
      await this.apply(configId, value)
      this.chosen[configId] = value
      if (typeof value === 'string' && (option.category === 'model' || option.category === 'thought_level')) {
        this.owner.remember(this.meta.agentId, configId, value)
      }
      this.armIdle()
    })
  }

  /** Takes on remembered option values, applying them now if the session is open. */
  adopt(values: Record<string, string>): void {
    Object.assign(this.chosen, values)
    void this.run(async () => {
      if (this.live) await this.restore()
    })
  }

  /** The agent process ended: it exited (`reason` says why) or was stopped on purpose. */
  detach(reason?: string): void {
    this.host = undefined
    // A new process may offer other options.
    delete this.meta.configOptions
    // A start under way reports the failure itself. A turn usually does too,
    // but it may have ended first, when the connection closed before the exit.
    if (this.meta.status === 'ready' || this.meta.status === 'auth') this.setStatus('stopped', reason)
    else this.publish()
  }

  /** Ends the chat for good, and its ACP session with it. */
  async delete(): Promise<void> {
    this.ended = true
    clearTimeout(this.idle)
    this.cancelPermissions()
    await this.run(async () => {
      const host = this.live
      if (!host) return
      // Closing a session cancels its turn; agents that cannot close must be told.
      if (this.meta.status === 'running' && !host.capabilities.sessionCapabilities?.close) {
        await host.peer.notify('session/cancel', { sessionId: this.acpSessionId! })
      }
      await host.closeSession(this.acpSessionId!)
    })
  }

  /** Saves the chat as the vault closes; its agent process is killed next. */
  async close(): Promise<void> {
    clearTimeout(this.idle)
    this.cancelPermissions()
    await this.save()
    this.ended = true
  }

  onUpdate(update: SessionUpdate): void {
    if (update.sessionUpdate === 'config_option_update') return this.setOptions(update.configOptions)
    if (this.replaying) return
    if (update.sessionUpdate === 'session_info_update' && update.title) {
      this.meta.title = update.title
      this.publish()
    }
    this.emit({ type: 'update', update })
  }

  async requestPermission(params: RequestPermissionRequest): Promise<RequestPermissionResponse> {
    const { toolCall, options } = params
    // The request describes the tool call it is about; show it in the transcript.
    this.emit({ type: 'update', update: { ...toolCall, sessionUpdate: 'tool_call_update' } })

    const optionId = await this.decide(toolCall.title ?? 'Permission required', options)
    const kind = options.find((o) => o.optionId === optionId)?.kind
    // An edit the agent asked about is not asked about again when it writes the note,
    // nor any edit once it was allowed always, as the agent will not ask again.
    if (toolCall.kind === 'edit' && kind?.startsWith('allow')) {
      if (kind === 'allow_always') this.allowEdits = true
      for (const { path: abs } of toolCall.locations ?? []) {
        try {
          this.approved.add(this.workspace.vault.relative(abs))
        } catch {
          // Outside the vault, or hidden: Galena never writes it, so there is nothing to approve.
        }
      }
    }
    return { outcome: optionId ? { outcome: 'selected', optionId } : { outcome: 'cancelled' } }
  }

  /** Picks an option as the settings say, or waits for the user to; null if none is chosen. */
  private decide(title: string, options: PermissionOption[]): Promise<string | null> {
    if (this.workspace.settings.defaultPermission === 'allow') {
      const option = options.find((o) => o.kind === 'allow_once') ?? options.find((o) => o.kind === 'allow_always')
      return Promise.resolve(option?.optionId ?? null)
    }
    return new Promise((resolve) => {
      const request = { id: randomUUID(), title, options }
      this.waiting.set(request.id, resolve)
      this.emit({ type: 'permission', request })
    })
  }

  async readFile(request: ReadTextFileRequest): Promise<ReadTextFileResponse> {
    const { path: abs, line, limit } = request
    const content = await this.workspace.vault.read(this.workspace.vault.relative(abs))
    if (line == null && limit == null) return { content }
    const start = (line ?? 1) - 1
    const end = limit == null ? undefined : start + limit
    return { content: content.split('\n').slice(start, end).join('\n') }
  }

  /**
   * Agent writes need permission, as the settings say, unless the agent already
   * asked for this edit; whatever is written is still recorded as a reviewable change.
   */
  async writeFile({ path: abs, content }: WriteTextFileRequest): Promise<void> {
    const rel = this.workspace.vault.relative(abs)
    if (!this.allowEdits && !this.approved.delete(rel)) {
      const choice = await this.decide(`Edit ${rel}`, WRITE_OPTIONS)
      if (choice === 'allow_always') this.allowEdits = true
      else if (choice !== 'allow_once') throw new Error(`The user did not allow editing ${rel}`)
    }
    await this.workspace.changes.write(rel, content, this.meta.id)
  }

  /**
   * Runs `operation` once the previous one has settled, so that the operations
   * on a chat never overlap. Each caller gets its own result; a failure does
   * not stop the operations queued after it.
   */
  private run<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.queue.then(operation)
    this.queue = result.catch(() => {})
    return result
  }

  /** Opens the ACP session in the agent's process, starting the process if needed. */
  private async open(): Promise<AgentHost> {
    this.setStatus('starting')
    let host: AgentHost | undefined
    try {
      host = this.host = await this.owner.agent(this.meta.agentId)
      await this.openSession(host)
      await this.restore()
      // restore() carries on past rejected values, so it does not notice an exit.
      if (!this.live) throw new Error('The agent exited')
      this.setStatus('ready')
      return host
    } catch (error) {
      // The agent was restarted with a new launch command: open in the new process.
      if (host?.killed && !this.ended) return this.open()
      delete this.meta.configOptions
      if (host && error instanceof RequestError && error.code === AUTH_REQUIRED) {
        this.meta.authMethods = host.authMethods
        this.setStatus('auth')
        throw new HttpError(401, 'The agent requires authentication')
      }
      this.setStatus('stopped', errorMessage(error))
      throw new HttpError(502, errorMessage(error))
    }
  }

  /** Creates the ACP session, or reopens the one from an earlier use. */
  private async openSession(host: AgentHost): Promise<void> {
    const base = { cwd: this.workspace.vault.root, mcpServers: [] }
    // An ACP session with no messages cannot be reopened; a new one is created
    // instead, without what the agent said in the old one.
    const sessionId = this.meta.draft ? undefined : this.acpSessionId
    if (!sessionId) {
      if (this.chat.items.length) this.emit({ type: 'clear' })
      await host.createSession(base, this, (response) => {
        this.acpSessionId = response.sessionId
        this.setOptions(response.configOptions)
      })
      return
    }

    this.replaying = host.reopenMethod === 'session/load'
    try {
      const response = await host.reopenSession({ ...base, sessionId }, this)
      this.setOptions(response.configOptions)
    } finally {
      this.replaying = false
    }
  }

  /** Sets the chosen values the agent does not have, in the agent's order. */
  private async restore(): Promise<void> {
    // Each option is tried once. The list is read anew every time, since a
    // change may add options (an effort selector for a new model, say).
    const tried = new Set<string>()
    for (;;) {
      const option = this.meta.configOptions?.find((o) => {
        const value = this.chosen[o.id]
        return !tried.has(o.id) && value !== undefined && value !== o.currentValue && accepts(o, value)
      })
      if (!option) return
      tried.add(option.id)
      await this.apply(option.id, this.chosen[option.id]!).catch((error) => {
        console.error(`Could not restore ${option.name}:`, errorMessage(error))
      })
    }
  }

  /** Sends one option value to the agent and takes the options it answers with. */
  private async apply(configId: string, value: string | boolean): Promise<void> {
    const host = this.live
    if (!host) throw new Error('The agent is not running')
    const sessionId = this.acpSessionId!
    const { configOptions } = await host.request(
      'session/set_config_option',
      typeof value === 'boolean' ? { sessionId, configId, type: 'boolean', value } : { sessionId, configId, value },
    )
    this.setOptions(configOptions)
  }

  /** Takes the agent's full list of options and their current values. */
  private setOptions(options: SessionConfigOption[] | null | undefined): void {
    if (!this.live) return
    this.meta.configOptions = options ?? undefined
    // Follow changes the agent makes on its own (leaving plan mode, say), but
    // not while opening: a resumed session may report a default for a value it
    // lost, which restore() puts back.
    if (this.meta.status === 'ready' || this.meta.status === 'running') {
      for (const option of options ?? []) {
        if (option.id in this.chosen) this.chosen[option.id] = option.currentValue
      }
    }
    this.publish()
  }

  /**
   * Restarts the idle timer, if the agent can close the session and open it
   * again later. Every status change and option change calls this.
   */
  private armIdle(): void {
    clearTimeout(this.idle)
    this.idle = undefined
    if (this.meta.status !== 'ready' || !this.live?.canSuspend) return
    const timer = setTimeout(() => void this.run(() => this.suspend(timer)), IDLE_MS).unref()
    this.idle = timer
  }

  /** Closes the ACP session to free the agent's memory; the next start reopens it. */
  private async suspend(timer: NodeJS.Timeout): Promise<void> {
    // An operation queued before this one may have used the chat and restarted the timer.
    if (timer !== this.idle) return
    const host = this.live
    if (!host || this.meta.status !== 'ready') return
    this.setStatus('stopped')
    await host.closeSession(this.acpSessionId!)
  }

  private async runTurn(host: AgentHost, prompt: ContentBlock[]): Promise<void> {
    let error: string | undefined
    try {
      const request = host.peer.request('session/prompt', { sessionId: this.acpSessionId!, prompt })
      const { stopReason } = await host.alive(request)
      if (stopReason !== 'end_turn' && stopReason !== 'cancelled') {
        error = `The agent stopped: ${stopReason.replaceAll('_', ' ')}`
      }
    } catch (cause) {
      error = errorMessage(cause)
    }
    this.cancelPermissions()
    this.meta.updatedAt = Date.now()
    this.setStatus(this.live ? 'ready' : 'stopped', error)
    await this.save().catch((cause) => console.error('Could not save session:', cause))
  }

  private promptBlocks(host: AgentHost, text: string, context: ContextRef[], activeNote?: string): ContentBlock[] {
    const blocks: ContentBlock[] = [{ type: 'text', text }]
    for (const { path: rel, selection, lines } of context) {
      const uri = pathToFileURL(this.workspace.vault.resolve(rel)).href
      if (selection === undefined) {
        blocks.push({ type: 'resource_link', uri, name: rel })
      } else if (host.capabilities.promptCapabilities?.embeddedContext) {
        // The fragment says where the text is, the way code hosts link to lines.
        const at = lines ? `#L${lines.from}-L${lines.to}` : ''
        blocks.push({ type: 'resource', resource: { uri: uri + at, mimeType: 'text/markdown', text: selection } })
      } else {
        const where = lines ? ` (lines ${lines.from}-${lines.to})` : ''
        blocks.push({ type: 'text', text: `Selected text from ${rel}${where}:\n\n${selection}` })
      }
    }
    // Where the user is, not what the note says: the agent reads it if it needs to.
    if (activeNote !== undefined) {
      this.workspace.vault.resolve(activeNote)
      blocks.push({ type: 'text', text: `(The user has ${activeNote} open in the editor.)` })
    }
    return blocks
  }

  private cancelPermissions(): void {
    for (const id of this.waiting.keys()) this.answerPermission(id, null)
  }

  private emit(event: ChatEvent): void {
    if (this.ended) return
    this.chat = applyEvent(this.chat, event)
    this.seq++
    this.workspace.broadcast({ type: 'chat', sessionId: this.meta.id, seq: this.seq, event })
  }

  private setStatus(status: SessionMeta['status'], error?: string): void {
    this.meta.status = status
    this.meta.error = error
    if (status !== 'auth') delete this.meta.authMethods
    this.armIdle()
    this.publish()
  }

  private publish(): void {
    if (this.ended) return
    this.workspace.broadcast({ type: 'session', meta: this.meta })
  }

  private async save(): Promise<void> {
    if (this.ended || this.meta.draft) return
    const { id, agentId, title, updatedAt } = this.meta
    const stored: Stored = {
      meta: { id, agentId, title, updatedAt },
      acpSessionId: this.acpSessionId,
      chosen: this.chosen,
      items: this.chat.items,
    }
    await writeJson(this.file, stored)
  }
}
