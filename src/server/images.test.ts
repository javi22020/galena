import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, expect, test, vi } from 'vitest'

// Opening a vault adds it to the recent ones, kept in the user's config
// folder; this points that elsewhere before anything reads where it is.
const scratch = await mkdtemp(path.join(tmpdir(), 'galena-images-'))
vi.stubEnv('XDG_CONFIG_HOME', path.join(scratch, 'config'))
const { createGalena } = await import('./app')
const { imageType, MAX_IMAGE_SIZE } = await import('./images')

const root = path.join(scratch, 'vault')
await mkdir(path.join(root, 'pics'), { recursive: true })
const galena = await createGalena({ vault: root })

afterAll(async () => {
  await galena.close()
  await rm(scratch, { recursive: true, force: true })
})

const PNG = bytes('\x89PNG\r\n\x1a\n\0\0\0\rIHDR')
const OTHER = bytes('\x89PNG\r\n\x1a\n\0\0\0\rIHDR\0\0\0\x01')
const SVG = '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'

/** Bytes with the given char codes, 0 to 255. */
function bytes(text: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(text, (char) => char.charCodeAt(0))
}

const host = '127.0.0.1:5173'

const get = (url: string) => galena.app.request(url, { headers: { host } })

const post = (url: string, body?: Uint8Array<ArrayBuffer> | string) =>
  galena.app.request(url, { method: 'POST', body, headers: { host, origin: `http://${host}` } })

const upload = (name: string, body: Uint8Array<ArrayBuffer> | string) =>
  post(`/api/image?${new URLSearchParams({ name })}`, body)

/** The path an image that is taken was given. */
async function saved(name: string, body: Uint8Array<ArrayBuffer>): Promise<string> {
  const response = await upload(name, body)
  expect(response.status).toBe(200)
  return ((await response.json()) as { path: string }).path
}

const assets = () => readdir(path.join(root, 'assets')).catch(() => [])

test('images are told apart by the extension of their names', () => {
  expect(imageType('a.png')).toBe('image/png')
  expect(imageType('pics/Photo.JPG')).toBe('image/jpeg')
  expect(imageType('my.drawing.svg')).toBe('image/svg+xml')
})

test('anything else is not an image', () => {
  expect(imageType('note.md')).toBe(null)
  expect(imageType('png')).toBe(null)
  expect(imageType('a.png/note')).toBe(null)
  expect(imageType('a.png.txt')).toBe(null)
  expect(imageType('a.constructor')).toBe(null)
  expect(imageType('')).toBe(null)
})

test('a pasted image goes to assets/, named after the original and its content', async () => {
  const rel = await saved('Captura de pantalla (2).png', PNG)
  expect(rel).toMatch(/^assets\/Captura-de-pantalla-2-[0-9a-f]{8}\.png$/)
  expect(new Uint8Array(await readFile(path.join(root, rel)))).toEqual(PNG)
})

test('the extension is kept, in small letters, and a name with nothing else is given one', async () => {
  expect(await saved('Photo.JPEG', PNG)).toMatch(/^assets\/Photo-[0-9a-f]{8}\.jpeg$/)
  expect(await saved('.gif', PNG)).toMatch(/^assets\/image-[0-9a-f]{8}\.gif$/)
})

test('accents written apart from their letters are kept', async () => {
  // As macOS names files: `e` and then the accent.
  expect(await saved('Re\u0301sume\u0301.png', PNG)).toMatch(/^assets\/R\u00e9sum\u00e9-[0-9a-f]{8}\.png$/)
})

test('a long name is cut between characters, not inside one', async () => {
  // The last letter takes two units of the string, and the cut falls between them.
  const name = `${'a'.repeat(59)}𝒜`
  const rel = await saved(`${name}bc.png`, PNG)
  expect(rel).toMatch(new RegExp(`^assets/${name}-[0-9a-f]{8}\\.png$`, 'u'))
  expect(new Uint8Array(await readFile(path.join(root, rel)))).toEqual(PNG)
})

test('the same image pasted again is stored once', async () => {
  const first = await saved('same.webp', PNG)
  const count = (await assets()).length
  expect(await saved('same.webp', PNG)).toBe(first)
  expect((await assets()).length).toBe(count)
})

test('the same image pasted twice at once is taken both times', async () => {
  const large = new Uint8Array(1 << 20).fill(1)
  const [first, second] = await Promise.all([saved('twice.png', large), saved('twice.png', large)])
  expect(second).toBe(first)
  expect(new Uint8Array(await readFile(path.join(root, first)))).toEqual(large)
})

test('an image left half written is made whole by pasting it again', async () => {
  const rel = await saved('cut.png', PNG)
  await writeFile(path.join(root, rel), PNG.subarray(0, 4))
  expect(await saved('cut.png', PNG)).toBe(rel)
  expect(new Uint8Array(await readFile(path.join(root, rel)))).toEqual(PNG)
})

