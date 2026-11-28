// Voice dictation: which provider and model to use, and the provider's API
// key. They belong to the user, not to a vault, so they are kept in the
// user's config folder, where no vault repository can pick the key up; the
// file can be read by its owner only. The browser is never sent the key.
//
// There is no default model: providers give no reliable way to tell which of
// their models is the one to use, so the user picks it in Settings.

import path from 'node:path'
import type { TranscriptionModel, TranscriptionState } from '../../shared/types'
import { configDir, HttpError, readJson, writeJson } from '../util'
import { gemini } from './gemini'
import type { TranscriptionProvider } from './provider'

/** Every provider Galena can use; the first one is the default. */
const providers: readonly TranscriptionProvider[] = [gemini]

/** The largest piece of audio taken at once. The browser sends about 7 MB per 30 minutes. */
export const MAX_AUDIO_SIZE = 25 * 1024 * 1024

interface Stored {
  provider?: string
  providers?: Record<string, { key?: string; model?: string }>
}

export class Transcription {
  constructor(private readonly file = path.join(configDir, 'transcription.json')) {}

  async state(): Promise<TranscriptionState> {
    const { provider, saved } = await this.load()
    return {
      provider: provider.id,
      providerName: provider.name,
      keyUrl: provider.keyUrl,
      model: saved.model ?? null,
      configured: !!saved.key,
    }
  }

  /**
   * Sets the key (null removes it) or the model (null or empty unsets it).
   * A new key is checked with the provider first, so a wrong one is never stored.
   */
  async update(change: { key?: string | null; model?: string | null }): Promise<TranscriptionState> {
    const { stored, provider, saved } = await this.load()
    const next = { ...saved }
    if (change.key === null) delete next.key
    else if (change.key !== undefined) {
      const key = change.key.trim()
      if (!key) throw new HttpError(400, 'The API key is empty')
      await provider.listModels(key)
      next.key = key
    }
    if (change.model !== undefined) {
      const model = change.model?.trim()
      if (model) next.model = model
      else delete next.model
    }
    const providers = { ...stored.providers, [provider.id]: next }
    await writeJson(this.file, { ...stored, provider: provider.id, providers }, 0o600)
    return this.state()
  }

  async models(): Promise<TranscriptionModel[]> {
    const { provider, saved } = await this.load()
    if (!saved.key) throw new HttpError(409, 'No API key is set for transcription')
    return provider.listModels(saved.key)
  }

  async transcribe(audio: Uint8Array, contentType: string, signal?: AbortSignal): Promise<string> {
    const { provider, saved } = await this.load()
    if (!saved.key) throw new HttpError(409, 'No API key is set for transcription')
    if (!saved.model) throw new HttpError(409, 'Pick a transcription model in Settings')
    const mimeType = contentType.split(';')[0]!.trim().toLowerCase()
    if (!provider.mimeTypes.has(mimeType)) {
      throw new HttpError(415, `${provider.name} cannot transcribe ${mimeType || 'audio of an unknown type'}`)
    }
    if (!audio.length) throw new HttpError(400, 'The recording is empty')
    return provider.transcribe({ key: saved.key, model: saved.model, audio, mimeType, signal })
  }

  private async load() {
    const stored = await readJson<Stored>(this.file, {})
    const provider = providers.find((p) => p.id === stored.provider) ?? providers[0]!
    const raw = stored.providers?.[provider.id]
    const saved: { key?: string; model?: string } = {
      ...(typeof raw?.key === 'string' && raw.key && { key: raw.key }),
      ...(typeof raw?.model === 'string' && raw.model && { model: raw.model }),
    }
    return { stored, provider, saved }
  }
}
