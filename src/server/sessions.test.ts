import {
  agent,
  RequestError,
  type AgentApp,
  type AgentContext,
  type PermissionOption,
  type SessionConfigOption,
  type SessionModeState,
  type SessionUpdate,
} from '@agentclientprotocol/sdk'
import { expect, test, vi } from 'vitest'
import { MODES_ID } from '../shared/config'
import type { ServerEvent, Settings } from '../shared/types'
import { AgentHost } from './agents'
import { Session, type ChatOwner } from './sessions'

const NOTE = lines('one', 'two', 'three', 'four')

function lines(...text: string[]): string {
  return text.join('\n')
}

/**
 * A chat in a workspace that only records what it is told, connected to `host`
 * if given and otherwise to no agent, and stored as `from` says.
 */
function chat(
  defaultPermission: Settings['defaultPermission'] = 'ask',
  host?: AgentHost,
  from: Partial<ConstructorParameters<typeof Session>[1]> = {},
) {
  const remembered: string[] = []
  const events: ServerEvent[] = []
  const written: string[] = []
  const workspace: ChatOwner['workspace'] = {
    settings: { defaultPermission },
    broadcast: (event: ServerEvent) => events.push(event),
    vault: {
      relative: (abs: string) => {
        if (abs.startsWith('..')) throw new Error(`Outside the vault: ${abs}`)
        return abs
      },
      read: async () => NOTE,
      resolve: (rel: string) => rel,
      root: 'vault',
    },
    changes: { write: async (rel: string) => void written.push(rel) },
  }
  const stored = { meta: { id: 'chat', agentId: 'agent', title: 'New chat', updatedAt: 0 }, items: [], ...from }
  const owner: ChatOwner = {
    workspace,
    agent: async () => {
      if (!host) throw new Error('This chat has no agent')
      return host
    },
    remember: (_agentId, configId, value) => void remembered.push(`${configId}=${value}`),
    retryAuth: () => {},
  }
  const session = new Session(owner, stored, 'chat.json')
  return { session, events, written, remembered }
}

const write = (session: Session, path: string) => session.writeFile({ sessionId: 'acp', path, content: 'new' })

/** Answers the only request waiting with `optionId`. */
function answerOnly(session: Session, optionId: string): void {
  const { permissions } = session.detail()
  expect(permissions).toHaveLength(1)
  session.answerPermission(permissions[0]!.id, optionId)
}

const option = (kind: PermissionOption['kind']): PermissionOption => ({ optionId: kind, name: kind, kind })

const ask = (session: Session, ...kinds: PermissionOption['kind'][]) =>
  session.requestPermission({
    sessionId: 'acp',
    toolCall: { toolCallId: 'tool', title: 'Write a.md' },
    options: kinds.map(option),
  })

/** The agent asks to edit `paths`, as agents in a manual mode do before writing them. */
const askEdit = (session: Session, ...paths: string[]) =>
  session.requestPermission({
    sessionId: 'acp',
    toolCall: {
      toolCallId: 'tool',
      title: 'Edit',
      kind: 'edit',
      locations: (paths.length ? paths : ['a.md']).map((path) => ({ path })),
    },
    options: [option('allow_once'), option('allow_always'), option('reject_once')],
  })

const SELECTED = (optionId: string) => ({ outcome: { outcome: 'selected', optionId } })
const CANCELLED = { outcome: { outcome: 'cancelled' } }

test('with permissions always allowed, the agent is answered at once, for this time only', async () => {
  const { session } = chat('allow')
  expect(await ask(session, 'reject_once', 'allow_always', 'allow_once')).toStrictEqual(SELECTED('allow_once'))
  expect(await ask(session, 'reject_always', 'allow_always')).toStrictEqual(SELECTED('allow_always'))
  // Nothing to allow with: the request is cancelled rather than answered with what there is.
  expect(await ask(session, 'reject_once', 'reject_always')).toStrictEqual(CANCELLED)
  expect(session.detail().permissions).toStrictEqual([])
})

