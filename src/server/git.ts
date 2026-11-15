import { spawn } from 'node:child_process'
import { copyFile, mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { watch, type FSWatcher } from 'chokidar'
import type { GitConflict, GitDiff, GitFile, GitResolution, GitStatus } from '../shared/types'
import { defaultMessage, excludeRules, failureText, isSafeRemote, parseStatus } from './git-status'
import { errorMessage, exists, hasCode, HttpError } from './util'
import type { Workspace } from './workspace'

/** Where the repository of a vault is. */
interface Repo {
  /** Top folder of the working tree. */
  root: string
  /** The `.git` folder of this working tree. */
  dir: string
  /** Where refs and `info/exclude` live; not `dir` in a linked worktree. */
  common: string
  /** The vault's place inside the working tree: empty, or `notes/`. */
  prefix: string
}

interface Output {
  code: number
  stdout: Buffer
  stderr: string
}

const NO_REPO = {
  branch: null,
  upstream: null,
  ahead: 0,
  behind: 0,
  remote: null,
  tracksGalena: false,
  files: [],
} satisfies Partial<GitStatus>

/** How long a git command may take. A slow push fits; one that waits for a person does not. */
const TIMEOUT = 120_000
const REFRESH_MS = 300
/** What Git leaves in its folder while an operation it cannot finish alone is under way. */
const UNFINISHED = ['rebase-merge', 'rebase-apply', 'CHERRY_PICK_HEAD', 'REVERT_HEAD', 'BISECT_LOG']
/**
 * How the status is asked for: every untracked file by name, and a submodule
 * only when it moved to another commit. Files changed inside one are its own
 * business; listed here, they would be a change that committing cannot take.
 *
 * Without the optional locks git does not refresh its index while it looks,
 * which would wake up the watcher of `.git` and start this over.
 */
const STATUS = [
  '--no-optional-locks',
  'status',
  '--porcelain=v2',
  '-z',
  '--branch',
  '--untracked-files=all',
  '--ignore-submodules=dirty',
]
/**
 * The entries of `.git` that move when the status does: the branch, the index,
 * the refs, what a fetch or a merge leaves. Nothing else is watched. Much of
 * the rest is noise, and some of it is written by the very act of asking for
 * the status (a file-system monitor keeps its own files there), which would
 * have the watcher asking again without end.
 */
const WATCHED = new Set([
  'HEAD',
  'index',
  'config',
  'refs',
  'reftable',
  'packed-refs',
  'FETCH_HEAD',
  'ORIG_HEAD',
  'MERGE_HEAD',
  ...UNFINISHED,
])

/**
 * The Git repository of a vault, driven through the `git` on the PATH: that
 * way pushing and pulling use the credentials, SSH keys and hooks the user
 * already has, and Galena stores none.
 *
 * Changes are committed whole (there is no staging of single files) and only
 * from inside the vault, even when the repository is larger than it.
 */
export class Git {
  private status: GitStatus = { ...NO_REPO, state: 'none' }
  private repo: Repo | null = null
  private watcher?: FSWatcher
  /** The folders `watcher` looks at, to tell when the repository moved. */
  private watched = ''
  /** The repository and the setting that `.git/info/exclude` was last brought in line with. */
  private excluded = ''
  private timer?: NodeJS.Timeout
  private queue: Promise<unknown> = Promise.resolve()
  /** A refresh that is waiting for its turn. */
  private queued?: Promise<GitStatus>
  private closed = false

  constructor(private workspace: Workspace) {}

  /** An action under way is left to finish, but no longer reports to the browser. */
  async close(): Promise<void> {
    this.closed = true
    clearTimeout(this.timer)
    await this.watcher?.close()
  }

  /** Looks at the repository again, and tells the browser if anything changed. */
  refresh(): Promise<GitStatus> {
    // Asked for again before its turn comes (behind a slow push, say), the
    // refresh already waiting is as fresh as another one would be.
    this.queued ??= this.serial(() => {
      this.queued = undefined
      return this.update()
    })
    return this.queued
  }

  /** Refreshes once things settle; called for every change on disk. */
  schedule(): void {
    if (this.closed) return
    clearTimeout(this.timer)
    this.timer = setTimeout(() => {
      this.refresh().catch((error) => console.error('Could not refresh the Git status:', error))
    }, REFRESH_MS)
  }

  // Reading

  async diff(rel: string): Promise<GitDiff> {
    const file = this.file(rel)
    const [before, after] = await Promise.all([
      // A file that is not in the last commit after all just shows as new.
      file.status === 'added' ? null : this.blob(`HEAD:./${file.from ?? file.path}`).catch(() => null),
      file.status === 'deleted' ? null : readFile(this.resolve(file.path)).catch(() => null),
    ])
    const binary = isBinary(before) || isBinary(after)
    return {
      before: binary ? null : (before?.toString() ?? null),
      after: binary ? null : (after?.toString() ?? null),
      binary,
    }
  }

  /**
   * Both sides of a conflicted file. Git's merge is run again twice, settling
   * every conflict one way and then the other, so the two results differ only
   * where the conflicts are: whatever merged cleanly is in both.
   */
  async conflict(rel: string): Promise<GitConflict> {
    const { path: file } = this.file(rel, 'conflict')
    const kept = await this.stages(file)
    const stage = (number: number) => (kept.has(number) ? this.blob(`:${number}:./${file}`) : null)
    const [base, ours, theirs] = await Promise.all([stage(1), stage(2), stage(3)])
    const whole = { binary: false, settled: false }
    if (isBinary(ours) || isBinary(theirs)) return { ...whole, local: null, incoming: null, binary: true }
    if (!ours || !theirs) {
      return { ...whole, local: ours?.toString() ?? null, incoming: theirs?.toString() ?? null }
    }
    // Git leaves markers around each conflict in the file itself. One without
    // them has been settled already, in the editor or anywhere else.
    const disk = await readFile(this.resolve(file), 'utf8').catch(() => null)
    const settled = disk !== null && !/^<{7}( |$)/m.test(disk)

    const dir = await mkdtemp(path.join(tmpdir(), 'galena-merge-'))
    try {
      await Promise.all([
        writeFile(path.join(dir, 'base'), base ?? ''),
        writeFile(path.join(dir, 'ours'), ours),
        writeFile(path.join(dir, 'theirs'), theirs),
      ])
      const favouring = async (side: '--ours' | '--theirs') => {
        const result = await run(dir, ['merge-file', '-p', side, 'ours', 'base', 'theirs'])
        if (result.code !== 0) throw new HttpError(409, failureText('merge-file', result.stderr))
        return result.stdout.toString()
      }
      return { local: await favouring('--ours'), incoming: await favouring('--theirs'), binary: false, settled }
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  }

  // Setting up

  init(): Promise<GitStatus> {
    return this.change(async () => {
      if (this.status.state !== 'none') throw new HttpError(409, 'The vault is already in a repository')
      await this.git(['init', '-q'])
    })
  }

  addRemote(url: string): Promise<GitStatus> {
    return this.change(async () => {
      this.require('ready')
      if (this.status.remote) throw new HttpError(409, 'The repository already has a remote')
      if (!isSafeRemote(url)) throw new HttpError(400, `Not a remote address: ${url}`)
      await this.git(['remote', 'add', 'origin', url])
    })
  }

  /** Takes `.galena/` out of the repository, leaving the files where they are. */
  untrackGalena(): Promise<GitStatus> {
    return this.change(async () => {
      this.require('ready')
      await this.git(['rm', '-r', '-q', '--cached', '--', '.galena'])
    })
  }

  // Committing and syncing

  commit(message: string): Promise<GitStatus> {
    return this.change(async () => {
      this.require('ready')
      await this.commitAll(message)
    })
  }

  /** Commits what changed, merges what the remote has, and pushes the result. */
  sync(message: string): Promise<GitStatus> {
    return this.change(async () => {
      this.require('ready')
      if (this.status.files.length) await this.commitAll(message)
      if (!this.status.remote) return
      await this.fetchRemote()
      const tracking = await this.track()
      // A merge that stops at conflicts is finished by the user, who then syncs again.
      if (tracking && (await this.merge())) return
      await this.pushCommits(tracking)
    })
  }

  fetch(): Promise<GitStatus> {
    return this.change(async () => {
      this.require('ready')
      await this.fetchRemote()
    })
  }

  pull(): Promise<GitStatus> {
    return this.change(async () => {
      this.require('ready')
      await this.fetchRemote()
      if (!(await this.track())) throw new HttpError(409, 'The remote does not have this branch yet')
      await this.merge()
    })
  }

  push(): Promise<GitStatus> {
    return this.change(async () => {
      this.require('ready')
      await this.pushCommits(this.status.upstream !== null)
    })
  }

  /** Takes files back to their last commit, keeping what they had in `.galena/trash`. */
  discard(paths: string[]): Promise<GitStatus> {
    return this.change(async () => {
      this.require('ready')
      const files = paths.map((rel) => this.file(rel))
      if (files.some((file) => file.status === 'conflict')) {
        throw new HttpError(409, 'Resolve the conflict instead of discarding it')
      }
      const committed: string[] = []
      for (const [index, file] of files.entries()) {
        const abs = this.resolve(file.path)
        // The index keeps two files of the same name, discarded together, apart.
        const kept = await this.workspace.vault.trashPath(`${index}-${path.basename(abs)}`)
        if (file.status === 'added') {
          // Never committed: all there is to do is to forget the file and move it away.
          await this.git(['rm', '-q', '--cached', '--ignore-unmatch', '--', file.path])
          await rename(abs, kept).catch(ignoreMissing)
        } else {
          await copyFile(abs, kept).catch(ignoreMissing)
          committed.push(file.path, ...(file.from ? [file.from] : []))
        }
      }
      if (committed.length) {
        await this.git(['restore', '--source=HEAD', '--staged', '--worktree', '--', ...committed])
      }
    })
  }

  // Conflicts

  resolveConflict(rel: string, resolution: GitResolution): Promise<GitStatus> {
    return this.change(async () => {
      // Conflicts come from a merge, or from a stash popped onto changes, which
      // leaves no merge under way. In a rebase, a cherry-pick or a revert,
      // "ours" and "theirs" swap, so "local" would keep the incoming side.
      if (this.status.state !== 'ready') this.require('merging')
      const { path: file } = this.file(rel, 'conflict')
      if ('content' in resolution) {
        const abs = this.resolve(file)
        await mkdir(path.dirname(abs), { recursive: true })
        await writeFile(abs, resolution.content)
      } else if (resolution.side !== 'disk') {
        const local = resolution.side === 'local'
        if (!(await this.stages(file)).has(local ? 2 : 3)) {
          // That side deleted the file, so keeping it means deleting it.
          await this.git(['rm', '-q', '-f', '--ignore-unmatch', '--', file])
          return
        }
        await this.git(['checkout', local ? '--ours' : '--theirs', '--', file])
      }
      await this.git(['add', '--', file])
    })
  }

  abortMerge(): Promise<GitStatus> {
    return this.change(async () => {
      this.require('merging')
      await this.git(['merge', '--abort'])
    })
  }

  /** Commits a merge whose conflicts are all resolved. */
  finishMerge(): Promise<GitStatus> {
    return this.change(async () => {
      this.require('merging')
      if (this.status.files.some((file) => file.status === 'conflict')) {
        throw new HttpError(409, 'Some conflicts are not resolved yet')
      }
      await this.git(['commit', '-q', '--no-edit'])
    })
  }

  // Steps shared by the operations above

  private async commitAll(message: string): Promise<void> {
    const { files } = this.status
    if (!files.length) throw new HttpError(409, 'There is nothing to commit')
    if (files.some((file) => file.status === 'conflict')) {
      throw new HttpError(409, 'Resolve the conflicts first')
    }
    // What changed in the files git knows, then the new files by name. Adding
    // the folder as a whole would trip over a repository nested in the vault,
    // which git reports as untracked but refuses to add.
    const added = files.filter((file) => file.status === 'added').map((file) => file.path)
    if (added.length < files.length) await this.git(['add', '-u', '--', '.'])
    if (added.length) {
      await this.git(['add', '--pathspec-from-file=-', '--pathspec-file-nul'], added.join('\0'))
    }
    const text = message.trim() || defaultMessage(files)
    // In a repository larger than the vault, whatever is staged outside it
    // stays out. Not with `git commit -- .`, which commits the files as they
    // are on disk and so would put back the ones taken out of the index, as
    // "Stop tracking" does with `.galena/`: the commit is made from a copy of
    // the index without them, and they stay staged in the real one.
    const outside = await this.outsideVault(['diff', '--cached', '--name-only'])
    if (!outside.length) {
      await this.git(['commit', '-q', '-F', '-'], text)
      return
    }
    const { dir: gitDir, prefix } = this.repo!
    const dir = await mkdtemp(path.join(tmpdir(), 'galena-index-'))
    try {
      const env = { GIT_INDEX_FILE: path.join(dir, 'index') }
      await copyFile(path.join(gitDir, 'index'), env.GIT_INDEX_FILE)
      // Paths from the top of the working tree, as `--no-relative` gives them,
      // made relative to the vault, where git runs.
      const up = '../'.repeat(prefix.split('/').filter(Boolean).length)
      const paths = outside.map((file) => up + file).join('\0')
      await this.git(['reset', '-q', '--pathspec-from-file=-', '--pathspec-file-nul'], paths, env)
      await this.git(['commit', '-q', '-F', '-'], text, env)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  }

  private async fetchRemote(): Promise<void> {
    const remote = this.remote()
    // Left to itself, git fetches from wherever the branch's upstream is.
    const args = this.status.upstream ? ['fetch', '-q'] : ['fetch', '-q', remote]
    await this.git(args)
  }

  /**
   * Whether the branch has an upstream to merge from, as of the fetch just
   * made. One without it starts following its namesake on the remote, if there
   * is one: the case of a remote added to a repository that had none.
   */
  private async track(): Promise<boolean> {
    if (this.status.upstream) return true
    const remote = this.remote()
    const branch = this.branch()
    if (await this.hasRef(`refs/remotes/${remote}/${branch}`)) {
      await this.git(['branch', '-q', `--set-upstream-to=${remote}/${branch}`])
      return true
    }
    // A branch the remote lacks is published by the push, as long as it comes
    // from what the remote has. Notes started apart from it under another
    // name (`master` here, `main` there) would end up as a second, unrelated
    // branch, which is never what was meant.
    const heads = `refs/remotes/${remote}/`
    const listed = await this.git(['for-each-ref', '--format=%(refname)', heads])
    const others = listed.split('\n').filter((ref) => ref && ref !== `${heads}HEAD`)
    if (others.length && !(await this.related(others))) {
      const names = others.map((ref) => ref.slice(heads.length)).join(', ')
      throw new HttpError(
        409,
        `The remote has no branch named ${branch}, and what it has (${names}) shares no history with ` +
          'yours. Rename yours to match with "git branch -m <name>", then sync again',
      )
    }
    return false
  }

  /**
   * Merges what the upstream branch has, as of the last fetch. Returns true if
   * that left conflicts for the user to resolve. Merging rather than rebasing
   * means they are asked once, and "ours" and "theirs" keep their meaning.
   */
  private async merge(): Promise<boolean> {
    if (!(await this.related(['@{upstream}']))) {
      throw new HttpError(
        409,
        'Your notes and the remote have separate histories. To join them, run "git pull --no-rebase ' +
          '--allow-unrelated-histories" in the vault once, then sync again',
      )
    }
    const result = await run(this.cwd, ['merge', '-q', '--ff', '--no-edit', '@{upstream}'])
    if (result.code === 0) return false
    if (!this.repo || !(await exists(path.join(this.repo.dir, 'MERGE_HEAD')))) {
      throw new HttpError(409, failureText('merge', result.stderr, result.stdout.toString()))
    }
    // Galena cannot open files outside the vault, let alone merge them.
    if ((await this.outsideVault(['diff', '--name-only', '--diff-filter=U'])).length) {
      await this.git(['merge', '--abort'])
      throw new HttpError(409, 'The merge has conflicts outside the vault; pull from a terminal instead')
    }
    return true
  }

  /** Pushes the branch to its upstream, or publishes it on the remote if it has none. */
  private async pushCommits(tracking: boolean): Promise<void> {
    this.branch() // a detached HEAD has nowhere to push to
    const args = tracking ? ['push', '-q'] : ['push', '-q', '-u', this.remote(), 'HEAD']
    await this.git(args)
  }

  /** Whether the branch has a commit in common with any of the given ones. */
  private async related(refs: string[]): Promise<boolean> {
    // A branch with no commits yet takes whatever it is given.
    if (!(await this.hasRef('HEAD'))) return true
    for (const ref of refs) {
      if ((await run(this.cwd, ['merge-base', 'HEAD', ref])).code === 0) return true
    }
    return false
  }

  /** Of the paths a git command lists, the ones outside the vault, if it is in a larger repository. */
  private async outsideVault(list: string[]): Promise<string[]> {
    const prefix = this.repo?.prefix
    if (!prefix) return []
    // From the top of the working tree, so that those outside the vault are listed too.
    const listed = await this.git([...list, '--no-relative', '-z'])
    return listed.split('\0').filter((file) => file && !file.startsWith(prefix))
  }

  private async hasRef(ref: string): Promise<boolean> {
    return (await run(this.cwd, ['rev-parse', '-q', '--verify', ref])).code === 0
  }

  private remote(): string {
    if (!this.status.remote) throw new HttpError(409, 'The repository has no remote')
    return this.status.remote
  }

  private branch(): string {
    if (!this.status.branch) throw new HttpError(409, 'No branch is checked out (detached HEAD)')
    return this.status.branch
  }

  private require(state: GitStatus['state']): void {
    if (this.status.state === state) return
    const reasons: Record<GitStatus['state'], string> = {
      unavailable: 'Git is not installed',
      none: 'The vault is not a Git repository',
      parent: 'The vault is inside a repository that Galena was not told to use',
      ready: 'No merge is in progress',
      merging: 'Finish or abort the merge first',
      busy: 'Another Git operation is in progress; finish it in a terminal',
      error: this.status.message ?? 'Git could not read the repository',
    }
    throw new HttpError(409, reasons[this.status.state])
  }

  /** The changed file at a path the browser sent; nothing else can be touched. */
  private file(rel: string, status?: GitFile['status']): GitFile {
    const file = this.status.files.find((candidate) => candidate.path === rel)
    if (!file || (status && file.status !== status)) throw new HttpError(404, `Not a changed file: ${rel}`)
    return file
  }

  private resolve(rel: string): string {
    const abs = path.resolve(this.cwd, rel)
    const inside = path.relative(this.cwd, abs)
    if (!inside || inside.startsWith('..') || path.isAbsolute(inside)) {
      throw new HttpError(403, `Outside the vault: ${rel}`)
    }
    return abs
  }

  // Status

  /** Runs a change on the freshest status, one at a time, and reports the status it leaves. */
  private change(task: () => Promise<void>): Promise<GitStatus> {
    return this.serial(async () => {
      await this.update()
      try {
        await task()
      } finally {
        await this.update()
      }
      return this.status
    })
  }

  private async update(): Promise<GitStatus> {
    // Whatever keeps git from reading the repository is a status too: it is
    // shown where the changes would be, rather than failing whoever asked.
    const status = await this.read().catch((error): GitStatus => {
      if (!(error instanceof HttpError)) console.error('Could not read the Git status:', error)
      return { ...NO_REPO, state: 'error', message: errorMessage(error) }
    })
    // Another vault may be open by now, and the browser showing that one.
    if (this.closed) return status
    await this.watch()
    if (JSON.stringify(status) !== JSON.stringify(this.status)) {
      this.status = status
      this.workspace.broadcast({ type: 'git', status })
    }
    return status
  }

  private async read(): Promise<GitStatus> {
    this.repo = null
    const repo = await this.locate()
    if (repo === 'unavailable') return { ...NO_REPO, state: 'unavailable' }
    if (!repo) return { ...NO_REPO, state: 'none' }
    const { git: settings } = this.workspace.settings
    if (repo.prefix && !settings.parentRepo) return { ...NO_REPO, state: 'parent', root: repo.root }
    this.repo = repo

    // Once for each repository and each time the setting changes, rather than
    // on every look: a rule the user takes out by hand meanwhile stays out.
    const excluding = `${repo.common}\n${settings.excludeGalena}`
    if (excluding !== this.excluded) {
      this.excluded = excluding
      // Not being able to write the rule is no reason to show no status at all.
      await this.exclude(repo, settings.excludeGalena).catch((error) => {
        console.error('Could not update .git/info/exclude:', error)
      })
    }
    const [status, remotes, tracked, merging, unfinished] = await Promise.all([
      this.git([...STATUS, '--', '.']),
      this.git(['remote']),
      settings.excludeGalena ? this.git(['ls-files', '--', '.galena']) : '',
      exists(path.join(repo.dir, 'MERGE_HEAD')),
      Promise.all(UNFINISHED.map((name) => exists(path.join(repo.dir, name)))),
    ])
    const names = remotes.split('\n').filter(Boolean)
    return {
      ...parseStatus(status, repo.prefix),
      state: unfinished.some(Boolean) ? 'busy' : merging ? 'merging' : 'ready',
      ...(repo.prefix ? { root: repo.root } : {}),
      remote: names.includes('origin') ? 'origin' : (names[0] ?? null),
      tracksGalena: tracked.trim() !== '',
    }
  }

  private async locate(): Promise<Repo | 'unavailable' | null> {
    const args = ['rev-parse', '--show-toplevel', '--absolute-git-dir', '--git-common-dir', '--show-prefix']
    const result = await run(this.cwd, args).catch((error) => {
      if (hasCode(error, 'ENOENT')) return 'unavailable' as const
      throw error
    })
    if (result === 'unavailable') return result
    if (result.code !== 0) {
      // Failing is how git says that there is no repository, but also that it
      // will not read the one there is (owned by someone else, damaged...).
      if (!(await hasRepository(this.cwd))) return null
      throw new HttpError(409, failureText('rev-parse', result.stderr))
    }
    const [root = '', dir = '', common = '', prefix = ''] = result.stdout.toString().split('\n')
    return {
      root: path.resolve(root),
      dir: path.resolve(dir),
      // The only one git may give relative to where it ran.
      common: path.resolve(this.cwd, common),
      prefix,
    }
  }

  /** Keeps `.galena/` out of the repository, or only its trash, as the settings say. */
  private async exclude(repo: Repo, everything: boolean): Promise<void> {
    // A rule here works like one in `.gitignore`, but is not itself a file to commit.
    const file = path.join(repo.common, 'info', 'exclude')
    // Only a missing file is an empty one: anything else read as empty would be
    // written back without the rules the user has there.
    const current = await readFile(file, 'utf8').catch((error) => {
      ignoreMissing(error)
      return ''
    })
    const wanted = excludeRules(current, everything)
    if (wanted === current) return
    await mkdir(path.dirname(file), { recursive: true })
    await writeFile(file, wanted)
  }

  /**
   * Watches `.git` for what a terminal does to it: a commit, another branch, a
   * fetch. File events are not dependable everywhere (network drives, for
   * one), so the browser also asks again when it regains the focus.
   */
  private async watch(): Promise<void> {
    const dirs = this.repo ? [...new Set([this.repo.dir, this.repo.common])] : []
    const key = dirs.join('\n')
    if (key === this.watched) return
    this.watched = key
    await this.watcher?.close()
    this.watcher = undefined
    // Closed while the old watcher was closing: a new one would never be.
    if (this.closed) return
    if (!dirs.length) return
    // A path is watched if it is one of the folders or, in one of them, under
    // an entry that matters. Lock files only say that git is at work.
    const watched = (abs: string) =>
      dirs.some((dir) => {
        const [entry = ''] = path.relative(dir, abs).split(path.sep)
        return entry === '' || WATCHED.has(entry)
      })
    const ignored = (abs: string) => abs.endsWith('.lock') || !watched(abs)
    this.watcher = watch(dirs, { ignored, ignoreInitial: true, followSymlinks: false })
    this.watcher.on('all', () => this.schedule())
    this.watcher.on('error', (error) => console.error('Git watcher error:', error))
  }

  // Running git

  private get cwd(): string {
    return this.workspace.vault.root
  }

  /** Runs git in the vault and returns what it printed; a failure is an error for the user. */
  private async git(args: string[], input?: string, env?: NodeJS.ProcessEnv): Promise<string> {
    const result = await run(this.cwd, args, input, env)
    if (result.code === 0) return result.stdout.toString()
    throw new HttpError(409, failureText(commandOf(args), result.stderr, result.stdout.toString()))
  }

  /** A file as a commit or the index has it: `HEAD:./a.md`, `:2:./a.md`. */
  private async blob(object: string): Promise<Buffer> {
    const result = await run(this.cwd, ['show', object])
    if (result.code === 0) return result.stdout
    throw new HttpError(409, failureText('show', result.stderr))
  }

  /**
   * Which versions of a conflicted file the index keeps: 1 is the common
   * ancestor, 2 this branch's, 3 the incoming one. A side that deleted the file
   * has none, which only this tells apart from failing to read it.
   */
  private async stages(file: string): Promise<Set<number>> {
    // One record for each: `<mode> <object> <stage>`, a tab and the path.
    const records = (await this.git(['ls-files', '-u', '-z', '--', file])).split('\0')
    return new Set(records.filter(Boolean).map((record) => Number(record.split('\t')[0]!.split(' ')[2])))
  }

  /** Runs tasks one at a time: two git commands at once would fight over the index. */
  private serial<T>(task: () => Promise<T>): Promise<T> {
    const result = this.queue.then(task)
    this.queue = result.catch(() => {})
    return result
  }
}

/**
 * What every git is started with. It must not ask for credentials on the
 * terminal Galena was started from, where nobody is looking, and it takes
 * paths literally rather than as patterns.
 */
const ENV: NodeJS.ProcessEnv = { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_LITERAL_PATHSPECS: '1' }
// Set by a hook or a wrapper Galena was started from, these would send every
// command to some other repository than the vault's.
for (const name of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE']) delete ENV[name]

/**
 * Runs git and collects its output. Exiting with an error is a result like
 * any other; only failing to start, or to finish in time, rejects.
 *
 * Arguments are never read by a shell, and paths are passed after `--`.
 * Git can still end up waiting for someone: ssh asking for a passphrase, a
 * hook, a signing key. Since the commands run one at a time, the one that
 * waits is ended after a while rather than left to hold up all the others.
 */
function run(cwd: string, args: string[], input?: string, env?: NodeJS.ProcessEnv): Promise<Output> {
  return new Promise((resolve, reject) => {
    const proc = spawn('git', args, {
      cwd,
      env: env ? { ...ENV, ...env } : ENV,
      stdio: [input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'],
      windowsHide: true,
    })
    const stdout: Buffer[] = []
    let stderr = ''
    // Rejects without waiting for the process to close: what it was waiting
    // for (a hook, ssh) can outlive it, and keeps its output open meanwhile.
    const timer = setTimeout(() => {
      proc.kill()
      const hint = 'if it needs a password or a passphrase, run it once in a terminal'
      reject(new HttpError(502, `git ${commandOf(args)} did not finish in time; ${hint}`))
    }, TIMEOUT)
    proc.stdout!.on('data', (chunk: Buffer) => stdout.push(chunk))
    proc.stderr!.on('data', (chunk) => (stderr += chunk))
    proc.once('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
    proc.once('close', (code) => {
      clearTimeout(timer)
      resolve({ code: code ?? 1, stdout: Buffer.concat(stdout), stderr })
    })
    proc.stdin?.on('error', () => {}) // git may exit without reading it
    proc.stdin?.end(input)
  })
}

/** `status` for `['--no-optional-locks', 'status', ...]`: the command among its options. */
function commandOf(args: string[]): string {
  return args.find((arg) => !arg.startsWith('-')) ?? 'command'
}

/** Text never has a zero byte in it; this is how Git itself tells. */
function isBinary(content: Buffer | null): boolean {
  return !!content && content.subarray(0, 8000).includes(0)
}

/** Whether the folder or one above it has a `.git`, which is where git looks for a repository. */
async function hasRepository(dir: string): Promise<boolean> {
  if (await exists(path.join(dir, '.git'))) return true
  const parent = path.dirname(dir)
  return parent !== dir && hasRepository(parent)
}

function ignoreMissing(error: unknown): void {
  if (!hasCode(error, 'ENOENT')) throw error
}
