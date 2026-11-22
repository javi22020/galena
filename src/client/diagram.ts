// Mermaid diagrams, drawn in the app's colours and font. The library is big,
// so it is loaded with the first diagram; each kind of diagram then brings its own code.

import type { MermaidConfig } from 'mermaid'
import { useTheme } from './theme'

/** What a diagram's source came to: its SVG, or why there is none. */
type Drawn = { svg: string } | { error: string }

interface Shown {
  source: string
  onDraw?: (failed: boolean) => void
}

/**
 * The id Mermaid draws with, which its styles and arrowheads go by. Each copy
 * put on screen gets one of its own instead: a copy that is hidden would
 * otherwise take the arrowheads of the others with it. Random, so that it is
 * not also a word of some label.
 */
const DRAW_ID = `diagram-${Math.random().toString(36).slice(2)}`

/** Diagrams by source, in the theme on screen; a promise while one is being drawn. */
const cache = new Map<string, Drawn | Promise<Drawn>>()
/** A note being written leaves a diagram behind for every version of its source that was drawn. */
const CACHED = 200
const shown = new WeakMap<HTMLElement, Shown>()
/** Mermaid has one configuration for all its diagrams: it must not change under one being drawn. */
let queue: Promise<unknown> = Promise.resolve()
let configured = false
let copies = 0

const variable = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim()

const pixel = document.createElement('canvas').getContext('2d', { willReadFrequently: true })

/**
 * A colour of the theme as `#rrggbb`. Mermaid derives its shades from the
 * colours it is given, so it needs them as literals rather than as `var(--…)`,
 * and it only knows the oldest ways of writing one: painting a pixel with the
 * colour turns any other into those.
 */
function color(name: string): string {
  if (!pixel) return variable(name)
  pixel.fillStyle = variable(name)
  pixel.fillRect(0, 0, 1, 1)
  const rgb = pixel.getImageData(0, 0, 1, 1).data.slice(0, 3)
  return `#${Array.from(rgb, (part) => part.toString(16).padStart(2, '0')).join('')}`
}

/** `name0`, `name1`… as many as Mermaid has of any, going round `values`. */
const numbered = (name: string, values: string[], first = 0) =>
  Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`${name}${i + first}`, values[i % values.length]]))

/** The app's theme as Mermaid's. The colours are read again after every change of theme. */
function config(): MermaidConfig {
  const background = color('--background')
  const foreground = color('--foreground')
  const muted = color('--muted')
  const subtle = color('--muted-foreground')
  const border = color('--border')
  const brand = color('--brand')
  const brandSoft = color('--brand-soft')
  const destructive = color('--destructive')
  // What tells slices, branches and series apart. Mermaid would get them by turning the
  // hue of the node colour, which is a grey here: they would all be the same grey.
  const series = [brand, color('--tok-type'), color('--tok-number'), color('--tok-string'), color('--tok-keyword'), destructive]
  return {
    startOnLoad: false,
    securityLevel: 'strict',
    // A diagram that cannot be drawn is reported here, not drawn as an error by Mermaid.
    suppressErrorRendering: true,
    theme: 'base',
    look: 'classic',
    fontFamily: variable('--font-sans'),
    // A Gantt chart is as wide as the page it is drawn in, whatever it has in it.
    gantt: { useWidth: 720 },
    // What the variables do not reach. A timeline draws its lines in the colour of the text on
    // its boxes, which is the background's, and a board titles its columns in the colour of the
    // text outside them; some titles name a font of their own.
    themeCSS: `.lineWrapper line { stroke: ${subtle}; } .sections .cluster-label { color: ${background}; }
      text[font-family] { font-family: inherit; }`,
    themeVariables: {
      darkMode: useTheme.getState().theme === 'dark',
      background,
      // Nodes are boxes like those of code and table headers.
      primaryColor: muted,
      primaryTextColor: foreground,
      primaryBorderColor: border,
      secondaryColor: muted,
      secondaryTextColor: foreground,
      secondaryBorderColor: border,
      tertiaryColor: background,
      tertiaryTextColor: foreground,
      tertiaryBorderColor: border,
      lineColor: subtle,
      textColor: foreground,
      edgeLabelBackground: background,
      noteBkgColor: brandSoft,
      noteTextColor: foreground,
      noteBorderColor: border,
      activationBorderColor: border,
      // Gantt: tasks are boxes too; the one under way and the critical ones stand out.
      taskBkgColor: muted,
      taskBorderColor: border,
      activeTaskBkgColor: brandSoft,
      activeTaskBorderColor: brand,
      doneTaskBkgColor: background,
      doneTaskBorderColor: border,
      critBkgColor: color('--destructive-soft'),
      critBorderColor: destructive,
      sectionBkgColor: muted,
      sectionBkgColor2: muted,
      altSectionBkgColor: background,
      gridColor: border,
      todayLineColor: destructive,
      // Pie: solid slices, set apart by a gap rather than by an outline.
      ...numbered('pie', series, 1),
      pieSectionTextColor: background,
      pieStrokeColor: background,
      pieOuterStrokeColor: background,
      pieOpacity: '1',
      // Mind maps, timelines and the like: the text goes on the colour.
      ...numbered('cScale', series),
      ...numbered('cScaleLabel', [background]),
      ...numbered('cScaleInv', [subtle]),
      ...numbered('git', series),
      ...numbered('gitBranchLabel', [background]),
      quadrantPointFill: brand,
      xyChart: { plotColorPalette: series.join(',') },
      // Black, unless told otherwise, whatever the theme.
      archGroupBorderColor: border,
      archEdgeColor: subtle,
      archEdgeArrowColor: subtle,
      packet: {
        blockFillColor: muted,
        blockStrokeColor: border,
        labelColor: foreground,
        titleColor: foreground,
        startByteColor: subtle,
        endByteColor: subtle,
      },
    },
  }
}

