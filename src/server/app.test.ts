import { expect, test } from 'vitest'
import { createGalena } from './app'

// No vault is open, so a request that gets past the guard is answered with 409
// before anything is read or written; one the guard stops, with 403.
const PASSED = 409
const REFUSED = 403

const { app } = await createGalena({})

async function status(method: string, headers: Record<string, string>): Promise<number> {
  const body = method === 'GET' ? undefined : '{}'
  const response = await app.request('/api/file', { method, headers, body })
  return response.status
}

test('requests are taken only when addressed to this machine', async () => {
  expect(await status('GET', { host: '127.0.0.1:5173' })).toBe(PASSED)
  expect(await status('GET', { host: 'localhost:5173' })).toBe(PASSED)
  expect(await status('GET', { host: '[::1]:5173' })).toBe(PASSED)
  expect(await status('GET', { host: 'localhost' })).toBe(PASSED)
  // A name that another site points at this machine (DNS rebinding).
  expect(await status('GET', { host: 'evil.example:5173' })).toBe(REFUSED)
  expect(await status('GET', { host: 'localhost.evil.example' })).toBe(REFUSED)
  expect(await status('GET', {})).toBe(REFUSED)
})

test('a request that changes something must come from the app itself', async () => {
  const host = '127.0.0.1:5173'
  for (const method of ['POST', 'PUT', 'DELETE']) {
    expect(await status(method, { host, origin: `http://${host}` }), method).toBe(PASSED)
    expect(await status(method, { host }), `${method} without origin`).toBe(REFUSED)
    expect(await status(method, { host, origin: 'https://evil.example' }), `${method} from elsewhere`).toBe(REFUSED)
  }
})

test('another site on this machine is another origin', async () => {
  const host = '127.0.0.1:5173'
  expect(await status('POST', { host, origin: 'http://127.0.0.1:8080' })).toBe(REFUSED)
  expect(await status('POST', { host, origin: 'http://localhost:5173' })).toBe(REFUSED)
  expect(await status('POST', { host, origin: 'null' })).toBe(REFUSED)
})

test('a read needs no origin, but one that has it must be the app', async () => {
  const host = '127.0.0.1:5173'
  expect(await status('GET', { host, origin: `http://${host}` })).toBe(PASSED)
  expect(await status('GET', { host, origin: 'https://evil.example' })).toBe(REFUSED)
})

test('a WebSocket is opened only by the app, since its messages can be read by whoever opens it', async () => {
  const host = '127.0.0.1:5173'
  const upgrade = { host, upgrade: 'websocket', connection: 'Upgrade' }
  expect(await status('GET', upgrade)).toBe(REFUSED)
  expect(await status('GET', { ...upgrade, origin: 'https://evil.example' })).toBe(REFUSED)
  expect(await status('GET', { ...upgrade, origin: `http://${host}` })).toBe(PASSED)
})
