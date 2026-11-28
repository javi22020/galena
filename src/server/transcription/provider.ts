// A speech-to-text service. Each one lives in its own module and is listed in
// `providers` (see index.ts); the rest of Galena only knows this interface.

import type { TranscriptionModel } from '../../shared/types'

export interface TranscriptionRequest {
  key: string
  model: string
  audio: Uint8Array
  /** Media type of the audio, without parameters, e.g. `audio/webm`. */
  mimeType: string
  /** Aborted when the browser that asked gives up. */
  signal?: AbortSignal
}

export interface TranscriptionProvider {
  id: string
  name: string
  /** Where the user gets an API key. */
  keyUrl: string
  /** Media types the service takes. */
  mimeTypes: ReadonlySet<string>
  /**
   * The models that can transcribe, for the user to pick one in Settings;
   * none is picked for them. Also how a key is checked: the call throws an
   * `HttpError` with status 400 when the service turns it down.
   */
  listModels(key: string, signal?: AbortSignal): Promise<TranscriptionModel[]>
  /** The text spoken in the audio. Errors are `HttpError`s fit to show. */
  transcribe(request: TranscriptionRequest): Promise<string>
}