async function draw(source: string): Promise<Drawn> {
  try {
    const { default: mermaid } = await import('mermaid')
    // Labels are measured as they are drawn, which takes the font they will be
    // shown in: the parts of it that this text is written with.
    await document.fonts.load(`16px ${variable('--font-sans')}`, source).catch(() => {})
    if (!configured) {
      mermaid.initialize(config())
      configured = true
    }
    const { svg } = await mermaid.render(DRAW_ID, source)
    return { svg }
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) }
  }
}

function drawn(source: string): Drawn | Promise<Drawn> {
  const known = cache.get(source)
  if (known) return known
  const pending = queue.then(() => draw(source))
  queue = pending
  // The oldest goes first: a map keeps its keys in the order they were added.
  if (cache.size >= CACHED) cache.delete(cache.keys().next().value!)
  cache.set(source, pending)
  void pending.then((result) => {
    // The theme changed meanwhile, and with it what the source comes to.
    if (cache.get(source) !== pending) return
    // A failure is not kept: it may be the library that did not load, not the diagram that is wrong.
    if ('svg' in result) cache.set(source, result)
    else cache.delete(source)
  })
  return pending
}

function show(element: HTMLElement, state: Shown, result: Drawn): void {
  // It took a while, and the element may be for another diagram by now.
  if (shown.get(element) !== state) return
  const failed = 'error' in result
  if (failed) {
    const message = document.createElement('pre')
    message.textContent = result.error
    element.replaceChildren(message)
  } else {
    element.innerHTML = result.svg.replaceAll(DRAW_ID, `${DRAW_ID}-${++copies}`)
    // Mermaid lets it shrink to the width there is. Below half its size nothing
    // in it can be read, so from there on the element scrolls instead.
    const svg = element.querySelector('svg')
    if (svg?.style.maxWidth) svg.style.minWidth = `calc(${svg.style.maxWidth} / 2)`
    // A link in a diagram must not take the app's own window.
    for (const link of element.querySelectorAll('a')) {
      link.setAttribute('target', '_blank')
      link.setAttribute('rel', 'noopener noreferrer')
    }
  }
  state.onDraw?.(failed)
}

/** What the element shows stays until its diagram is drawn: at once, if it was drawn before. */
function paint(element: HTMLElement): void {
  const state = shown.get(element)
  if (!state) return
  const result = drawn(state.source)
  if (result instanceof Promise) void result.then((value) => show(element, state, value))
  else show(element, state, result)
}

/**
 * Shows a diagram in an element, and keeps it in the app's theme. An invalid
 * one shows Mermaid's message instead. `onDraw` is called each time the
 * element's content changes, with whether the diagram failed.
 */
export function showDiagram(element: HTMLElement, source: string, onDraw?: (failed: boolean) => void): void {
  element.classList.add('diagram')
  shown.set(element, { source, onDraw })
  paint(element)
}

useTheme.subscribe(() => {
  cache.clear()
  configured = false
  for (const element of document.querySelectorAll<HTMLElement>('.diagram')) paint(element)
})