test('only files named as images of the known kinds are taken', async () => {
  const count = (await assets()).length
  expect((await upload('page.html', '<html></html>')).status).toBe(415)
  expect((await upload('photo.bmp', PNG)).status).toBe(415)
  expect((await upload('unnamed', PNG)).status).toBe(415)
  expect((await assets()).length).toBe(count)
})

test('an image that is too large is refused', async () => {
  const response = await upload('large.png', new Uint8Array(MAX_IMAGE_SIZE + 1))
  expect(response.status).toBe(413)
  expect(((await response.json()) as { error: string }).error).toContain('MB at most')
})

test('an image of the vault is served as the image its name says, and nothing else is', async () => {
  await writeFile(path.join(root, 'pics/served.png'), PNG)
  await writeFile(path.join(root, 'served.md'), '# Note')

  const png = await get('/api/image?path=pics/served.png')
  expect(png.status).toBe(200)
  expect(png.headers.get('content-type')).toBe('image/png')
  expect(new Uint8Array(await png.arrayBuffer())).toEqual(PNG)

  expect((await get('/api/image?path=served.md')).status).toBe(415)
  expect((await get('/api/image?path=missing.png')).status).toBe(404)
  expect((await get('/api/image?path=../outside.png')).status).toBe(403)
  expect((await get('/api/image?path=.galena/x.png')).status).toBe(403)
})

test('another site cannot tell an image that is there from one that is not', async () => {
  await writeFile(path.join(root, 'pics/there.png'), PNG)
  // It may read neither answer, so asking for either fails alike.
  for (const file of ['there.png', 'missing.png']) {
    const response = await get(`/api/image?path=pics/${file}`)
    expect(response.headers.get('cross-origin-resource-policy')).toBe('same-origin')
  }
})

test('whatever is in an image, it is served as that image and sandboxed', async () => {
  await writeFile(path.join(root, 'pics/drawing.svg'), SVG)
  await writeFile(path.join(root, 'pics/page.png'), '<html><script>alert(1)</script></html>')
  for (const [file, type] of [
    ['drawing.svg', 'image/svg+xml'],
    ['page.png', 'image/png'],
  ]) {
    const response = await get(`/api/image?path=pics/${file}`)
    expect(response.headers.get('content-type')).toBe(type)
    expect(response.headers.get('x-content-type-options')).toBe('nosniff')
    expect(response.headers.get('content-security-policy')).toBe('sandbox')
  }
})

test('both sides of a changed image can be shown, and only of a changed file', async () => {
  const git = (...args: string[]) => execFileSync('git', args, { cwd: root, stdio: 'ignore' })
  await writeFile(path.join(root, 'pics/chart.png'), PNG)
  await writeFile(path.join(root, 'pics/data.bin'), PNG)
  await writeFile(path.join(root, 'pics/kept.png'), PNG)
  await writeFile(path.join(root, 'pics/old name.png'), OTHER)
  git('init', '-q')
  git('add', '-A')
  git('-c', 'user.name=Test', '-c', 'user.email=test@example.com', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'Images')
  await writeFile(path.join(root, 'pics/chart.png'), OTHER)
  await writeFile(path.join(root, 'pics/data.bin'), OTHER)
  await rename(path.join(root, 'pics/old name.png'), path.join(root, 'pics/new name.png'))
  git('add', '-A')
  expect((await post('/api/git/refresh')).status).toBe(200)

  const diff = await (await get('/api/git/diff?path=pics/chart.png')).json()
  expect(diff).toEqual({ before: null, after: null, binary: true, image: true })

  const before = await get('/api/git/image?path=pics/chart.png&side=before')
  expect(before.headers.get('content-type')).toBe('image/png')
  expect(new Uint8Array(await before.arrayBuffer())).toEqual(PNG)
  const after = await get('/api/git/image?path=pics/chart.png&side=after')
  expect(new Uint8Array(await after.arrayBuffer())).toEqual(OTHER)

  // A renamed image is, in the last commit, where it was.
  const renamed = await get(`/api/git/image?${new URLSearchParams({ path: 'pics/new name.png', side: 'before' })}`)
  expect(new Uint8Array(await renamed.arrayBuffer())).toEqual(OTHER)

  // A binary that is not named as an image has nothing to show.
  const data = await (await get('/api/git/diff?path=pics/data.bin')).json()
  expect(data).toEqual({ before: null, after: null, binary: true, image: false })
  expect((await get('/api/git/image?path=pics/data.bin&side=after')).status).toBe(415)

  // Committed and unchanged since.
  expect((await get('/api/git/image?path=pics/kept.png&side=after')).status).toBe(404)
})
