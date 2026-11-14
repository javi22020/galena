import type { ContentBlock } from '@agentclientprotocol/sdk'
import type { ChatEvent, ChatItem, ChatState } from './types'

/**
 * Folds a chat event into the state. The server and the browser both run this
 * reducer, so a stored transcript and a live one are always built the same way.
 */
export function applyEvent(state: ChatState, event: ChatEvent): ChatState {
  switch (event.type) {
    case 'user':
      return { ...state, items: [...state.items, event] }
    case 'update':
      return { ...state, items: applyUpdate(state.items, event.update) }
    case 'permission':
      return { ...state, permissions: [...state.permissions, event.request] }
    case 'permission-done':
      return { ...state, permissions: state.permissions.filter((p) => p.id !== event.requestId) }
    case 'clear':
      return { ...state, items: [] }
  }
}

type Update = Extract<ChatEvent, { type: 'update' }>['update']

function applyUpdate(items: ChatItem[], update: Update): ChatItem[] {
  switch (update.sessionUpdate) {
    case 'agent_message_chunk':
      return appendText(items, 'agent', update.content)
    case 'agent_thought_chunk':
      return appendText(items, 'thought', update.content)
    case 'tool_call':
    case 'tool_call_update': {
      // Updates only carry the fields that changed.
      const index = items.findLastIndex((i) => i.type === 'tool' && i.id === update.toolCallId)
      const prev = items[index]?.type === 'tool' ? items[index] : undefined
      const next: ChatItem = {
        type: 'tool',
        id: update.toolCallId,
        title: update.title ?? prev?.title ?? '',
        kind: update.kind ?? prev?.kind ?? 'other',
        status: update.status ?? prev?.status ?? 'pending',
        content: update.content ?? prev?.content ?? [],
      }
      return prev ? items.with(index, next) : [...items, next]
    }
    case 'plan': {
      // A new plan replaces the one already shown for the current turn.
      const index = items.findLastIndex((i) => i.type === 'plan' || i.type === 'user')
      const next: ChatItem = { type: 'plan', entries: update.entries }
      return items[index]?.type === 'plan' ? items.with(index, next) : [...items, next]
    }
    default:
      return items
  }
}

function appendText(items: ChatItem[], type: 'agent' | 'thought', block: ContentBlock): ChatItem[] {
  const text = blockText(block)
  const last = items.at(-1)
  return last?.type === type
    ? items.with(-1, { type, text: last.text + text })
    : [...items, { type, text }]
}

export function blockText(block: ContentBlock): string {
  switch (block.type) {
    case 'text':
      return block.text
    case 'resource_link':
      return `[${block.name}](${block.uri})`
    default:
      return `[${block.type}]`
  }
}
