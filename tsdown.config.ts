import { defineConfig } from 'tsdown'

// Bundles the CLI and server into dist/cli.mjs; the SPA is built by Vite into dist/client.
export default defineConfig({
  entry: 'src/cli.ts',
  format: 'esm',
  platform: 'node',
  target: 'node22',
  dts: false,
})
