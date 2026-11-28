// Types shared by the server and the browser. Paths are always vault-relative
// and use forward slashes.

import type {
  AuthMethod,
  PermissionOption,
  PlanEntry,
  SessionConfigOption,
  SessionUpdate,
  ToolCallContent,
  ToolCallStatus,
  ToolKind,
} from '@agentclientprotocol/sdk'
import type { CodeFont, TextFont } from './fonts'

export interface Entry {
  path: string
  /** A `file` is a note; an `asset` is an image, which only the explorer lists. */
  type: 'file' | 'dir' | 'asset'
}

/** What can be created by name: a note or a folder. */
export type NewEntryType = Exclude<Entry['type'], 'asset'>

export interface AppState {
  vault: { path: string; name: string } | null
  recents: string[]
}

/** One step of the vault picker. Unlike the rest, its paths are absolute and native. */
export interface FolderListing {
  /** Empty for the list of drives on Windows. */
  path: string
  /** The folder above, or null at the top. */
  parent: string | null
  folders: { name: string; path: string }[]
}

export interface Settings {
  /** Agents shown in the chat selector, keyed by registry id. */
  agents: Record<string, { command?: string }>
  editor: {
    fontSize: number
    lineWrap: boolean
    fonts: { heading: TextFont; text: TextFont; code: CodeFont }
  }
  git: {
    /** Keeps Galena's own `.galena/` folder out of the repository. */
    excludeGalena: boolean
    /** Use the repository the vault is a subfolder of. */
    parentRepo: boolean
  }
}

export const defaultSettings: Settings = {
  agents: { 'claude-acp': {}, 'codex-acp': {} },
  editor: { fontSize: 15, lineWrap: true, fonts: { heading: 'geist', text: 'geist', code: 'geist-mono' } },
  git: { excludeGalena: true, parentRepo: false },
}

export interface AgentInfo {
  id: string
  name: string
  version: string
  description: string
  website?: string
  /** How Galena starts it; `manual` agents need a custom command. */
  launch: 'npx' | 'uvx' | 'manual'
}

/** A line of a note: a backlink or a full-text search hit. */
export interface LineMatch {
  path: string
  line: number
  text: string
}

export interface Graph {
  nodes: { path: string; tags: string[] }[]
  links: { source: string; target: string }[]
}

/** A file of the vault that differs from the last commit. */
export interface GitFile {
  path: string
  /** `added` covers untracked files too; `conflict` is a merge left for the user. */
  status: 'modified' | 'added' | 'deleted' | 'renamed' | 'conflict'
  /** Where a renamed file was. */
  from?: string
}

export interface GitStatus {
  /**
   * - `unavailable`: Git is not installed.
   * - `none`: the vault is not in a repository.
   * - `parent`: it is a subfolder of one that the user has not agreed to use.
   * - `merging`: a merge is waiting for its conflicts to be resolved.
   * - `busy`: something started elsewhere (a rebase, say) is under way.
   * - `error`: Git could not read the repository; `message` is what it said.
   */
  state: 'unavailable' | 'none' | 'parent' | 'ready' | 'merging' | 'busy' | 'error'
  message?: string
  /** Top folder of the repository, when the vault is a subfolder of it. */
  root?: string
  /** Null on a detached HEAD. */
  branch: string | null
  /** The remote branch this one follows, e.g. `origin/main`. */
  upstream: string | null
  /** Commits to push and to pull, as of the last fetch. */
  ahead: number
  behind: number
  /** The remote to sync with, if the repository has one. */
  remote: string | null
  /** `.galena/` is committed although the settings keep it out. */
  tracksGalena: boolean
  files: GitFile[]
}

/** A changed file next to its last commit; a side is null where the file does not exist. */
export interface GitDiff {
  before: string | null
  after: string | null
  /** Not text, so there is nothing to show. */
  binary: boolean
  /** A binary that is an image by its name, whose sides can be shown as they are. */
  image: boolean
}

