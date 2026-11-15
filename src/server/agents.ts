import { spawn } from 'node:child_process'
import { Readable, Writable } from 'node:stream'
import {
  client,
  ndJsonStream,
  PROTOCOL_VERSION,
  RequestError,
  type AgentCapabilities,
  type AgentRequestMethod,
  type AgentRequestParamsByMethod,
  type AgentRequestResponsesByMethod,
  type AuthMethod,
  type ClientApp,
  type ClientConnection,
  type ClientContext,
  type LoadSessionRequest,
  type LoadSessionResponse,
  type NewSessionRequest,
  type NewSessionResponse,
  type RequestPermissionResponse,
  type ResumeSessionResponse,
  type SessionNotification,
} from '@agentclientprotocol/sdk'
import { version } from '../../package.json'
import type { Launch } from './registry'
import type { Session } from './sessions'
import { errorMessage, hasCode } from './util'

/** Told why the process ended, with the tail of its stderr. */
type OnExit = (host: AgentHost, reason: string) => void

/**
 * How long the agent has to answer the requests that should not take long, so
 * that one it never answers cannot hold up a chat for good. `session/load`
 * replays the whole conversation. A prompt, a sign-in or the handshake (npx may
 * be downloading the agent) can take any time.
 */
const TIMEOUTS = {
  'session/new': 60_000,
  'session/resume': 60_000,
  'session/load': 120_000,
  'session/set_config_option': 30_000,
  'session/set_mode': 30_000,
  'session/close': 10_000,
} satisfies Partial<Record<AgentRequestMethod, number>>

type TimedMethod = keyof typeof TIMEOUTS

/**
 * How Galena reaches an agent: the process it started, or, in tests, an agent
 * in this same process.
 */
export interface Transport {
  /** Connects Galena's side of ACP to the agent. */
  connect(app: ClientApp): ClientConnection
  /** Rejects once the agent is gone, saying why. */
  exited: Promise<never>
  /** Ends the agent. */
  stop(): void
}

/** Starts an agent process that speaks ACP over its stdin and stdout. */
function spawnAgent(launch: Launch, cwd: string): Transport {
  const proc = spawn(launch.command, launch.args, {
    cwd,
    env: { ...process.env, ...launch.env },
    stdio: ['pipe', 'pipe', 'pipe'],
    shell: process.platform === 'win32', // npx is a .cmd shim on Windows
  })

  let stderr = ''
  proc.stderr.on('data', (chunk) => (stderr = (stderr + chunk).slice(-2000)))
  const exited = new Promise<never>((_, reject) => {
    proc.once('error', (error) => reject(new Error(`Could not run ${launch.command}: ${error.message}`)))
    proc.once('exit', (code) => reject(new Error(`The agent exited (code ${code}). ${stderr.trim()}`)))
  })

  return {
    connect: (app) =>
      app.connect(
        ndJsonStream(
          Writable.toWeb(proc.stdin) as WritableStream<Uint8Array>,
          Readable.toWeb(proc.stdout) as ReadableStream<Uint8Array>,
        ),
      ),
    exited,
    stop() {
      proc.stdin.end()
      proc.kill()
    },
  }
}

/**
 * A running agent and its ACP connection, shared by every chat with that agent.
 * Each chat is one ACP session in it; what the agent sends about a session is
 * routed to that chat by session id.
 */
export class AgentHost {
  capabilities: AgentCapabilities = {}
  authMethods: AuthMethod[] = []
  /** Set by `kill`: the process is ending on purpose. */
  killed = false
  readonly peer: ClientContext
  /** Chats whose ACP session is open in this process, by ACP session id. */
  private sessions = new Map<string, Session>()
  /**
   * Updates for session ids that are not registered yet. An agent may send the
   * first ones right after answering `session/new`, before the response
   * reaches the chat, so they wait here while a `session/new` is in flight.
   */
  private pending: SessionNotification[] = []
  private creating = 0

  private constructor(
    private transport: Transport,
    onExit: OnExit,
  ) {
    transport.exited.catch((error: Error) => onExit(this, error.message))
    const app = client({ name: 'galena' })
      .onNotification('session/update', ({ params }) => this.onUpdate(params))
      .onRequest('session/request_permission', ({ params }) => {
        const session = this.sessions.get(params.sessionId)
        const cancelled: RequestPermissionResponse = { outcome: { outcome: 'cancelled' } }
        return session ? session.requestPermission(params) : Promise.resolve(cancelled)
      })
      .onRequest('fs/read_text_file', ({ params }) =>
        this.session(params.sessionId).readFile(params).catch(toRequestError),
      )
      .onRequest('fs/write_text_file', ({ params }) =>
        this.session(params.sessionId).writeFile(params).catch(toRequestError),
      )
    this.peer = transport.connect(app).agent
  }

