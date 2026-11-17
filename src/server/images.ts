import { createHash, randomUUID } from 'node:crypto'
import { mkdir, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { HttpError } from './util'
import type { Vault } from './vault'

/** The images Galena lists, stores and serves, by the extension of their names. */
const TYPES = new Map([
  ['png', 'image/png'],
  ['jpg', 'image/jpeg'],
  ['jpeg', 'image/jpeg'],
  ['gif', 'image/gif'],
  ['webp', 'image/webp'],
  ['svg', 'image/svg+xml'],
])

/** The largest image that can be pasted into a note. */
export const MAX_IMAGE_SIZE = 20 * 1024 * 1024

/**
 * The media type of an image, going by its name; null for any other file.
 * What is in the file is not looked at: whatever it is, the browser is told
 * to take it for that image and nothing else (see `imageHeaders`).
 */
export function imageType(path: string): string | null {
  const extension = /\.([^./]+)$/.exec(path)?.[1]?.toLowerCase() ?? ''
  return TYPES.get(extension) ?? null
}

/**
 * The headers an image is served with; a file that is not one is refused.
 * The browser must not guess another type, and an image opened on its own
 * must not run scripts on the app's origin, as an SVG could.
 */
export function imageHeaders(path: string): Record<string, string> {
  const type = imageType(path)
  if (!type) throw new HttpError(415, `Not an image: ${path}`)
  return {
    'content-type': type,
    'x-content-type-options': 'nosniff',
    'content-security-policy': 'sandbox',
    'cache-control': 'no-cache',
  }
}

/**
 * Stores an image in `assets/`, a visible folder as Obsidian has it, and
 * returns its path. The name is the original's, made safe, with part of the
 * image's hash: the same image pasted twice is stored once, and `image.png`
 * from two screenshots twice.
 */
export async function saveImage(vault: Vault, name: string, bytes: Uint8Array): Promise<string> {
  if (!imageType(name)) throw new HttpError(415, 'Only PNG, JPEG, GIF, WEBP and SVG images can be added')
  const dot = name.lastIndexOf('.')
  // Accents written apart from their letters (as macOS names files) are letters too.
  const safe = name.slice(0, dot).normalize('NFC').replace(/[^\p{L}\p{N}_-]+/gu, '-')
  // Cut by characters, as some letters take two units of the string.
  const base = Array.from(safe).slice(0, 60).join('').replace(/^-+|-+$/g, '') || 'image'
  const hash = createHash('sha256').update(bytes).digest('hex').slice(0, 8)
  const rel = `assets/${base}-${hash}${name.slice(dot).toLowerCase()}`
  const abs = vault.resolve(rel)
  // Written apart and moved into place, so the image is never there half
  // written. Its name says what is in it: one already there is the same image.
  const part = path.join(vault.configDir, `${randomUUID()}.part`)
  await mkdir(vault.configDir, { recursive: true })
  await mkdir(path.dirname(abs), { recursive: true })
  try {
    await writeFile(part, bytes)
    await rename(part, abs)
  } finally {
    await rm(part, { force: true })
  }
  return rel
}
