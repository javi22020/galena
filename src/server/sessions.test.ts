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
  const workspace = {
    settings: { defaultPermission },
    broadcast: (event: ServerEvent) => events.push(event),
    vault: { relative: (abs: string) => abs, read: async () => NOTE },
  }
  const stored = { meta: { id: 'chat', agentId: 'agent', title: 'New chat', updatedAt: 0 }, items: [] }
  const session = new Session({ workspace } as unknown as Sessions, stored, 'chat.json')
  return { session, events }
}

const option = (kind: PermissionOption['kind']): PermissionOption => ({ optionId: kind, name: kind, kind })

const ask = (session: Session, ...kinds: PermissionOption['kind'][]) =>
  session.requestPermission({
    sessionId: 'acp',
    toolCall: { toolCallId: 'tool', title: 'Write a.md' },
    options: kinds.map(option),
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

test('with permissions always rejected, an option to allow is never taken', async () => {
  const { session } = chat('reject')
  expect(await ask(session, 'allow_once', 'reject_always', 'reject_once')).toStrictEqual(SELECTED('reject_once'))
  expect(await ask(session, 'allow_always', 'reject_always')).toStrictEqual(SELECTED('reject_always'))
  // Nothing to reject with: the request is cancelled, which the agent takes as a no.
  expect(await ask(session, 'allow_once', 'allow_always')).toStrictEqual(CANCELLED)
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
