import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, afterEach, beforeEach, expect, test, vi } from 'vitest'

// The key file lives in the user's config folder; this points it elsewhere
// before anything reads where it is.
const scratch = await mkdtemp(path.join(tmpdir(), 'galena-transcription-'))
vi.stubEnv('XDG_CONFIG_HOME', path.join(scratch, 'config'))
const { createGalena } = await import('../app')
const { gemini, httpError, transcript } = await import('./gemini')
const { Transcription } = await import('.')

const KEY = 'AIza-test-key'
const host = '127.0.0.1:5173'
const headers = { host, origin: `http://${host}` }
const file = path.join(scratch, 'config', 'galena', 'transcription.json')

const fetchMock = vi.fn<typeof fetch>()
beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => vi.unstubAllGlobals())
afterAll(() => rm(scratch, { recursive: true, force: true }))

/** The URL and options of the `index`th request sent; Gemini's module always passes a string URL. */
function sent(index: number) {
  const [url, init] = fetchMock.mock.calls.at(index)!
  return { url: url as string, init: init!, headers: init!.headers as Record<string, string> }
}

function json(body: unknown, status = 200, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...extra } })
}

const GENERATE = ['generateContent', 'countTokens']
const MODEL = 'gemini-3.5-transcribe'

const MODELS = {
  models: [
    // As the API lists them (trimmed).
    { name: 'models/gemini-3.5-flash', displayName: 'Gemini 3.5 Flash', supportedGenerationMethods: GENERATE },
    { name: 'models/gemini-3.5-transcribe', displayName: 'Gemini 3.5 Transcribe', supportedGenerationMethods: GENERATE },
    {
      name: 'models/gemini-3.5-transcribe-live',
      displayName: 'Gemini 3.5 Transcribe Live',
      supportedGenerationMethods: ['bidiGenerateContent'],
    },
  ],
}

const COMPLETED = {
  id: 'v1_abc',
  status: 'completed',
  steps: [{ type: 'model_output', content: [{ type: 'text', text: ' Hola, esto es una prueba. ' }] }],
}

test('only the transcription models that take a request, not just a live session, are listed', async () => {
  fetchMock.mockResolvedValueOnce(json(MODELS))
  expect(await gemini.listModels(KEY)).toEqual([{ id: 'gemini-3.5-transcribe', name: 'Gemini 3.5 Transcribe' }])
  const { url, init, headers } = sent(0)
  expect(url).toBe('https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000')
  expect(init.method).toBe('GET')
  expect(headers['x-goog-api-key']).toBe(KEY)
})

test('every page of models is read, and they are listed by name', async () => {
  fetchMock
    .mockResolvedValueOnce(
      json({ models: [{ name: 'models/b-transcribe', supportedGenerationMethods: GENERATE }], nextPageToken: 'next' }),
    )
    .mockResolvedValueOnce(json({ models: [{ name: 'models/a-transcribe', supportedGenerationMethods: GENERATE }] }))
  expect((await gemini.listModels(KEY)).map((m) => m.id)).toEqual(['a-transcribe', 'b-transcribe'])
  expect(sent(1).url).toContain('pageToken=next')
})

test('the audio goes inline, in base64, and nothing is stored by Google', async () => {
  fetchMock.mockResolvedValueOnce(json(COMPLETED))
  const audio = new Uint8Array([1, 2, 3, 250])
  const text = await gemini.transcribe({ key: KEY, model: 'gemini-3.5-transcribe', audio, mimeType: 'audio/webm' })
  expect(text).toBe('Hola, esto es una prueba.')
  const { url, init } = sent(0)
  expect(url).toBe('https://generativelanguage.googleapis.com/v1beta/interactions')
  expect(init.method).toBe('POST')
  expect(JSON.parse(init.body as string)).toEqual({
    model: 'gemini-3.5-transcribe',
    input: [{ type: 'audio', mime_type: 'audio/webm', data: Buffer.from(audio).toString('base64') }],
    store: false,
  })
})

test('the text is that of the model output; an unfinished interaction is an error', () => {
  expect(
    transcript({
      status: 'completed',
      steps: [
        { type: 'user_input', content: [{ type: 'text', text: 'ignored' }] },
        { type: 'model_output', content: [{ type: 'text', text: 'one ' }, { type: 'text', text: 'two' }] },
      ],
    }),
  ).toBe('one two')
  expect(transcript({ status: 'completed' })).toBe('')
  expect(() => transcript({ status: 'incomplete' })).toThrow(/incomplete/)
})

test('a rate limit is tried again, after the wait the API asks for', async () => {
  vi.useFakeTimers()
  try {
    fetchMock
      .mockResolvedValueOnce(json({ error: { code: 'rate_limit_exceeded', message: 'slow down' } }, 429, { 'retry-after': '2' }))
      .mockResolvedValueOnce(json(COMPLETED))
    const result = gemini.transcribe({ key: KEY, model: 'm', audio: new Uint8Array([1]), mimeType: 'audio/ogg' })
    await vi.advanceTimersByTimeAsync(1999)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(await result).toBe('Hola, esto es una prueba.')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  } finally {
    vi.useRealTimers()
  }
})

