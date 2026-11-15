import type { PermissionOption } from '@agentclientprotocol/sdk'
import { expect, test } from 'vitest'
import type { ServerEvent, Settings } from '../shared/types'
import { Session, type Sessions } from './sessions'

const NOTE = lines('one', 'two', 'three', 'four')

function lines(...text: string[]): string {
  return text.join('\n')
}

/** A chat that is not connected to any agent, in a workspace that only records what it is told. */
function chat(defaultPermission: Settings['defaultPermission'] = 'ask') {
  const events: ServerEvent[] = []
  const written: string[] = []
  const workspace = {
    settings: { defaultPermission },
    broadcast: (event: ServerEvent) => events.push(event),
    vault: {
      relative: (abs: string) => {
        if (abs.startsWith('..')) throw new Error(`Outside the vault: ${abs}`)
        return abs
      },
      read: async () => NOTE,
    },
    changes: { write: async (rel: string) => void written.push(rel) },
  }
  const stored = { meta: { id: 'chat', agentId: 'agent', title: 'New chat', updatedAt: 0 }, items: [] }
  const session = new Session({ workspace } as unknown as Sessions, stored, 'chat.json')
  return { session, events, written }
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