test('when asking, the request waits for the user and is answered with their choice', async () => {
  const { session, events } = chat('ask')
  const answer = ask(session, 'allow_once', 'reject_once')
  const [request] = session.detail().permissions
  expect(request).toMatchObject({ title: 'Write a.md', options: [option('allow_once'), option('reject_once')] })
  // The browser is told, or the user would never see it.
  expect(events).toContainEqual(expect.objectContaining({ type: 'chat', event: { type: 'permission', request } }))

  session.answerPermission(request!.id, 'reject_once')
  expect(await answer).toStrictEqual(SELECTED('reject_once'))
  expect(session.detail().permissions).toStrictEqual([])
})

test('each request waiting is answered on its own, and only once', async () => {
  const { session } = chat('ask')
  const first = ask(session, 'allow_once')
  const second = ask(session, 'allow_once')
  const [one, two] = session.detail().permissions

  session.answerPermission(two!.id, null)
  expect(await second).toStrictEqual(CANCELLED)
  expect(session.detail().permissions).toStrictEqual([one])

  session.answerPermission(one!.id, 'allow_once')
  expect(await first).toStrictEqual(SELECTED('allow_once'))
  const gone = expect.objectContaining({ status: 404 })
  expect(() => session.answerPermission(one!.id, 'allow_once')).toThrow(gone)
  expect(() => session.answerPermission('never-asked', 'allow_once')).toThrow(gone)
})

test('closing the chat cancels the requests still waiting, so the agent is not left hanging', async () => {
  const { session } = chat('ask')
  const answers = [ask(session, 'allow_once'), ask(session, 'allow_once'), ask(session, 'allow_once')]
  await session.close()
  expect(await Promise.all(answers)).toStrictEqual([CANCELLED, CANCELLED, CANCELLED])
})

test('when asking, a note the agent writes is only written once the user allows it', async () => {
  const { session, written } = chat('ask')
  const writing = write(session, 'a.md')
  expect(session.detail().permissions[0]).toMatchObject({ title: 'Edit a.md' })
  expect(written).toStrictEqual([])

  answerOnly(session, 'allow_once')
  await writing
  expect(written).toStrictEqual(['a.md'])
  // Allowed once: the next write asks again.
  void write(session, 'a.md')
  expect(session.detail().permissions).toHaveLength(1)
})

test('a write the user rejects or cancels fails, and nothing is written', async () => {
  const { session, written } = chat('ask')
  const rejected = write(session, 'a.md')
  answerOnly(session, 'reject_once')
  await expect(rejected).rejects.toThrow('a.md')

  const cancelled = write(session, 'a.md')
  await session.close()
  await expect(cancelled).rejects.toThrow('a.md')
  expect(written).toStrictEqual([])
})

test('after the user allows all edits, the chat writes without asking', async () => {
  const { session, written } = chat('ask')
  const first = write(session, 'a.md')
  answerOnly(session, 'allow_always')
  await first
  await write(session, 'b.md')
  expect(written).toStrictEqual(['a.md', 'b.md'])
  expect(session.detail().permissions).toStrictEqual([])
})

test('an edit the agent asked about is written without asking again, once, and only for its notes', async () => {
  const { session, written } = chat('ask')
  const asked = askEdit(session)
  answerOnly(session, 'allow_once')
  await asked
  await write(session, 'a.md')
  expect(written).toStrictEqual(['a.md'])

  void write(session, 'a.md')
  void write(session, 'b.md')
  expect(session.detail().permissions).toHaveLength(2)
})

test('an edit the agent was refused is still asked about when it writes', async () => {
  const { session } = chat('ask')
  const asked = askEdit(session)
  answerOnly(session, 'reject_once')
  await asked
  void write(session, 'a.md')
  expect(session.detail().permissions).toHaveLength(1)
})

test('an edit the agent asked about outside the vault still gets the user\'s answer', async () => {
  const { session, written } = chat('ask')
  const asked = askEdit(session, '../outside.md', 'a.md')
  answerOnly(session, 'allow_once')
  expect(await asked).toStrictEqual(SELECTED('allow_once'))
  await write(session, 'a.md')
  expect(written).toStrictEqual(['a.md'])
})

test('after the agent is allowed always to edit, the chat writes without asking', async () => {
  const { session, written } = chat('ask')
  const asked = askEdit(session)
  answerOnly(session, 'allow_always')
  await asked
  await write(session, 'a.md')
  await write(session, 'b.md')
  expect(written).toStrictEqual(['a.md', 'b.md'])
  expect(session.detail().permissions).toStrictEqual([])
})

