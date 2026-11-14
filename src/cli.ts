#!/usr/bin/env node
import { fileURLToPath } from 'node:url'
import { serve } from '@hono/node-server'
import { defineCommand, runMain } from 'citty'
import open from 'open'
import { WebSocketServer } from 'ws'
import { description, version } from '../package.json'
import { createGalena } from './server/app'
import { errorMessage, hasCode } from './server/util'

const HOST = '127.0.0.1'
const DEFAULT_PORT = 3535

const main = defineCommand({
  meta: { name: 'galena', version, description },
  args: {
    path: {
      type: 'positional',
      required: false,
      description: 'Vault folder to open (omit to pick one in the browser)',
    },
    port: {
      type: 'string',
      description: `Port to listen on (default: ${DEFAULT_PORT}, or any free port if it is taken)`,
    },
    open: {
      type: 'boolean',
      default: true,
      description: 'Open the browser',
      negativeDescription: 'Do not open the browser',
    },
  },
  async run({ args }) {
    // A fixed port keeps the address bookmarkable. Only the default one gives
    // way to a free port when it is taken (by another Galena, say).
    let fallback = args.port === undefined
    const port = fallback ? DEFAULT_PORT : Number(args.port)
    if (!Number.isInteger(port) || port < 0 || port > 65535) fail(`Invalid port: ${args.port}`)

    const galena = await createGalena({
      vault: args.path,
      clientDir: fileURLToPath(new URL('./client', import.meta.url)),
    }).catch((error) => fail(errorMessage(error)))

    const server = serve(
      {
        fetch: galena.app.fetch,
        hostname: HOST,
        port,
        websocket: { server: new WebSocketServer({ noServer: true }) },
      },
      (info) => {
        const url = `http://${HOST}:${info.port}/`
        console.log(`Galena is running at ${url}\nPress Ctrl+C to stop.`)
        if (args.open) open(url).catch(() => console.log('Could not open the browser.'))
      },
    )
    server.on('error', (error) => {
      if (fallback && hasCode(error, 'EADDRINUSE')) {
        fallback = false
        console.log(`Port ${port} is in use.`)
        server.listen(0, HOST)
        return
      }
      fail(`Could not start the server: ${error.message}`)
    })

    const shutdown = async () => {
      await galena.close()
      process.exit(0)
    }
    process.once('SIGINT', shutdown)
    process.once('SIGTERM', shutdown)
  },
})

/** Exits with a plain message; expected failures need no stack trace. */
function fail(message: string): never {
  console.error(message)
  process.exit(1)
}

runMain(main)
