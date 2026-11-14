// Development entry, loaded by @hono/vite-dev-server (see vite.config.ts).
// Set GALENA_VAULT to open a vault right away.

import { createAdaptorServer } from '@hono/node-server'
import { WebSocketServer } from 'ws'
import { createGalena, type Galena } from './app'

// Vite re-evaluates this module when server code changes, so the previous
// instance (file watcher, agent processes) has to be disposed of first.
const state = globalThis as { galena?: Galena }
await state.galena?.close()
const galena = await createGalena({ vault: process.env.GALENA_VAULT })
state.galena = galena

export default galena.app

/** Never listens: Vite's own server forwards WebSocket upgrades to it. */
export const upgradeServer = createAdaptorServer({
  fetch: galena.app.fetch,
  websocket: { server: new WebSocketServer({ noServer: true }) },
})
