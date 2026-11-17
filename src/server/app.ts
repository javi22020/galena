import path from 'node:path'
import { upgradeWebSocket, type HttpBindings } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import type { WSContext } from 'hono/ws'
import type {
  AppState,
  ContextRef,
  NewEntryType,
  GitAction,
  GitResolution,
  GitStatus,
  ServerEvent,
} from '../shared/types'
import { createFolder, listFolders } from './folders'
import { imageHeaders, MAX_IMAGE_SIZE, saveImage } from './images'
import { listAgents } from './registry'
import { configDir, errorMessage, expandHome, hasCode, HttpError, readJson, writeJson } from './util'
import { Workspace } from './workspace'

export interface GalenaOptions {
  /** Vault to open at startup; without it the app shows the home screen. */
  vault?: string
  /** Folder with the built SPA. Omitted in development, where Vite serves it. */
  clientDir?: string
}

export interface Galena {
  app: Hono<{ Bindings: HttpBindings }>
  close(): Promise<void>
}

const RECENTS_FILE = path.join(configDir, 'recents.json')
const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]'])

export async function createGalena(options: GalenaOptions): Promise<Galena> {
  const sockets = new Set<WSContext>()
  const broadcast = (event: ServerEvent) => {
    const data = JSON.stringify(event)
    for (const socket of sockets) socket.send(data)
  }

  let workspace: Workspace | null = null
  const current = (): Workspace => {
    if (!workspace) throw new HttpError(409, 'No vault is open')
    return workspace
  }
  const openVault = async (dir: string) => {
    const next = await Workspace.open(dir, broadcast)
    await workspace?.close()
    workspace = next
    const recents = await readJson<string[]>(RECENTS_FILE, [])
    const { root } = next.vault
    await writeJson(RECENTS_FILE, [root, ...recents.filter((r) => r !== root)].slice(0, 10))
  }
  if (options.vault) await openVault(options.vault)

  const app = new Hono<{ Bindings: HttpBindings }>()

  app.onError((error, c) => {
    if (error instanceof HttpError) return c.json({ error: error.message }, error.status)
    if (hasCode(error, 'ENOENT')) return c.json({ error: 'Not found' }, 404)
    console.error(error)
    return c.json({ error: errorMessage(error) }, 500)
  })

  // The server is only meant for this machine's browser, and it has no login.
  // Requiring a loopback Host defeats DNS rebinding. Browsers send Origin on
  // every request that can change something, and on WebSocket handshakes, so
  // demanding a same-origin one stops other sites from using the API. Only
  // plain reads may come without it, as other sites cannot see their
  // responses; a WebSocket handshake is a GET too, but its socket could be read.
  app.use(async function guard(c, next) {
    const host = c.req.header('host') ?? ''
    if (!LOOPBACK.has(host.replace(/:\d+$/, ''))) throw new HttpError(403, 'Forbidden host')
    const origin = c.req.header('origin')
    const read = (c.req.method === 'GET' || c.req.method === 'HEAD') && !c.req.header('upgrade')
    if (origin ? origin !== `http://${host}` : !read) throw new HttpError(403, 'Forbidden origin')
    await next()
    // Nor may other sites embed what a read answers with, or tell from it what is in the vault.
    c.res.headers.set('cross-origin-resource-policy', 'same-origin')
  })

  app.get(
    '/api/ws',
    upgradeWebSocket(() => ({
      onOpen: (_event, socket) => void sockets.add(socket),
      onClose: (_event, socket) => void sockets.delete(socket),
    })),
  )

  // Vault

  app.get('/api/state', async (c) => {
    const vault = workspace && { path: workspace.vault.root, name: workspace.vault.name }
    const state: AppState = { vault, recents: await readJson<string[]>(RECENTS_FILE, []) }
    return c.json(state)
  })

  app.post('/api/vault', async (c) => {
    const body = await c.req.json()
    await openVault(expandHome(text(body.path, 'path')))
    return c.json({})
  })

  // A new vault is a new, empty folder, opened right away.
  app.post('/api/vault/new', async (c) => {
    const body = await c.req.json()
    await openVault(await createFolder(text(body.parent, 'parent'), text(body.name, 'name')))
    return c.json({})
  })

  // Only the entry in the list goes: the folder and its notes stay where they are.
  app.delete('/api/recents', async (c) => {
    const gone = text(c.req.query('path'), 'path')
    const recents = await readJson<string[]>(RECENTS_FILE, [])
    await writeJson(
      RECENTS_FILE,
      recents.filter((r) => r !== gone),
    )
    return c.json({})
  })

  // Any folder on this machine can become a vault, so the picker may list them all.
  app.get('/api/folders', async (c) => c.json(await listFolders(c.req.query('path'))))

  // Files

  app.get('/api/tree', async (c) => c.json(await current().vault.list()))

  app.get('/api/file', async (c) => {
    return c.json({ content: await current().vault.read(text(c.req.query('path'), 'path')) })
  })

  app.put('/api/file', async (c) => {
    const body = await c.req.json()
    await current().vault.write(text(body.path, 'path'), text(body.content, 'content', true))
    return c.json({})
  })

  app.post('/api/file', async (c) => {
    const body = await c.req.json()
    const type: NewEntryType = body.type === 'dir' ? 'dir' : 'file'
    await current().vault.create(text(body.path, 'path'), type)
    return c.json({})
  })

  app.post('/api/move', async (c) => {
    const body = await c.req.json()
    await current().vault.move(text(body.from, 'from'), text(body.to, 'to'))
    return c.json({})
  })

  app.delete('/api/file', async (c) => {
    await current().vault.remove(text(c.req.query('path'), 'path'))
    return c.json({})
  })

  // Images

  app.get('/api/image', async (c) => {
    const rel = text(c.req.query('path'), 'path')
    const headers = imageHeaders(rel)
    return new Response(await current().vault.readBytes(rel), { headers })
  })

  // The image is the body, as it is; the server picks where it goes and answers with its path.
  app.post(
    '/api/image',
    bodyLimit({
      maxSize: MAX_IMAGE_SIZE,
      onError: () => {
        throw new HttpError(413, `Images can be ${MAX_IMAGE_SIZE / 1024 / 1024} MB at most`)
      },
    }),
    async (c) => {
      const bytes = new Uint8Array(await c.req.arrayBuffer())
      return c.json({ path: await saveImage(current().vault, c.req.query('name') ?? '', bytes) })
    },
  )

  // Index

  app.get('/api/backlinks', (c) => {
    return c.json(current().index.backlinks(text(c.req.query('path'), 'path')))
  })

  app.get('/api/graph', (c) => c.json(current().index.graph()))

  app.get('/api/search', (c) => {
    const { index } = current()
    const query = c.req.query('q') ?? ''
    return c.json(c.req.query('kind') === 'text' ? index.searchText(query) : index.searchNames(query))
  })

  // Settings and agents

  app.get('/api/settings', (c) => c.json(current().settings))
  app.put('/api/settings', async (c) => c.json(await current().saveSettings(await c.req.json())))
  app.get('/api/agents', async (c) => c.json(await listAgents()))

  // Git

  app.get('/api/git/diff', async (c) => {
    return c.json(await current().git.diff(text(c.req.query('path'), 'path')))
  })

  app.get('/api/git/image', async (c) => {
    const side = c.req.query('side') === 'before' ? 'before' : 'after'
    const rel = text(c.req.query('path'), 'path')
    const headers = imageHeaders(rel)
    return new Response(await current().git.raw(rel, side), { headers })
  })

  app.get('/api/git/conflict', async (c) => {
    return c.json(await current().git.conflict(text(c.req.query('path'), 'path')))
  })

  // Every action answers with the status it leaves.
  app.post('/api/git/:action', async (c) => {
    const { git } = current()
    const body = (await c.req.json().catch(() => null)) ?? {}
    const message = typeof body.message === 'string' ? body.message : ''
    const actions: Record<GitAction, () => Promise<GitStatus>> = {
      // Not a GET: looking again can write `.git/info/exclude`, and it tells
      // every open tab what it finds.
      refresh: () => git.refresh(),
      init: () => git.init(),
      remote: () => git.addRemote(text(body.url, 'url').trim()),
      untrack: () => git.untrackGalena(),
      commit: () => git.commit(message),
      sync: () => git.sync(message),
      fetch: () => git.fetch(),
      pull: () => git.pull(),
      push: () => git.push(),
      discard: () => git.discard(Array.isArray(body.paths) ? body.paths.map(String) : []),
      resolve: () => git.resolveConflict(text(body.path, 'path'), resolution(body)),
      abort: () => git.abortMerge(),
      finish: () => git.finishMerge(),
    }
    const name = c.req.param('action')
    // Not `actions[name]` alone: that also finds what every object inherits.
    if (!Object.hasOwn(actions, name)) throw new HttpError(404, 'Not found')
    return c.json(await actions[name as GitAction]())
  })

  // Agent sessions

  app.get('/api/sessions', (c) => c.json(current().sessions.list()))

  // A new chat is the agent's draft: an existing one is reused, never duplicated.
  app.post('/api/sessions', async (c) => {
    const body = await c.req.json()
    return c.json(current().sessions.draft(text(body.agentId, 'agentId')).meta)
  })

  app.get('/api/sessions/:id', (c) => c.json(current().sessions.get(c.req.param('id')).detail()))

  app.delete('/api/sessions/:id', async (c) => {
    await current().sessions.delete(c.req.param('id'))
    return c.json({})
  })

  app.post('/api/sessions/:id/start', async (c) => {
    try {
      await current().sessions.get(c.req.param('id')).start()
    } catch (error) {
      // A sign-in request is shown in the chat; it is not a failure to start.
      if (!(error instanceof HttpError && error.status === 401)) throw error
    }
    return c.json({})
  })

  app.post('/api/sessions/:id/config', async (c) => {
    const body = await c.req.json()
    const value: unknown = body.value
    if (typeof value !== 'string' && typeof value !== 'boolean') throw new HttpError(400, 'Missing "value"')
    await current().sessions.get(c.req.param('id')).setConfig(text(body.configId, 'configId'), value)
    return c.json({})
  })

  app.post('/api/sessions/:id/prompt', async (c) => {
    const body = await c.req.json()
    const activeNote = body.activeNote === undefined ? undefined : text(body.activeNote, 'activeNote')
    await current()
      .sessions.get(c.req.param('id'))
      .prompt(text(body.text, 'text'), contextRefs(body.context), activeNote)
    return c.json({})
  })

  app.post('/api/sessions/:id/cancel', async (c) => {
    await current().sessions.get(c.req.param('id')).cancel()
    return c.json({})
  })

  app.post('/api/sessions/:id/permission', async (c) => {
    const body = await c.req.json()
    const optionId = typeof body.optionId === 'string' ? body.optionId : null
    current().sessions.get(c.req.param('id')).answerPermission(text(body.requestId, 'requestId'), optionId)
    return c.json({})
  })

  app.post('/api/sessions/:id/authenticate', async (c) => {
    const body = await c.req.json()
    await current().sessions.get(c.req.param('id')).authenticate(text(body.methodId, 'methodId'))
    return c.json({})
  })

  app.all('/api/*', () => {
    throw new HttpError(404, 'Not found')
  })

  if (options.clientDir) app.use(serveStatic({ root: options.clientDir }))

  return {
    app,
    async close() {
      for (const socket of sockets) socket.close()
      await workspace?.close()
    },
  }
}