test('a 429 that keeps coming is given up on after three tries, with Google\'s message', async () => {
  vi.useFakeTimers()
  try {
    // Whatever its body says: a used-up quota and a rate limit are treated alike.
    const quota = () => json({ error: { code: 'quota_exceeded', message: 'Daily quota used up' } }, 429)
    fetchMock.mockImplementation(async () => quota())
    const result = gemini.listModels(KEY).catch((error: unknown) => error)
    await vi.runAllTimersAsync()
    expect(await result).toMatchObject({ status: 429, message: expect.stringMatching(/Daily quota used up/) })
    expect(fetchMock).toHaveBeenCalledTimes(3)
  } finally {
    vi.useRealTimers()
  }
})

test('a rejected request is not tried again', async () => {
  fetchMock.mockResolvedValueOnce(json({ error: { code: 'invalid_request', message: 'bad audio' } }, 400))
  await expect(gemini.listModels(KEY)).rejects.toMatchObject({ status: 400, message: expect.stringMatching(/bad audio/) })
  expect(fetchMock).toHaveBeenCalledTimes(1)
})

test("the API's errors are told apart for the browser", () => {
  expect(httpError(401, { message: 'API key not valid' })).toMatchObject({ status: 400 })
  expect(httpError(403, {}).message).toMatch(/API key/)
  expect(httpError(429, { message: 'slow down' })).toMatchObject({ status: 429 })
  expect(httpError(500, {})).toMatchObject({ status: 502 })
})

test('a key is checked before it is stored, in a file only its owner can read', async () => {
  const transcription = new Transcription(file)
  fetchMock.mockResolvedValueOnce(json({ error: { code: 'authentication', message: 'API key not valid' } }, 401))
  await expect(transcription.update({ key: 'wrong' })).rejects.toMatchObject({ status: 400 })
  expect((await transcription.state()).configured).toBe(false)

  fetchMock.mockResolvedValueOnce(json(MODELS))
  const state = await transcription.update({ key: ` ${KEY} ` })
  expect(state).toMatchObject({ provider: 'gemini', providerName: 'Gemini', model: null, configured: true })
  expect(JSON.parse(await readFile(file, 'utf8')).providers.gemini.key).toBe(KEY)
  // Windows has no such permissions to check.
  const mode = (await stat(file)).mode & 0o777
  expect(mode).toBe(process.platform === 'win32' ? mode : 0o600)

  expect((await transcription.update({ model: 'gemini-4-transcribe' })).model).toBe('gemini-4-transcribe')
  expect((await transcription.update({ model: null })).model).toBeNull()
  expect((await transcription.update({ key: null })).configured).toBe(false)
})

test('nothing is transcribed without a key and a model picked by the user', async () => {
  const transcription = new Transcription(path.join(scratch, 'other.json'))
  await expect(transcription.transcribe(new Uint8Array([1]), 'audio/webm')).rejects.toMatchObject({ status: 409 })
  fetchMock.mockResolvedValueOnce(json(MODELS))
  await transcription.update({ key: KEY })
  await expect(transcription.transcribe(new Uint8Array([1]), 'audio/webm')).rejects.toMatchObject({
    status: 409,
    message: expect.stringMatching(/model/),
  })
  expect(fetchMock).toHaveBeenCalledTimes(1)
})

test('only audio the provider takes is sent, to the model picked', async () => {
  const transcription = new Transcription(path.join(scratch, 'picked.json'))
  fetchMock.mockResolvedValueOnce(json(MODELS))
  await transcription.update({ key: KEY })
  await transcription.update({ model: MODEL })
  await expect(transcription.transcribe(new Uint8Array([1]), 'audio/mp4')).rejects.toMatchObject({ status: 415 })
  await expect(transcription.transcribe(new Uint8Array(), 'audio/webm')).rejects.toMatchObject({ status: 400 })

  fetchMock.mockResolvedValueOnce(json(COMPLETED))
  expect(await transcription.transcribe(new Uint8Array([1]), 'audio/webm;codecs=opus')).toBe('Hola, esto es una prueba.')
  const body = JSON.parse(sent(-1).init.body as string)
  expect(body.input[0].mime_type).toBe('audio/webm')
  expect(body.model).toBe(MODEL)
})

test('the API never sends the key back, and takes changes only from the app', async () => {
  const { app } = await createGalena({})
  fetchMock.mockResolvedValueOnce(json(MODELS))
  const put = await app.request('/api/transcription', {
    method: 'PUT',
    headers: { ...headers, 'content-type': 'application/json' },
    body: JSON.stringify({ key: KEY, model: MODEL }),
  })
  expect(put.status).toBe(200)
  expect(await put.text()).not.toContain(KEY)

  const get = await app.request('/api/transcription', { headers: { host } })
  expect(await get.json()).toMatchObject({ configured: true, model: MODEL })

  const foreign = await app.request('/api/transcription', {
    method: 'PUT',
    headers: { host, origin: 'https://evil.example', 'content-type': 'application/json' },
    body: JSON.stringify({ key: null }),
  })
  expect(foreign.status).toBe(403)

  fetchMock.mockResolvedValueOnce(json(COMPLETED))
  const transcribed = await app.request('/api/transcribe', {
    method: 'POST',
    headers: { ...headers, 'content-type': 'audio/ogg;codecs=opus' },
    body: new Uint8Array([1, 2, 3]),
  })
  expect(await transcribed.json()).toEqual({ text: 'Hola, esto es una prueba.' })
})
