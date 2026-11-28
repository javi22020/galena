// Voice dictation: records from the microphone and sends the audio to the
// server to be transcribed. The text goes in at the cursor of the note that
// was on screen when the recording started, or to the clipboard if that note
// is no longer the one on screen.
//
// A long recording is cut into pieces, since a transcription request takes
// up to an hour of audio and silently drops the rest: after 25 minutes the
// recording moves on to a new piece at the first pause in speech, and after
// 30 at the latest. Each piece is a file of its own, transcribed while the
// next one is being recorded, so stopping only waits for the last one.

import { toast } from 'sonner'
import { create } from 'zustand'
import { api } from './api'
import { editorHooks, useStore } from './store'

export type DictationStatus = 'idle' | 'starting' | 'recording' | 'paused' | 'transcribing' | 'failed'

interface DictationState {
  status: DictationStatus
  /** Seconds recorded, pauses left out. */
  elapsed: number
  /** Why the transcription failed, while `status` is `failed`. */
  error: string | null
}

export const useDictation = create<DictationState>(() => ({ status: 'idle', elapsed: 0, error: null }))

/** Formats the browser may record in, best first; all of them are accepted by the server. */
const FORMATS = ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/webm', 'audio/ogg']
/** Plenty for speech, and about 7 MB per 30 minutes. */
const BITS_PER_SECOND = 32_000
const PIECE_MIN_MS = 25 * 60_000
const PIECE_MAX_MS = 30 * 60_000
/** Below this level (RMS of samples in [-1, 1]) for this long counts as a pause in speech. */
const SILENCE_LEVEL = 0.015
const SILENCE_MS = 400
const TICK_MS = 100

interface Piece {
  audio: Blob
  text?: string
  error?: string
  job?: Promise<void>
}

/** The recording under way, from `start` until it is delivered or discarded. */
class Recording {
  private recorder!: MediaRecorder
  private chunks: Blob[] = []
  private pieces: Piece[] = []
  private recordedMs = 0
  private pieceMs = 0
  private quietMs = 0
  private lastTick = performance.now()
  private timer: number
  private samples: Float32Array<ArrayBuffer>
  /** Set once discarded: whatever is still on its way is ignored. */
  private dropped = false

  constructor(
    private readonly stream: MediaStream,
    private readonly context: AudioContext,
    private readonly analyser: AnalyserNode,
    private readonly mimeType: string,
    /** The tab whose note gets the text. */
    private readonly tab: number | null,
  ) {
    this.samples = new Float32Array(analyser.fftSize)
    // A microphone unplugged or taken away ends the recording, keeping what it got.
    for (const track of stream.getAudioTracks()) track.addEventListener('ended', () => void stopDictation())
    this.startPiece()
    this.timer = window.setInterval(() => this.tick(), TICK_MS)
  }

  /** The loudness of the last moment of sound, from 0 up. */
  level(): number {
    this.analyser.getFloatTimeDomainData(this.samples)
    let sum = 0
    for (const sample of this.samples) sum += sample * sample
    return Math.sqrt(sum / this.samples.length)
  }

  pause(): void {
    this.recorder.pause()
  }

  resume(): void {
    this.lastTick = performance.now()
    this.recorder.resume()
  }

  /** Ends the recording and waits for every piece to be transcribed. */
  async stop(): Promise<void> {
    // Right away, so that a second click or the microphone going away does not stop it twice.
    useDictation.setState({ status: 'transcribing', error: null })
    clearInterval(this.timer)
    await this.endPiece()
    this.release()
    await this.finish()
  }

  /** Transcribes again the pieces that failed. */
  async retry(): Promise<void> {
    for (const piece of this.pieces) if (piece.text === undefined) this.transcribe(piece)
    await this.finish()
  }

  discard(): void {
    this.dropped = true
    clearInterval(this.timer)
    if (this.recorder.state !== 'inactive') this.recorder.stop()
    this.release()
  }

  private startPiece(): void {
    // Each recorder fills its own array: the last data of a piece arrives after
    // the next piece has started, and must not end up in it.
    const chunks: Blob[] = []
    this.chunks = chunks
    this.pieceMs = 0
    this.recorder = new MediaRecorder(this.stream, { mimeType: this.mimeType, audioBitsPerSecond: BITS_PER_SECOND })
    this.recorder.addEventListener('dataavailable', (event) => chunks.push(event.data))
    this.recorder.start()
  }

  /** Stops the piece being recorded and sends it off; resolves once it is sent. */
  private endPiece(): Promise<void> {
    const { recorder, chunks } = this
    if (recorder.state === 'inactive') return Promise.resolve()
    return new Promise((resolve) => {
      recorder.addEventListener(
        'stop',
        () => {
          const audio = new Blob(chunks, { type: recorder.mimeType || this.mimeType })
          if (audio.size > 0 && !this.dropped) {
            const piece: Piece = { audio }
            this.pieces.push(piece)
            this.transcribe(piece)
          }
          resolve()
        },
        { once: true },
      )
      recorder.stop()
    })
  }

