import { mkdir, opendir, readdir, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import path from 'node:path'
import type { FolderListing } from '../shared/types'
import { errorMessage, expandHome, hasCode, HttpError } from './util'

const WINDOWS = process.platform === 'win32'
const byName = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

/**
 * The folders inside `dir`, for choosing a vault. Without `dir` it lists the
 * home folder; on Windows an empty `dir` lists the drives, which sit above
 * every drive's root.
 */
export async function listFolders(dir?: string): Promise<FolderListing> {
  if (WINDOWS && dir === '') return { path: '', parent: null, folders: await drives() }

  let root = expandHome(dir || homedir())
  if (WINDOWS && /^[a-z]:$/i.test(root)) root += path.sep // "C:" alone means the current folder on C
  root = path.resolve(root)

  const items = await readdir(root, { withFileTypes: true }).catch((error) => {
    // Whatever else goes wrong (permissions, an unreachable share) is a dead end, not a crash.
    const missing = hasCode(error, 'ENOENT') || hasCode(error, 'ENOTDIR')
    throw new HttpError(missing ? 400 : 403, `${missing ? 'Not a folder' : 'Cannot read'}: ${root}`)
  })
  const found = await Promise.all(
    items.map(async (item) => {
      if (item.name.startsWith('.')) return null
      const folder = { name: item.name, path: path.join(root, item.name) }
      if (item.isDirectory()) return folder
      // Links count when they lead to a folder that can be opened, which leaves
      // out the legacy junctions Windows keeps in the home folder.
      return item.isSymbolicLink() && (await canOpen(folder.path)) ? folder : null
    }),
  )

  const parent = path.dirname(root)
  return {
    path: root,
    parent: parent !== root ? parent : WINDOWS ? '' : null,
    folders: found.filter((folder) => folder !== null).sort((a, b) => byName.compare(a.name, b.name)),
  }
}

/**
 * Makes the folder `name` inside `parent`, for a new vault, and returns its
 * path. The parent must exist already, and the new folder must not.
 */
export async function createFolder(parent: string, name: string): Promise<string> {
  const clean = name.trim()
  if (!clean || clean === '.' || clean === '..' || /[\\/]/.test(clean)) {
    throw new HttpError(400, `Not a valid folder name: ${name}`)
  }
  const dir = path.join(path.resolve(expandHome(parent)), clean)
  await mkdir(dir).catch((error) => {
    if (hasCode(error, 'EEXIST')) throw new HttpError(409, `Already exists: ${dir}`)
    if (hasCode(error, 'ENOENT') || hasCode(error, 'ENOTDIR')) {
      throw new HttpError(400, `Not a folder: ${path.dirname(dir)}`)
    }
    if (hasCode(error, 'EACCES') || hasCode(error, 'EPERM') || hasCode(error, 'EROFS')) {
      throw new HttpError(403, `Cannot create: ${dir}`)
    }
    throw new HttpError(400, `Cannot create ${dir}: ${errorMessage(error)}`)
  })
  return dir
}

async function canOpen(dir: string): Promise<boolean> {
  try {
    await (await opendir(dir)).close()
    return true
  } catch {
    return false
  }
}

/** Windows has no folder that holds the drives, so each letter is tried. */
async function drives(): Promise<FolderListing['folders']> {
  const letters = Array.from({ length: 26 }, (_, i) => String.fromCharCode(65 + i))
  const found = await Promise.all(
    letters.map(async (letter) => {
      const info = await stat(`${letter}:\\`).catch(() => null)
      return info?.isDirectory() ? { name: `${letter}:`, path: `${letter}:\\` } : null
    }),
  )
  return found.filter((drive) => drive !== null)
}