test('with permissions always allowed, writes are not asked about', async () => {
  const { session, written } = chat('allow')
  await write(session, 'a.md')
  expect(written).toStrictEqual(['a.md'])
  expect(session.detail().permissions).toStrictEqual([])
})

test('the agent reads a whole note, or the lines it asks for, counted from 1', async () => {
  const { session } = chat()
  const read = async (range: { line?: number | null; limit?: number | null }) =>
    (await session.readFile({ sessionId: 'acp', path: 'a.md', ...range })).content
  // What is left out may come as null, which is how some agents send it.
  expect(await read({ line: null, limit: null })).toBe(NOTE)
  expect(await read({ line: 2, limit: 2 })).toBe(lines('two', 'three'))
  expect(await read({ line: 3 })).toBe(lines('three', 'four'))
  expect(await read({ line: 3, limit: null })).toBe(lines('three', 'four'))
  expect(await read({ limit: 1 })).toBe('one')
  expect(await read({ line: 4, limit: 10 })).toBe('four')
  expect(await read({ line: 9 })).toBe('')
})

/** Galena's own agent host, connected to `fake`, an agent in this process, instead of a process. */
const hostOf = (fake: AgentApp) =>
  AgentHost.open({ connect: (app) => app.connect(fake), exited: new Promise(() => {}), stop() {} }, () => {})

const MODES: SessionModeState = {
  currentModeId: 'ask',
  availableModes: [
    { id: 'ask', name: 'Ask' },
    { id: 'code', name: 'Code' },
  ],
}

/** An agent's own option for the mode, as Claude's adapter offers it next to its session modes. */
const modeOption = (currentValue: string): SessionConfigOption => ({
  type: 'select',
  id: 'mode',
  name: 'Mode',
  category: 'mode',
  currentValue,
  options: MODES.availableModes.map((m) => ({ value: m.id, name: m.name })),
})

interface FakeAgent {
  /** The agent's own options, once `configId` is set to `value`; without them it only offers session modes. */
  options?: (value: string, configId?: string) => SessionConfigOption[]
  /** The agent refuses every mode it is asked to set. */
  refuse?: boolean
  /** The chat was used before, in a session the agent resumes, and in the mode it chose then. */
  resumedIn?: string
}

/**
 * A chat open in an agent that offers `MODES`, with the requests it sent the
 * agent, the options it remembered for the agent's next chats, and a way for
 * the agent to tell it about the session.
 */
async function inAgent({ options, refuse = false, resumedIn }: FakeAgent = {}) {
  const sent: [string, unknown][] = []
  let client: AgentContext | undefined
  const opened = { modes: MODES, configOptions: options?.('ask') }
  const fake = agent()
    .onConnect((connection) => void (client = connection.client))
    .onRequest('initialize', ({ params }) => ({
      protocolVersion: params.protocolVersion,
      agentCapabilities: { sessionCapabilities: { resume: {} } },
    }))
    .onRequest('session/new', () => ({ sessionId: 'acp', ...opened }))
    .onRequest('session/resume', () => opened)
    .onRequest('session/set_mode', ({ params }) => {
      sent.push(['session/set_mode', params])
      if (refuse) throw RequestError.invalidParams(undefined, 'No such mode')
      return {}
    })
    .onRequest('session/set_config_option', ({ params }) => {
      sent.push(['session/set_config_option', params])
      return { configOptions: options?.(String(params.value), params.configId) ?? [] }
    })
  const stored = resumedIn
    ? { acpSessionId: 'acp', items: [{ type: 'agent' as const, text: 'Hi' }], chosen: { [MODES_ID]: resumedIn } }
    : {}
  const { session, events, remembered } = chat('ask', await hostOf(fake), stored)
  await session.start()
  const update = (update: SessionUpdate) => client!.notify('session/update', { sessionId: 'acp', update })
  return { session, events, sent, remembered, update }
}

const mode = (session: Session) => session.meta.configOptions?.find((o) => o.category === 'mode')?.currentValue

test('the mode shown follows the mode the agent says it changed to', async () => {
  const { session, events, update } = await inAgent()
  expect(mode(session)).toBe('ask')
  await update({ sessionUpdate: 'current_mode_update', currentModeId: 'code' })
  await vi.waitFor(() => expect(mode(session)).toBe('code'))
  // Shown as an option, not in the transcript.
  expect(events.filter((event) => event.type === 'chat')).toStrictEqual([])
})

