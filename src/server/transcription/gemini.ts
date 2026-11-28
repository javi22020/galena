// Gemini's transcription models, called over REST with an AI Studio API key.
// References:
//   https://aistudio.google.com/api-reference/interactions-api/create-interaction
//   https://aistudio.google.com/api-reference/models/list-models
//   https://aistudio.google.com/docs/transcribe
//   https://aistudio.google.com/docs/api-errors

import { setTimeout as sleep } from 'node:timers/promises'
import type { TranscriptionModel } from '../../shared/types'
import { HttpError } from '../util'
import type { TranscriptionProvider, TranscriptionRequest } from './provider'

const API = 'https://generativelanguage.googleapis.com/v1beta'

/** Tries per request, the first one included. */
const ATTEMPTS = 3
/** A wait the service asks for longer than this is not worth holding the user for. */
const MAX_WAIT_MS = 20_000
const LIST_TIMEOUT_MS = 15_000
/** Per try; a long recording can take a while to transcribe. */
const TRANSCRIBE_TIMEOUT_MS = 5 * 60_000

/** The audio content types of the Interactions API. */
const MIME_TYPES = new Set([
  'audio/wav',
  'audio/mp3',
  'audio/aiff',
  'audio/aac',
  'audio/ogg',
  'audio/flac',
  'audio/mpeg',
  'audio/m4a',
  'audio/l16',
  'audio/opus',
  'audio/alaw',
  'audio/mulaw',
  'audio/webm',
])

interface ModelList {
  models?: { name: string; displayName?: string; supportedGenerationMethods?: string[] }[]
  nextPageToken?: string
}

interface Interaction {
  status: string
  steps?: { type: string; content?: { type: string; text?: string }[] }[]
}

export const gemini: TranscriptionProvider = {
  id: 'gemini',
  name: 'Gemini',
  keyUrl: 'https://aistudio.google.com/apikey',
  mimeTypes: MIME_TYPES,

  async listModels(key, signal) {
    const models: TranscriptionModel[] = []
    let pageToken = ''
    do {
      const query = new URLSearchParams({ pageSize: '1000', ...(pageToken && { pageToken }) })
      const page = await call<ModelList>(key, `models?${query}`, undefined, LIST_TIMEOUT_MS, signal)
      for (const model of page.models ?? []) {
        // Names come as `models/<id>`. No field says what a model is for, so
        // the transcription ones are told by their id; of those, the live ones
        // only take a WebSocket session (`bidiGenerateContent`), not a request.
        const id = model.name.replace(/^models\//, '')
        const request = model.supportedGenerationMethods?.includes('generateContent')
        if (id.includes('transcribe') && request) models.push({ id, name: model.displayName || id })
      }
      pageToken = page.nextPageToken ?? ''
    } while (pageToken)
    return models.sort((a, b) => a.name.localeCompare(b.name))
  },

  async transcribe({ key, model, audio, mimeType, signal }: TranscriptionRequest) {
    const body = {
      model,
      input: [{ type: 'audio', mime_type: mimeType, data: Buffer.from(audio).toString('base64') }],
      // Nothing is kept on Google's side for later retrieval.
      store: false,
    }
    const interaction = await call<Interaction>(key, 'interactions', body, TRANSCRIBE_TIMEOUT_MS, signal)
    return transcript(interaction)
  },
}

/** The text of an interaction's model output. */
export function transcript(interaction: Interaction): string {
  if (interaction.status !== 'completed') {
    throw new HttpError(502, `Gemini did not finish the transcription (status "${interaction.status}")`)
  }
  return (interaction.steps ?? [])
    .filter((step) => step.type === 'model_output')
    .flatMap((step) => step.content ?? [])
    .map((content) => (content.type === 'text' ? (content.text ?? '') : ''))
    .join('')
    .trim()
}

/**
 * A request to the API: a GET without a body, a POST with one. As Google's
 * troubleshooting guide says, 429, 408 and 5xx are tried again with a growing
 * wait; anything else the API turns down would fail the same way. A 429 is
 * not told apart by its body (rate limit or used-up quota), whose format the
 * docs contradict: Google's own message says which it is.
 */
async function call<T>(
  key: string,
  path: string,
  body: unknown,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    const signals = [AbortSignal.timeout(timeoutMs), ...(signal ? [signal] : [])]
    let response: Response
    try {
      response = await fetch(`${API}/${path}`, {
        method: body === undefined ? 'GET' : 'POST',
        headers: { 'x-goog-api-key': key, ...(body !== undefined && { 'content-type': 'application/json' }) },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.any(signals),
      })
    } catch (error) {
      if (signal?.aborted) throw error
      if (attempt < ATTEMPTS) {
        await sleep(backoff(attempt), undefined, { signal })
        continue
      }
      const timedOut = error instanceof Error && error.name === 'TimeoutError'
      throw new HttpError(502, timedOut ? 'Gemini took too long to answer' : 'Could not reach Gemini')
    }
    if (response.ok) return (await response.json()) as T

    const error = await apiError(response)
    const wait = retryAfter(response) ?? backoff(attempt)
    if (attempt < ATTEMPTS && retryable(response.status) && wait <= MAX_WAIT_MS) {
      await sleep(wait, undefined, { signal })
      continue
    }
    throw httpError(response.status, error)
  }
}

/** All that is read of an error: its message, meant for people. */
interface ApiError {
  message?: string
}

async function apiError(response: Response): Promise<ApiError> {
  const data = (await response.json().catch(() => null)) as { error?: ApiError } | null
  return data?.error ?? {}
}

function retryable(status: number): boolean {
  return status === 429 || status === 408 || status >= 500
}

/** Turns what the API answered into an error for the browser; Gemini's own message goes along. */
export function httpError(status: number, error: ApiError): HttpError {
  const detail = error.message ? `: ${error.message}` : ''
  if (status === 401 || status === 403) return new HttpError(400, `Gemini did not accept the API key${detail}`)
  if (status === 429) return new HttpError(429, `Gemini's rate limit or quota was reached${detail}`)
  if (status >= 400 && status < 500) return new HttpError(400, `Gemini turned down the request${detail}`)
  return new HttpError(502, `Gemini failed${detail}`)
}

/** 1 s, 2 s, 4 s…, with some jitter so that retries do not line up. */
function backoff(attempt: number): number {
  return 1000 * 2 ** (attempt - 1) * (0.8 + Math.random() * 0.4)
}

/** The `Retry-After` header in milliseconds, when it is a number of seconds. */
function retryAfter(response: Response): number | undefined {
  const seconds = Number(response.headers.get('retry-after') ?? NaN)
  return Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000 : undefined
}
