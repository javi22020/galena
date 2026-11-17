import { rm } from 'node:fs/promises'
import path from 'node:path'
import { watch, type FSWatcher } from 'chokidar'
import { codeFonts, textFonts } from '../shared/fonts'
import { defaultSettings, type ServerEvent, type Settings } from '../shared/types'
import { Git } from './git'
import { imageType } from './images'
import { NoteIndex } from './notes'
import { Sessions } from './sessions'
import { readJson, writeJson } from './util'
import { Vault } from './vault'

export type Broadcast = (event: ServerEvent) => void

/** Everything that lives while a vault is open. */
export class Workspace {
  readonly index: NoteIndex
  readonly sessions: Sessions
  readonly git: Git
  settings = defaultSettings
  private watcher?: FSWatcher
  private settingsFile: string

  private constructor(
    readonly vault: Vault,
    readonly broadcast: Broadcast,
  ) {
    this.index = new NoteIndex(vault)
    this.sessions = new Sessions(this)
    this.git = new Git(this)
    this.settingsFile = path.join(vault.configDir, 'config.json')
  }

  static async open(dir: string, broadcast: Broadcast): Promise<Workspace> {
    const workspace = new Workspace(await Vault.open(dir), broadcast)
    workspace.settings = normalize(await readJson(workspace.settingsFile, {}))
    await Promise.all([workspace.index.build(), workspace.sessions.load()])
    // Where agent writes used to wait for review, with the notes as they were before.
    // Left behind if it cannot be deleted (locked, say): nothing reads it any more.
    await rm(path.join(workspace.vault.configDir, 'changes.json'), { force: true }).catch(() => {})
    // Not the Git status: the browser asks for it as soon as the vault is open,
    // and every Git action reads it afresh anyway.
    workspace.watch()
    return workspace
  }

  async close(): Promise<void> {
    await Promise.all([this.watcher?.close(), this.sessions.close(), this.git.close()])
  }

  async saveSettings(settings: unknown): Promise<Settings> {
    const previous = this.settings
    this.settings = normalize(settings)
    await writeJson(this.settingsFile, this.settings)
    this.git.schedule() // which repository to use, and what to keep out of it, are settings
    // A new launch command applies at once; a disabled agent keeps running for its chats.
    for (const [id, agent] of Object.entries(this.settings.agents)) {
      if (agent.command !== previous.agents[id]?.command) this.sessions.restart(id)
    }
    return this.settings
  }

  /** Keeps the index in sync with the disk and tells the browser about changes. */
  private watch(): void {
    const { root } = this.vault
    // Hidden files are not notes, but a `.gitignore` changes what the Git tab
    // lists. Called for folders too, so `.git` and `.galena` stay out whole.
    const hidden = (abs: string) => {
      const parts = path.relative(root, abs).split(path.sep)
      return parts.some((s, i) => s.startsWith('.') && !(s === '.gitignore' && i === parts.length - 1))
    }
    // Events are handled one at a time so the index never applies them out of order.
    let queue = Promise.resolve()

    this.watcher = watch(root, { ignored: hidden, ignoreInitial: true, followSymlinks: false })
    this.watcher.on('all', (event, abs) => {
      if (event === 'all' || event === 'ready' || event === 'raw' || event === 'error') return
      this.git.schedule()
      if (path.basename(abs) === '.gitignore') return // a hidden path, which the vault refuses
      const rel = this.vault.relative(abs)
      const isDir = event === 'addDir' || event === 'unlinkDir'
      const isNote = !isDir && rel.endsWith('.md')
      // Images are not indexed, but the explorer lists them.
      if (!isDir && !isNote && !imageType(rel)) return
      queue = queue
        .then(async () => {
          if (event === 'unlink') this.index.remove(rel)
          else if (isNote) await this.index.update(rel)
          this.broadcast({ type: 'fs', event, path: rel })
        })
        .catch((error) => console.error(`Could not index ${rel}:`, error))
    })
    this.watcher.on('error', (error) => console.error('File watcher error:', error))
  }
}

/** Fills in defaults and drops anything malformed from stored or submitted settings. */
function normalize(input: unknown): Settings {
  const raw = (input ?? {}) as Partial<Settings>
  const agents: Settings['agents'] = {}
  for (const [id, agent] of Object.entries(raw.agents ?? defaultSettings.agents)) {
    const command = typeof agent?.command === 'string' ? agent.command.trim() : ''
    agents[id] = command ? { command } : {}
  }
  const fontSize = Number(raw.editor?.fontSize) || defaultSettings.editor.fontSize
  const fonts = { ...defaultSettings.editor.fonts, ...raw.editor?.fonts }
  const fallback = defaultSettings.editor.fonts
  return {
    agents,
    editor: {
      fontSize: Math.min(28, Math.max(10, fontSize)),
      lineWrap: raw.editor?.lineWrap !== false,
      fonts: {
        heading: Object.hasOwn(textFonts, fonts.heading) ? fonts.heading : fallback.heading,
        text: Object.hasOwn(textFonts, fonts.text) ? fonts.text : fallback.text,
        code: Object.hasOwn(codeFonts, fonts.code) ? fonts.code : fallback.code,
      },
    },
    git: {
      excludeGalena: raw.git?.excludeGalena !== false,
      parentRepo: raw.git?.parentRepo === true,
    },
  }
}
