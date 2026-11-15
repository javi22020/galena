// The parts of the Git integration that only transform text.

import type { GitFile } from '../shared/types'

export interface ParsedStatus {
  branch: string | null
  upstream: string | null
  ahead: number
  behind: number
  files: GitFile[]
}

/**
 * Reads the output of `git status --porcelain=v2 -z --branch`. Git reports
 * paths from the top of the repository; `prefix` is where the vault is inside
 * it (`notes/`, or empty), and only files under it are kept, relative to it.
 */
export function parseStatus(output: string, prefix = ''): ParsedStatus {
  const status: ParsedStatus = {
    branch: null,
    upstream: null,
    ahead: 0,
    behind: 0,
    files: [],
  }
  // Set once git has compared the branch with its upstream.
  let compared = false
  const inVault = (path: string) => (path.startsWith(prefix) ? path.slice(prefix.length) : null)
  const add = (file: string, kind: GitFile['status'], origin?: string) => {
    const path = inVault(file)
    if (path === null) return
    const from = origin === undefined ? null : inVault(origin)
    // A file renamed into the vault from outside it is, for the vault, a new one.
    if (kind === 'renamed' && from === null) status.files.push({ path, status: 'added' })
    else status.files.push(from === null ? { path, status: kind } : { path, status: kind, from })
  }

  const records = output.split('\0')
  for (let i = 0; i < records.length; i++) {
    const record = records[i]!
    const fields = record.split(' ')
    // Paths may contain spaces, so they are whatever follows the fixed fields.
    const pathAfter = (count: number) => fields.slice(count).join(' ')
    switch (fields[0]) {
      case '#':
        if (fields[1] === 'branch.head') status.branch = fields[2] === '(detached)' ? null : pathAfter(2)
        if (fields[1] === 'branch.upstream') status.upstream = pathAfter(2)
        if (fields[1] === 'branch.ab') {
          compared = true
          status.ahead = Number(fields[2]?.slice(1)) || 0
          status.behind = Number(fields[3]?.slice(1)) || 0
        }
        break
      case '1':
        add(pathAfter(8), kindOf(fields[1]!))
        break
      case '2': {
        // A rename or a copy; where it came from is the next record.
        const origin = records[++i]
        // The original of a copy is still in its place, so the copy is just a new file.
        if (fields[8]!.startsWith('C')) add(pathAfter(9), 'added')
        else add(pathAfter(9), fields[1]!.includes('D') ? 'deleted' : 'renamed', origin)
        break
      }
      case 'u':
        add(pathAfter(10), 'conflict')
        break
      case '?':
        // Untracked files come one by one. A folder as such is a repository
        // of its own inside the vault, which is not for this one to commit.
        if (!record.endsWith('/')) add(record.slice(2), 'added')
    }
  }

  // A branch still names an upstream that was deleted on the remote, or that
  // it has no commits to compare with; neither is there to pull from.
  if (!compared) status.upstream = null

  status.files.sort(
    (a, b) =>
      Number(b.status === 'conflict') - Number(a.status === 'conflict') || a.path.localeCompare(b.path),
  )
  return status
}

/** Galena never stages part of a file, so the index and the worktree count as one. */
function kindOf(xy: string): GitFile['status'] {
  if (xy.includes('D')) return 'deleted'
  return xy.startsWith('A') ? 'added' : 'modified'
}

const NOTE = '# Galena keeps its own data out of the repository'

/**
 * The content of `.git/info/exclude` with Galena's rule in it: all of
 * `.galena/` stays out of the repository or, when the user wants it in, just
 * its trash. Deleted and discarded notes are not for committing, and each one
 * landing there would be a change of its own to commit.
 *
 * Only the two lines Galena writes are ever touched, and a rule of the user's
 * own for `.galena` is left to do the job.
 */
export function excludeRules(content: string, everything: boolean): string {
  const rule = everything ? '.galena/' : '.galena/trash/'
  const eol = content.includes('\r\n') ? '\r\n' : '\n'
  const lines = content.split(/\r?\n/)
  const own = lines.findIndex((line, i) => line === NOTE && lines[i + 1]?.startsWith('.galena/'))
  if (own >= 0 && lines[own + 1] === rule) return content
  if (own >= 0) lines.splice(own, 2)
  const covered = lines.some((line) => /^\/?\.galena\/?$/.test(line.trim()))
  if (covered) return own < 0 ? content : lines.join(eol)
  if (lines.at(-1) === '') lines.pop() // what follows the last line break
  return [...lines, NOTE, rule, ''].join(eol)
}

/**
 * Whether a remote address can be handed to Git: not something it would read
 * as an option, and not a `transport::address` helper, which can run commands.
 */
export function isSafeRemote(url: string): boolean {
  return /^[^-\s]\S*$/.test(url) && !/^[a-z][a-z0-9+.-]*::/i.test(url)
}

/** The commit message used when the user writes none. */
export function defaultMessage(files: GitFile[]): string {
  const [first] = files
  if (files.length !== 1 || !first) {
    const notes = files.every((file) => file.path.endsWith('.md'))
    return `Update ${files.length} ${notes ? 'notes' : 'files'}`
  }
  const verbs = { modified: 'Update', added: 'Add', deleted: 'Delete', renamed: 'Rename', conflict: 'Merge' }
  const name = first.path.slice(first.path.lastIndexOf('/') + 1).replace(/\.md$/i, '')
  return `${verbs[first.status]} ${name}`
}

/** Git's own words about a failed command, short enough for a toast. */
export function failureText(command: string, stderr: string, stdout = ''): string {
  const lines = (stderr.trim() || stdout.trim())
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('hint:'))
  const text = lines.join(' ').replace(/^(fatal|error): /, '')
  if (!text) return `git ${command} failed`
  return text.length > 400 ? `${text.slice(0, 400)}…` : text
}