test('picking the mode of an agent that only has modes sets it as a mode, for its next chats too', async () => {
  const { session, sent, remembered } = await inAgent()
  await session.setConfig(MODES_ID, 'code')
  expect(sent).toStrictEqual([['session/set_mode', { sessionId: 'acp', modeId: 'code' }]])
  expect(mode(session)).toBe('code')
  expect(remembered).toStrictEqual([`${MODES_ID}=code`])
})

test('a mode the agent refuses fails to be picked and is not shown or kept', async () => {
  const { session, remembered } = await inAgent({ refuse: true })
  await expect(session.setConfig(MODES_ID, 'code')).rejects.toThrow('No such mode')
  expect(mode(session)).toBe('ask')
  expect(remembered).toStrictEqual([])
})

test('a mode the agent moves to on its own is shown, but its next chats start in the one that was picked', async () => {
  const { session, remembered, update } = await inAgent()
  await session.setConfig(MODES_ID, 'code')
  await update({ sessionUpdate: 'current_mode_update', currentModeId: 'ask' })
  await vi.waitFor(() => expect(mode(session)).toBe('ask'))
  expect(remembered).toStrictEqual([`${MODES_ID}=code`])
})

test('an agent with its own option for the mode has it set as an option, not as a mode', async () => {
  const { session, sent } = await inAgent({ options: (value) => [modeOption(value)] })
  await session.setConfig('mode', 'code')
  expect(sent).toStrictEqual([['session/set_config_option', { sessionId: 'acp', configId: 'mode', value: 'code' }]])
  expect(session.meta.configOptions).toStrictEqual([modeOption('code')])
})

test('a resumed chat shows the agent modes again and is put back in the mode it was in', async () => {
  const { session, sent } = await inAgent({ resumedIn: 'code' })
  expect(sent).toStrictEqual([['session/set_mode', { sessionId: 'acp', modeId: 'code' }]])
  expect(mode(session)).toBe('code')
})

test('a mode the agent moves to on its own after the chat is put back is not undone when it reopens', async () => {
  const { session, sent, update } = await inAgent({ resumedIn: 'code' })
  await update({ sessionUpdate: 'current_mode_update', currentModeId: 'ask' })
  await vi.waitFor(() => expect(mode(session)).toBe('ask'))
  session.detach()
  await session.start()
  // Only the set_mode of the first opening: the agent resumes in 'ask', the mode it moved to.
  expect(sent).toStrictEqual([['session/set_mode', { sessionId: 'acp', modeId: 'code' }]])
})

/** The options of an agent with a model and an effort of its own, which change only as it is asked. */
function modelAndEffort(): NonNullable<FakeAgent['options']> {
  const current: Record<string, string> = { model: 'sonnet', effort: 'low' }
  const pick = (id: string, category: string, ...values: string[]): SessionConfigOption => ({
    type: 'select',
    id,
    name: id,
    category,
    currentValue: current[id]!,
    options: values.map((value) => ({ value, name: value })),
  })
  return (value, configId) => {
    if (configId) current[configId] = value
    return [pick('model', 'model', 'sonnet', 'opus'), pick('effort', 'thought_level', 'low', 'high')]
  }
}

const setOption = (configId: string, value: string) => ['session/set_config_option', { sessionId: 'acp', configId, value }]

test('a chat that is open takes on every option remembered for the agent', async () => {
  const { session, sent } = await inAgent({ options: modelAndEffort() })
  session.adopt({ model: 'opus', effort: 'high' })
  await session.start() // runs once the options are taken on
  // The answer to the first still has the old value of the second: that is not the agent changing it.
  expect(sent).toStrictEqual([setOption('model', 'opus'), setOption('effort', 'high')])
})

test('options remembered while another is being picked are still taken on', async () => {
  const { session, sent } = await inAgent({ options: modelAndEffort() })
  const picked = session.setConfig('model', 'opus')
  session.adopt({ effort: 'high' })
  await picked
  await session.start()
  expect(sent).toStrictEqual([setOption('model', 'opus'), setOption('effort', 'high')])
})
