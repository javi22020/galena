import { rm } from 'node:fs/promises'
import path from 'node:path'
import type { Change } from '../shared/types'
import { readJson, writeJson } from './util'
import type { Vault } from './vault'

interface Pending {
  /** Content before the agent's first write; null if the file did not exist. */
  before: string | null
  sessionId: string
}

/**
 * Agent writes awaiting review. A write goes straight to disk, so the agent
 * and the editor see the same file; rejecting it restores the original content.
 */
export class Changes {
  private pending = new Map<string, Pending>()
  private file: string
  private queue: Promise<unknown> = Promise.resolve()

  constructor(
    private vault: Vault,
    private onChange: () => void,
  ) {
    this.file = path.join(vault.configDir, 'changes.json')
  }

  async load(): Promise<void> {
    this.pending = new Map(Object.entries(await readJson<Record<string, Pending>>(this.file, {})))
  }

  /** Writes a file on behalf of an agent, remembering what it replaced. */
  write(rel: string, content: string, sessionId: string): Promise<void> {
    return this.serial(async () => {
      if (!this.pending.has(rel)) {
        this.pending.set(rel, { before: await this.vault.readIfExists(rel), sessionId })
        await this.save()
      }
      await this.vault.write(rel, content)
      this.onChange()
    })
  }

  async list(): Promise<Change[]> {
    const changes: Change[] = []
    for (const [rel, { before, sessionId }] of this.pending) {
      const after = await this.vault.readIfExists(rel)
      // Deleted or already back to the original: nothing left to review.
      if (after !== null && after !== before) changes.push({ path: rel, before, after, sessionId })
    }
    return changes
  }

  /** Accepts or rejects the given changes, or all of them. */
  resolve(action: 'accept' | 'reject', paths?: string[]): Promise<void> {
    return this.serial(async () => {
      for (const rel of paths ?? [...this.pending.keys()]) {
        const change = this.pending.get(rel)
        if (!change) continue
        if (action === 'reject') {
          if (change.before === null) await rm(this.vault.resolve(rel), { force: true })
          else await this.vault.write(rel, change.before)
        }
        this.pending.delete(rel)
      }
      await this.save()
      this.onChange()
    })
  }

  private save(): Promise<void> {
    return writeJson(this.file, Object.fromEntries(this.pending))
  }

  /** Runs tasks one at a time, so concurrent writes cannot corrupt `before`. */
  private serial<T>(task: () => Promise<T>): Promise<T> {
    const result = this.queue.then(task)
    this.queue = result.catch(() => {})
    return result
  }
}