/** Validates a string taken from a request. */
/** The attachments of a prompt, checked one by one; paths are checked against the vault later. */
function contextRefs(value: unknown): ContextRef[] {
  if (value === undefined) return []
  if (!Array.isArray(value)) throw new HttpError(400, '"context" must be a list')
  return value.map((item: unknown): ContextRef => {
    const { path, selection, lines } = (item ?? {}) as Record<string, unknown>
    const ref: ContextRef = { path: text(path, 'context path') }
    if (selection !== undefined) ref.selection = text(selection, 'context selection')
    if (lines !== undefined) {
      const { from, to } = (lines ?? {}) as Record<string, unknown>
      if (!Number.isInteger(from) || !Number.isInteger(to) || (from as number) < 1 || (to as number) < (from as number)) {
        throw new HttpError(400, 'Bad context lines')
      }
      ref.lines = { from: from as number, to: to as number }
    }
    return ref
  })
}

function text(value: unknown, name: string, allowEmpty = false): string {
  if (typeof value !== 'string' || (!allowEmpty && !value)) {
    throw new HttpError(400, `Missing "${name}"`)
  }
  return value
}

function resolution(body: { content?: unknown; side?: unknown }): GitResolution {
  if (typeof body.content === 'string') return { content: body.content }
  if (body.side === 'local' || body.side === 'incoming' || body.side === 'disk') return { side: body.side }
  throw new HttpError(400, 'Missing "content" or "side"')
}
