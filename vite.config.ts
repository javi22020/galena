import devServer from '@hono/vite-dev-server'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'

const serverEntry = 'src/server/dev.ts'

// @hono/vite-dev-server only forwards plain HTTP requests, so WebSocket upgrades
// for the API are handed to the app's own (never listening) upgrade server.
const apiWebSocket: Plugin = {
  name: 'galena:api-websocket',
  configureServer(vite) {
    vite.httpServer?.on('upgrade', async (req, socket, head) => {
      if (!req.url?.startsWith('/api/')) return // Vite's HMR socket
      const { upgradeServer } = await vite.ssrLoadModule(serverEntry)
      upgradeServer.emit('upgrade', req, socket, head)
    })
  },
}

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    // Only /api goes to the Hono app; Vite serves the SPA itself.
    devServer({ entry: serverEntry, exclude: [/^\/(?!api\/)/], injectClientScript: false }),
    apiWebSocket,
  ],
  // Resolves the `@/` alias declared in tsconfig.json.
  resolve: { tsconfigPaths: true },
  server: { host: '127.0.0.1', open: true },
  // A single bundle is fine: it is only ever served from this machine.
  build: { outDir: 'dist/client', chunkSizeWarningLimit: 2500 },
})