/**
 * The two sides of a conflict: what this branch had and what is coming into
 * it (from the remote, when syncing). Each is the whole file with every
 * conflict settled its way, or null where that side deleted the file.
 */
export interface GitConflict {
  local: string | null
  incoming: string | null
  /** Not text: one side has to be kept whole. */
  binary: boolean
  /** The file on disk has no conflict markers left: it was settled by hand. */
  settled: boolean
}

/**
 * How a conflict is settled: with the given text, with one side as it is, or
 * with the file as it is on disk.
 */
export type GitResolution = { content: string } | { side: 'local' | 'incoming' | 'disk' }

/** What can be asked of the vault's repository, and what each request carries. */
export interface GitActions {
  refresh: void
  init: void
  remote: { url: string }
  untrack: void
  commit: { message: string }
  sync: { message: string }
  fetch: void
  pull: void
  push: void
  discard: { paths: string[] }
  resolve: { path: string } & GitResolution
  abort: void
  finish: void
}

export type GitAction = keyof GitActions

/** Something attached to a prompt: a note, a folder, or a selection of a note. */
export interface ContextRef {
  path: string
  selection?: string
  /** First and last line of the selection, counted from 1. */
  lines?: { from: number; to: number }
}

export type ChatItem =
  | { type: 'user'; text: string; context: ContextRef[]; activeNote?: string }
  | { type: 'agent'; text: string }
  | { type: 'thought'; text: string }
  | {
      type: 'tool'
      id: string
      title: string
      kind: ToolKind
      status: ToolCallStatus
      content: ToolCallContent[]
    }
  | { type: 'plan'; entries: PlanEntry[] }

export interface PermissionRequest {
  id: string
  title: string
  options: PermissionOption[]
}

export interface ChatState {
  items: ChatItem[]
  permissions: PermissionRequest[]
}

/** Everything that can change a `ChatState`; see `applyEvent`. */
export type ChatEvent =
  | { type: 'user'; text: string; context: ContextRef[]; activeNote?: string }
  | { type: 'update'; update: SessionUpdate }
  | { type: 'permission'; request: PermissionRequest }
  | { type: 'permission-done'; requestId: string }
  /** Drops the transcript, as when a draft gets a new ACP session. */
  | { type: 'clear' }

export interface SessionMeta {
  id: string
  agentId: string
  title: string
  updatedAt: number
  /** `stopped` means the chat's ACP session is not open (e.g. a chat from history). */
  status: 'stopped' | 'starting' | 'ready' | 'running' | 'auth'
  error?: string
  /** Offered by the agent when `status` is `auth`. */
  authMethods?: AuthMethod[]
  /** A chat the user has not written in yet. There is at most one per agent, and it is not saved. */
  draft: boolean
  /** The agent's selectors (model, effort…), kept while the chat is idle; gone once its process ends. */
  configOptions?: SessionConfigOption[]
}

export interface SessionDetail extends ChatState {
  meta: SessionMeta
  /** Number of chat events applied so far; orders the snapshot against live events. */
  seq: number
}

/** Messages pushed to the browser over the WebSocket. */
export type ServerEvent =
  | { type: 'fs'; event: 'add' | 'addDir' | 'change' | 'unlink' | 'unlinkDir'; path: string }
  | { type: 'git'; status: GitStatus }
  | { type: 'session'; meta: SessionMeta }
  | { type: 'session-deleted'; id: string }
  | { type: 'chat'; sessionId: string; seq: number; event: ChatEvent }

/** Voice dictation, as the browser sees it: the API key itself never leaves the server. */
export interface TranscriptionState {
  /** Id of the provider in use. */
  provider: string
  /** Its display name. */
  providerName: string
  /** Where to get an API key for it. */
  keyUrl: string
  /** The model the user picked; dictation needs one. */
  model: string | null
  /** A key is stored for the provider. */
  configured: boolean
}

/** A model the provider offers for transcription. */
export interface TranscriptionModel {
  id: string
  name: string
}
