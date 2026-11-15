import type { SessionUpdate } from '@agentclientprotocol/sdk'
import { expect, test } from 'vitest'
import { applyEvent, blockText } from './transcript'
import type { ChatEvent, ChatState, PermissionRequest } from './types'

const EMPTY: ChatState = { items: [], permissions: [] }

const update = (update: SessionUpdate): ChatEvent => ({ type: 'update', update })
const user = (text: string): ChatEvent => ({ type: 'user', text, context: [] })
const says = (text: string) => update({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text } })
const thinks = (text: string) => update({ sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text } })
const plans = (...steps: string[]) =>
  update({
    sessionUpdate: 'plan',
    entries: steps.map((content) => ({ content, priority: 'medium', status: 'pending' })),
  })

const fold = (...events: ChatEvent[]) => events.reduce(applyEvent, EMPTY)

test('chunks of one message are joined, and a change of speaker starts another', () => {
  const { items } = fold(thinks('Let me '), thinks('see.'), says('It is '), says('done.'), thinks('Next'))
  expect(items).toStrictEqual([
    { type: 'thought', text: 'Let me see.' },
    { type: 'agent', text: 'It is done.' },
    { type: 'thought', text: 'Next' },
  ])
})

test('a tool call update changes only the fields it carries', () => {
  const started = fold(
    update({ sessionUpdate: 'tool_call', toolCallId: 't1', title: 'Edit a.md', kind: 'edit', status: 'pending' }),
    says('Working on it.'),
    update({ sessionUpdate: 'tool_call_update', toolCallId: 't1', status: 'in_progress' }),
  )
  expect(started.items).toStrictEqual([
    { type: 'tool', id: 't1', title: 'Edit a.md', kind: 'edit', status: 'in_progress', content: [] },
    { type: 'agent', text: 'Working on it.' },
  ])
  const renamed = applyEvent(started, update({ sessionUpdate: 'tool_call_update', toolCallId: 't1', title: 'Edited' }))
  expect(renamed.items[0]).toStrictEqual({
    type: 'tool',
    id: 't1',
    title: 'Edited',
    kind: 'edit',
    status: 'in_progress',
    content: [],
  })
})

test('tool calls are told apart by their id', () => {
  const { items } = fold(
    update({ sessionUpdate: 'tool_call', toolCallId: 't1', title: 'First' }),
    update({ sessionUpdate: 'tool_call', toolCallId: 't2', title: 'Second' }),
    update({ sessionUpdate: 'tool_call_update', toolCallId: 't1', status: 'failed' }),
  )
  expect(items).toMatchObject([
    { id: 't1', title: 'First', status: 'failed' },
    { id: 't2', title: 'Second', status: 'pending' },
  ])
})

test('an update for a tool call never seen shows it, with defaults for what is missing', () => {
  // A permission request describes its tool call this way, before any `tool_call`.
  const { items } = fold(update({ sessionUpdate: 'tool_call_update', toolCallId: 't9', title: 'Delete a.md' }))
  expect(items).toStrictEqual([
    { type: 'tool', id: 't9', title: 'Delete a.md', kind: 'other', status: 'pending', content: [] },
  ])
})

test('a new plan replaces the one of the same turn, where it was', () => {
  const { items } = fold(user('go'), plans('a'), says('Starting.'), plans('a', 'b'))
  expect(items.map((item) => item.type)).toStrictEqual(['user', 'plan', 'agent'])
  expect(items[1]).toMatchObject({ entries: [{ content: 'a' }, { content: 'b' }] })
})

test('the plan of an earlier turn is kept when the next turn makes its own', () => {
  const { items } = fold(user('one'), plans('first'), user('two'), plans('second'))
  expect(items.map((item) => item.type)).toStrictEqual(['user', 'plan', 'user', 'plan'])
  expect(items[1]).toMatchObject({ entries: [{ content: 'first' }] })
  expect(items[3]).toMatchObject({ entries: [{ content: 'second' }] })
})

test('an answered permission request goes away, and the others stay', () => {
  const request = (id: string): PermissionRequest => ({ id, title: 'Write a.md', options: [] })
  const state = fold(
    { type: 'permission', request: request('p1') },
    { type: 'permission', request: request('p2') },
    { type: 'permission-done', requestId: 'p1' },
  )
  expect(state.permissions).toStrictEqual([request('p2')])
})

test('applying an event leaves the state it was given untouched', () => {
  // React compares states by identity: one changed in place would not render again.
  const before = fold(says('It is '))
  const copy = structuredClone(before)
  const after = applyEvent(before, says('done.'))
  expect(after.items).not.toBe(before.items)
  expect(before).toStrictEqual(copy)
})

test('blockText shows a link for a resource and a placeholder for what has no text', () => {
  expect(blockText({ type: 'text', text: 'plain' })).toBe('plain')
  expect(blockText({ type: 'resource_link', name: 'a.md', uri: 'file:///vault/a.md' })).toBe(
    '[a.md](file:///vault/a.md)',
  )
  expect(blockText({ type: 'image', data: '', mimeType: 'image/png' })).toBe('[image]')
})