  private tick(): void {
    const now = performance.now()
    const passed = now - this.lastTick
    this.lastTick = now
    if (this.recorder.state !== 'recording') return
    this.recordedMs += passed
    this.pieceMs += passed
    this.quietMs = this.level() < SILENCE_LEVEL ? this.quietMs + passed : 0
    const elapsed = Math.floor(this.recordedMs / 1000)
    if (elapsed !== useDictation.getState().elapsed) useDictation.setState({ elapsed })
    if (this.pieceMs >= PIECE_MAX_MS || (this.pieceMs >= PIECE_MIN_MS && this.quietMs >= SILENCE_MS)) {
      void this.endPiece()
      this.startPiece()
    }
  }

  private transcribe(piece: Piece): void {
    piece.error = undefined
    piece.job = api.transcribe(piece.audio).then(
      (text) => void (piece.text = text),
      (error: unknown) => void (piece.error = error instanceof Error ? error.message : String(error)),
    )
  }

  /** Once every piece is back: the text, joined, goes to the note; or the first failure is shown. */
  private async finish(): Promise<void> {
    useDictation.setState({ status: 'transcribing', error: null })
    await Promise.all(this.pieces.map((piece) => piece.job ?? Promise.resolve()))
    if (this.dropped) return
    const failed = this.pieces.find((piece) => piece.text === undefined)
    if (failed) return useDictation.setState({ status: 'failed', error: failed.error ?? 'The transcription failed' })
    reset()
    await deliver(this.pieces.map((piece) => piece.text).filter(Boolean).join(' '), this.tab)
  }

  private release(): void {
    for (const track of this.stream.getTracks()) track.stop()
    void this.context.close().catch(() => {})
  }
}

let recording: Recording | null = null

function reset(): void {
  recording = null
  useDictation.setState({ status: 'idle', elapsed: 0, error: null })
}

/** How loud the microphone is right now, for drawing it; null when nothing is being recorded. */
export function dictationLevel(): number | null {
  const { status } = useDictation.getState()
  return recording && (status === 'recording' || status === 'paused') ? recording.level() : null
}

export async function startDictation(): Promise<void> {
  if (useDictation.getState().status !== 'idle') return
  const mimeType = FORMATS.find((format) => window.MediaRecorder?.isTypeSupported(format))
  if (!mimeType) return void toast.error('This browser cannot record audio in a format that can be transcribed')
  useDictation.setState({ status: 'starting', elapsed: 0, error: null })
  let stream: MediaStream
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    })
  } catch (error) {
    reset()
    return void toast.error(microphoneError(error))
  }
  // Closed or discarded while the browser asked for the microphone.
  if (useDictation.getState().status !== 'starting') {
    for (const track of stream.getTracks()) track.stop()
    return
  }
  const context = new AudioContext()
  const analyser = context.createAnalyser()
  analyser.fftSize = 2048
  context.createMediaStreamSource(stream).connect(analyser)
  recording = new Recording(stream, context, analyser, mimeType, useStore.getState().active)
  useDictation.setState({ status: 'recording' })
}

export function pauseDictation(): void {
  if (useDictation.getState().status !== 'recording') return
  recording?.pause()
  useDictation.setState({ status: 'paused' })
}

export function resumeDictation(): void {
  if (useDictation.getState().status !== 'paused') return
  recording?.resume()
  useDictation.setState({ status: 'recording' })
}

export async function stopDictation(): Promise<void> {
  const { status } = useDictation.getState()
  if (status !== 'recording' && status !== 'paused') return
  await recording?.stop()
}

export async function retryDictation(): Promise<void> {
  if (useDictation.getState().status === 'failed') await recording?.retry()
}

/** A press of the shortcut starts a dictation, and the next ends it and has it transcribed. */
export function toggleDictation(): void {
  const { status } = useDictation.getState()
  if (status === 'idle') void startDictation()
  else if (status === 'recording' || status === 'paused') void stopDictation()
}

/** Throws away the recording and anything still being transcribed. */
export function discardDictation(): void {
  recording?.discard()
  reset()
}

/**
 * Typed at the cursor if the note the recording started in is on screen and
 * the cursor is in it; to the clipboard otherwise.
 */
async function deliver(text: string, tab: number | null): Promise<void> {
  if (!text) return void toast('No speech was heard in the recording')
  if (tab !== null && useStore.getState().active === tab && editorHooks.insert(text)) return
  try {
    await navigator.clipboard.writeText(text)
    toast.success('The dictation was copied to the clipboard', {
      description: 'To have it typed in a note instead, leave the cursor in the note while dictating.',
    })
  } catch {
    // Browsers may refuse to write to the clipboard without a click, so offer one.
    toast('The dictation is ready', {
      description: 'Copy the text to paste it where you want it.',
      duration: Infinity,
      action: { label: 'Copy', onClick: () => void navigator.clipboard.writeText(text) },
    })
  }
}

function microphoneError(error: unknown): string {
  const name = error instanceof DOMException ? error.name : ''
  if (name === 'NotAllowedError') return 'Galena needs permission to use the microphone to dictate'
  if (name === 'NotFoundError') return 'No microphone was found'
  if (name === 'NotReadableError') return 'The microphone is in use by another program'
  return `The microphone could not be opened${error instanceof Error ? `: ${error.message}` : ''}`
}
