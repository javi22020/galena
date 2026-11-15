import type {
  AgentInfo,
  AppState,
  ContextRef,
  Entry,
  FolderListing,
  GitAction,
  GitActions,
  GitConflict,
  GitDiff,
  GitStatus,
  Graph,
  LineMatch,
  SessionDetail,
  SessionMeta,
  Settings,
} from '../shared/types'

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
  }
}

async function request<T = void>(method: string, path: string, body?: unknown): Promise<T> {
  const response = await fetch(`/api/${path}`, {
    method,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new ApiError(response.status, data.error ?? response.statusText)
  return data as T
}

const query = (params: Record<string, string>) => new URLSearchParams(params).toString()

/** What follows the action when calling it: its body, for the ones that take one. */
export type GitBody<A extends GitAction> = GitActions[A] extends void ? [] : [body: GitActions[A]]

export const api = {
  state: () => request<AppState>('GET', 'state'),
  openVault: (path: string) => request('POST', 'vault', { path }),
  /** Makes the folder `name` inside `parent` and opens it. */
  createVault: (parent: string, name: string) => request('POST', 'vault/new', { parent, name }),
  /** Takes a vault off the list of recent ones. */
  forgetVault: (path: string) => request('DELETE', `recents?${query({ path })}`),
  /** Without a path, the home folder. */
  folders: (path?: string) =>
    request<FolderListing>('GET', path === undefined ? 'folders' : `folders?${query({ path })}`),

  tree: () => request<Entry[]>('GET', 'tree'),
  read: (path: string) =>
    request<{ content: string }>('GET', `file?${query({ path })}`).then((file) => file.content),
  write: (path: string, content: string) => request('PUT', 'file', { path, content }),
  create: (path: string, type: Entry['type']) => request('POST', 'file', { path, type }),
  move: (from: string, to: string) => request('POST', 'move', { from, to }),
  remove: (path: string) => request('DELETE', `file?${query({ path })}`),

  backlinks: (path: string) => request<LineMatch[]>('GET', `backlinks?${query({ path })}`),
  graph: () => request<Graph>('GET', 'graph'),
  searchNames: (q: string) => request<string[]>('GET', `search?${query({ q, kind: 'name' })}`),
  searchText: (q: string) => request<LineMatch[]>('GET', `search?${query({ q, kind: 'text' })}`),

  settings: () => request<Settings>('GET', 'settings'),
  saveSettings: (settings: Settings) => request<Settings>('PUT', 'settings', settings),
  agents: () => request<AgentInfo[]>('GET', 'agents'),

  gitDiff: (path: string) => request<GitDiff>('GET', `git/diff?${query({ path })}`),
  gitConflict: (path: string) => request<GitConflict>('GET', `git/conflict?${query({ path })}`),
  /** Answers with the status the action leaves. */
  gitRun: <A extends GitAction>(action: A, ...[body]: GitBody<A>) =>
    request<GitStatus>('POST', `git/${action}`, body ?? {}),

  sessions: () => request<SessionMeta[]>('GET', 'sessions'),
  /** The agent's empty chat, created if it has none. */
  draft: (agentId: string) => request<SessionMeta>('POST', 'sessions', { agentId }),
  session: (id: string) => request<SessionDetail>('GET', `sessions/${id}`),
  deleteSession: (id: string) => request('DELETE', `sessions/${id}`),
  start: (id: string) => request('POST', `sessions/${id}/start`),
  setConfig: (id: string, configId: string, value: string | boolean) =>
    request('POST', `sessions/${id}/config`, { configId, value }),
  /** `activeNote` is the note on screen, sent as a path only. */
  prompt: (id: string, text: string, context: ContextRef[], activeNote?: string) =>
    request('POST', `sessions/${id}/prompt`, { text, context, activeNote }),
  cancel: (id: string) => request('POST', `sessions/${id}/cancel`),
  answerPermission: (id: string, requestId: string, optionId: string | null) =>
    request('POST', `sessions/${id}/permission`, { requestId, optionId }),
  authenticate: (id: string, methodId: string) =>
    request('POST', `sessions/${id}/authenticate`, { methodId }),
}