  /** Starts an agent and runs the ACP handshake. `onExit` runs once, when the process ends. */
  static async start(launch: Launch, cwd: string, onExit: OnExit): Promise<AgentHost> {
    return AgentHost.open(spawnAgent(launch, cwd), onExit)
  }

  /** Runs the ACP handshake with an agent. `onExit` runs once, when the agent is gone. */
  static async open(transport: Transport, onExit: OnExit): Promise<AgentHost> {
    const host = new AgentHost(transport, onExit)
    try {
      const init = await host.alive(
        host.peer.request('initialize', {
          protocolVersion: PROTOCOL_VERSION,
          clientInfo: { name: 'galena', title: 'Galena', version },
          clientCapabilities: {
            fs: { readTextFile: true, writeTextFile: true },
            session: { configOptions: { boolean: {} } },
          },
        }),
      )
      host.capabilities = init.agentCapabilities ?? {}
      host.authMethods = init.authMethods ?? []
      return host
    } catch (error) {
      host.kill()
      throw error
    }
  }

  /** How a closed session is opened again, if the agent can do that at all. */
  get reopenMethod(): 'session/resume' | 'session/load' | undefined {
    if (this.capabilities.sessionCapabilities?.resume) return 'session/resume'
    if (this.capabilities.loadSession) return 'session/load'
  }

  /** Whether idle sessions can be closed to free memory and opened again later. */
  get canSuspend(): boolean {
    return !!this.capabilities.sessionCapabilities?.close && !!this.reopenMethod
  }

  /** Settles like `pending`, but rejects if the process dies first. */
  alive<T>(pending: Promise<T>): Promise<T> {
    return Promise.race([pending, this.transport.exited])
  }

  /**
   * Sends a request that fails if the agent does not answer it in time (see
   * `TIMEOUTS`) or dies first. On a timeout the agent is told to cancel it,
   * and a late answer is dropped.
   */
  request<Method extends TimedMethod>(
    method: Method,
    params: AgentRequestParamsByMethod[Method],
  ): Promise<AgentRequestResponsesByMethod[Method]> {
    const signal = AbortSignal.timeout(TIMEOUTS[method])
    const pending = this.peer.request(method, params, { cancellationSignal: signal, stopWaitingOnCancel: true })
    return this.alive(pending).catch((error: unknown) => {
      throw signal.aborted ? new Error(`The agent did not answer ${method} in time`) : error
    })
  }

  /**
   * Creates an ACP session for `session`. `opened` runs with the response,
   * before any update the agent sent after it.
   */
  async createSession(
    request: NewSessionRequest,
    session: Session,
    opened: (response: NewSessionResponse) => void,
  ): Promise<void> {
    this.creating++
    try {
      const response = await this.request('session/new', request)
      const id = response.sessionId
      this.sessions.set(id, session)
      opened(response)
      const early = this.pending.filter((notification) => notification.sessionId === id)
      this.pending = this.pending.filter((notification) => notification.sessionId !== id)
      for (const notification of early) session.onUpdate(notification.update)
    } finally {
      if (--this.creating === 0) this.pending = []
    }
  }

  /**
   * Reopens a closed ACP session for `session`, with `reopenMethod`. What the
   * agent sends while reopening (a `session/load` replays the history) already
   * reaches the chat.
   */
  async reopenSession(
    request: LoadSessionRequest,
    session: Session,
  ): Promise<ResumeSessionResponse | LoadSessionResponse> {
    const method = this.reopenMethod
    if (!method) throw new Error('This agent cannot resume past sessions')
    this.sessions.set(request.sessionId, session)
    try {
      return await this.request(method, request)
    } catch (error) {
      this.sessions.delete(request.sessionId)
      throw error
    }
  }

  /** Whether the ACP session `id` is open in this process for `session`. */
  serves(id: string, session: Session): boolean {
    return this.sessions.get(id) === session
  }

  /** Stops routing a session to its chat and, if the agent supports it, ends it there. */
  async closeSession(id: string): Promise<void> {
    this.sessions.delete(id)
    if (!this.capabilities.sessionCapabilities?.close) return
    try {
      await this.request('session/close', { sessionId: id })
    } catch (error) {
      // Nothing is left to free if the agent is gone or forgot the session.
      console.error('Could not close an agent session:', errorMessage(error))
    }
  }

  kill(): void {
    this.killed = true
    this.transport.stop()
  }

  private onUpdate(notification: SessionNotification): void {
    const session = this.sessions.get(notification.sessionId)
    if (session) session.onUpdate(notification.update)
    else if (this.creating > 0) this.pending.push(notification)
  }

  private session(id: string): Session {
    const session = this.sessions.get(id)
    if (!session) throw RequestError.sessionNotFound(id)
    return session
  }
}

/** Turns a failed file request into an error the agent can understand. */
function toRequestError(error: unknown): never {
  if (hasCode(error, 'ENOENT')) throw RequestError.resourceNotFound()
  throw RequestError.invalidParams(undefined, errorMessage(error))
}
