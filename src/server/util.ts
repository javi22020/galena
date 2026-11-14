import { randomUUID } from 'node:crypto'
import { access, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import path from 'node:path'

/** An error whose message is safe to show to the user, with its HTTP status. */
export class HttpError extends Error {
  constructor(
    readonly status: 400 | 401 | 403 | 404 | 409 | 502,
    message: string,
  ) {
    super(message)
  }
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function hasCode(error: unknown, code: string): boolean {
  return error instanceof Error && 'code' in error && error.code === code
}

export function exists(file: string): Promise<boolean> {
  return access(file).then(
    () => true,
    () => false,
  )
}

/** Per-user directory for state that does not belong to a vault. */
export const configDir = path.join(
  process.env.XDG_CONFIG_HOME || path.join(homedir(), '.config'),
  'galena',
)

/** Turns a leading `~` into the home folder, as a shell would. */
export function expandHome(dir: string): string {
  return dir.replace(/^~(?=$|[\\/])/, homedir())
}

export async function readJson<T>(file: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await readFile(file, 'utf8')) as T
  } catch {
    return fallback
  }
}

/** Writes through a temporary file so a crash never leaves a truncated one. */
export async function writeJson(file: string, data: unknown): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true })
  const temp = `${file}.${randomUUID()}.tmp`
  await writeFile(temp, JSON.stringify(data, null, 2))
  await rename(temp, file)
}
