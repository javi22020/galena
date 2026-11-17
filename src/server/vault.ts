import { mkdir, readdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { Entry } from '../shared/types'
import { exists, hasCode, HttpError } from './util'

/**
 * File access to a vault folder. Every method takes vault-relative paths and
 * refuses anything outside the vault or inside a hidden folder (`.obsidian`,
 * `.git`, Galena's own `.galena`, ...).
 */
export class Vault {
  readonly root: string
  readonly name: string
  /** Galena's own folder inside the vault: settings, sessions, trash. */
  readonly configDir: string

  private constructor(root: string) {
    this.root = root
    this.name = path.basename(root)
    this.configDir = path.join(root, '.galena')
  }

  static async open(dir: string): Promise<Vault> {
    const root = path.resolve(dir)
    const info = await stat(root).catch(() => null)
    if (!info?.isDirectory()) throw new HttpError(400, `Not a folder: ${root}`)
    return new Vault(root)
  }

  /** Absolute path of a vault-relative one. */
  resolve(rel: string): string {
    const abs = path.resolve(this.root, rel)
    this.relative(abs)
    return abs
  }

  /** Vault-relative path of an absolute one. */
  relative(abs: string): string {
    const rel = path.relative(this.root, abs)
    if (rel.startsWith('..') || path.isAbsolute(rel)) {
      throw new HttpError(403, `Outside the vault: ${abs}`)
    }
    const segments = rel.split(path.sep)
    if (segments.some((s) => s.startsWith('.'))) throw new HttpError(403, `Hidden path: ${rel}`)
    return segments.join('/')
  }

  /** All folders and notes, parents before children. */
  async list(): Promise<Entry[]> {
    const entries: Entry[] = []
    const walk = async (dir: string): Promise<void> => {
      for (const item of await readdir(path.join(this.root, dir), { withFileTypes: true })) {
        if (item.name.startsWith('.')) continue
        const rel = dir ? `${dir}/${item.name}` : item.name
        if (item.isDirectory()) {
          entries.push({ path: rel, type: 'dir' })
          await walk(rel)
        } else if (item.isFile() && rel.endsWith('.md')) {
          entries.push({ path: rel, type: 'file' })
        }
      }
    }
    await walk('')
    return entries
  }

  async read(rel: string): Promise<string> {
    return readFile(this.resolve(rel), 'utf8')
  }

  /** Like `read`, but a missing file is `null` rather than an error. */
  async readIfExists(rel: string): Promise<string | null> {
    return this.read(rel).catch((error) => {
      if (hasCode(error, 'ENOENT')) return null
      throw error
    })
  }

  async readBytes(rel: string): Promise<Buffer<ArrayBuffer>> {
    return readFile(this.resolve(rel))
  }

  async write(rel: string, content: string): Promise<void> {
    const abs = this.resolve(rel)
    await mkdir(path.dirname(abs), { recursive: true })
    await writeFile(abs, content)
  }

  async create(rel: string, type: Entry['type']): Promise<void> {
    const abs = this.resolve(rel)
    if (await exists(abs)) throw new HttpError(409, `Already exists: ${rel}`)
    if (type === 'dir') {
      await mkdir(abs, { recursive: true })
    } else {
      await mkdir(path.dirname(abs), { recursive: true })
      await writeFile(abs, '', { flag: 'wx' })
    }
  }

  async move(from: string, to: string): Promise<void> {
    const source = this.resolve(from)
    const target = this.resolve(to)
    if (await exists(target)) throw new HttpError(409, `Already exists: ${to}`)
    await mkdir(path.dirname(target), { recursive: true })
    await rename(source, target)
  }

  /** Deleting moves the entry to `.galena/trash`, so it can be recovered by hand. */
  async remove(rel: string): Promise<void> {
    const abs = this.resolve(rel)
    await rename(abs, await this.trashPath(path.basename(abs)))
  }

  /** A new place in `.galena/trash` for something called `name`. */
  async trashPath(name: string): Promise<string> {
    const trash = path.join(this.configDir, 'trash')
    await mkdir(trash, { recursive: true })
    return path.join(trash, `${Date.now()}-${name}`)
  }
}
