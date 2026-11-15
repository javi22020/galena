import {
  forceLink,
  forceManyBody,
  forceSimulation,
  forceX,
  forceY,
  type SimulationLinkDatum,
  type SimulationNodeDatum,
} from 'd3-force'
import { noteName } from '../shared/links'
import type { Graph } from '../shared/types'

/** A position on screen, as events give it. */
interface Point {
  clientX: number
  clientY: number
}

const point = ({ clientX, clientY }: Point): Point => ({ clientX, clientY })

interface Node extends SimulationNodeDatum {
  path: string
  radius: number
}

/**
 * Draws a force-directed graph on a canvas, with pan (drag the background),
 * zoom (wheel or pinch) and draggable nodes. Clicking a node calls `onOpen`.
 * Returns a function that stops the simulation and removes the listeners.
 */
export function renderGraph(canvas: HTMLCanvasElement, graph: Graph, onOpen: (path: string) => void) {
  const degree = new Map<string, number>()
  for (const { source, target } of graph.links) {
    degree.set(source, (degree.get(source) ?? 0) + 1)
    degree.set(target, (degree.get(target) ?? 0) + 1)
  }
  const nodes: Node[] = graph.nodes.map(({ path }) => ({
    path,
    radius: 3 + Math.sqrt(degree.get(path) ?? 0),
  }))
  const links: SimulationLinkDatum<Node>[] = graph.links.map((link) => ({ ...link }))
  const neighbours = new Set(graph.links.flatMap((l) => [`${l.source}\n${l.target}`, `${l.target}\n${l.source}`]))

  const context = canvas.getContext('2d')!
  const view = { x: 0, y: 0, scale: 1 }
  let hovered: Node | undefined
  /** A press on the canvas: on a node it drags the node, elsewhere the view. */
  let drag: { node?: Node; start: Point; moved: boolean } | undefined

  const simulation = forceSimulation(nodes)
    .force('link', forceLink<Node, SimulationLinkDatum<Node>>(links).id((node) => node.path).distance(70))
    .force('charge', forceManyBody().strength(-220))
    .force('x', forceX().strength(0.06))
    .force('y', forceY().strength(0.06))
    .on('tick', draw)

  function draw(): void {
    const ratio = window.devicePixelRatio
    const { clientWidth: width, clientHeight: height } = canvas
    if (canvas.width !== width * ratio || canvas.height !== height * ratio) {
      canvas.width = width * ratio
      canvas.height = height * ratio
    }
    const style = getComputedStyle(canvas)
    const color = (name: string) => style.getPropertyValue(name)
    const related = (node: Node) =>
      node === hovered || (hovered !== undefined && neighbours.has(`${hovered.path}\n${node.path}`))

    context.setTransform(ratio, 0, 0, ratio, 0, 0)
    context.clearRect(0, 0, width, height)
    context.translate(width / 2 + view.x, height / 2 + view.y)
    context.scale(view.scale, view.scale)

    context.lineWidth = 1 / view.scale
    for (const { source, target } of links as { source: Node; target: Node }[]) {
      context.strokeStyle = color(source === hovered || target === hovered ? '--brand' : '--border')
      context.beginPath()
      context.moveTo(source.x!, source.y!)
      context.lineTo(target.x!, target.y!)
      context.stroke()
    }

    const showAllLabels = nodes.length <= 60 || view.scale > 1.4
    context.font = `${11 / view.scale}px ${style.fontFamily}`
    context.textAlign = 'center'
    for (const node of nodes) {
      context.fillStyle = color(related(node) ? '--brand' : '--muted-foreground')
      context.beginPath()
      context.arc(node.x!, node.y!, node.radius, 0, Math.PI * 2)
      context.fill()
      if (showAllLabels || related(node)) {
        context.fillStyle = color('--foreground')
        context.fillText(noteName(node.path), node.x!, node.y! + node.radius + 12 / view.scale)
      }
    }
  }

  /** Pointer position in graph coordinates. */
  function locate(point: Point): { x: number; y: number } {
    const rect = canvas.getBoundingClientRect()
    return {
      x: (point.clientX - rect.left - rect.width / 2 - view.x) / view.scale,
      y: (point.clientY - rect.top - rect.height / 2 - view.y) / view.scale,
    }
  }

  function nodeAt(point: Point): Node | undefined {
    const { x, y } = locate(point)
    return nodes.find((node) => Math.hypot(node.x! - x, node.y! - y) <= node.radius + 4 / view.scale)
  }

  /** Scales the view around a point on screen: the graph point under it stays where it is. */
  function zoomAt(point: Point, factor: number): void {
    const before = locate(point)
    view.scale = Math.min(4, Math.max(0.2, view.scale * factor))
    const after = locate(point)
    view.x += (after.x - before.x) * view.scale
    view.y += (after.y - before.y) * view.scale
  }

  /** Where each pointer pressed on the canvas is, by id: two of them pinch. */
  const pointers = new Map<number, Point>()
  let pinch: { distance: number; clientX: number; clientY: number } | undefined

  function measurePinch(): NonNullable<typeof pinch> {
    const [a, b] = [...pointers.values()] as [Point, Point]
    return {
      distance: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY),
      clientX: (a.clientX + b.clientX) / 2,
      clientY: (a.clientY + b.clientY) / 2,
    }
  }

  /** Lets go of a dragged node without opening it. */
  function release(): void {
    if (drag?.node) {
      Object.assign(drag.node, { fx: null, fy: null })
      simulation.alphaTarget(0)
    }
    drag = undefined
  }

  function onPointerDown(event: PointerEvent): void {
    canvas.setPointerCapture(event.pointerId)
    pointers.set(event.pointerId, point(event))
    if (pointers.size === 1) {
      drag = { node: nodeAt(event), start: point(event), moved: false }
      // On a node, which a click opens, the hand closes only once it is dragged.
      if (!drag.node) canvas.style.cursor = 'grabbing'
    } else {
      // A second finger turns the drag into a pinch; any finger after that
      // starts it again from where the fingers are.
      release()
      pinch = measurePinch()
    }
  }

  function onPointerMove(event: PointerEvent): void {
    const last = pointers.get(event.pointerId)
    if (last) pointers.set(event.pointerId, point(event))
    if (pinch) {
      if (pointers.size >= 2) {
        const next = measurePinch()
        view.x += next.clientX - pinch.clientX
        view.y += next.clientY - pinch.clientY
        if (pinch.distance > 0) zoomAt(next, next.distance / pinch.distance)
        pinch = next
      }
    } else if (!drag || !last) {
      hovered = nodeAt(event)
      canvas.style.cursor = hovered ? 'pointer' : 'grab'
    } else {
      // A finger is never quite still: until it travels a few pixels, the press is a click.
      const slop = event.pointerType === 'mouse' ? 3 : 8
      drag.moved ||= Math.hypot(event.clientX - drag.start.clientX, event.clientY - drag.start.clientY) > slop
      if (!drag.moved) return
      canvas.style.cursor = 'grabbing'
      if (drag.node) {
        Object.assign(drag.node, { fx: locate(event).x, fy: locate(event).y })
        simulation.alphaTarget(0.3).restart()
      } else {
        // From the last position rather than movementX, which touch screens do not all report.
        view.x += event.clientX - last.clientX
        view.y += event.clientY - last.clientY
      }
    }
    draw()
  }

  function onPointerUp(event: PointerEvent): void {
    if (!pointers.delete(event.pointerId)) return
    if (pinch) {
      // Fewer fingers start the pinch again from where they are; the one left
      // on the canvas after a pinch neither pans nor opens anything.
      if (pointers.size >= 2) pinch = measurePinch()
      else if (!pointers.size) pinch = undefined
      return
    }
    if (drag?.node && !drag.moved && event.type === 'pointerup') onOpen(drag.node.path)
    release()
    canvas.style.cursor = nodeAt(event) ? 'pointer' : 'grab'
  }

  function onWheel(event: WheelEvent): void {
    event.preventDefault()
    zoomAt(event, event.deltaY < 0 ? 1.1 : 1 / 1.1)
    draw()
  }

  const observer = new ResizeObserver(draw)
  observer.observe(canvas)
  canvas.addEventListener('pointerdown', onPointerDown)
  canvas.addEventListener('pointermove', onPointerMove)
  canvas.addEventListener('pointerup', onPointerUp)
  canvas.addEventListener('pointercancel', onPointerUp)
  // However a press ends, losing the capture forgets it, so it cannot linger as half of a pinch.
  canvas.addEventListener('lostpointercapture', onPointerUp)
  canvas.addEventListener('wheel', onWheel, { passive: false })

  return () => {
    simulation.stop()
    observer.disconnect()
    canvas.removeEventListener('pointerdown', onPointerDown)
    canvas.removeEventListener('pointermove', onPointerMove)
    canvas.removeEventListener('pointerup', onPointerUp)
    canvas.removeEventListener('pointercancel', onPointerUp)
    canvas.removeEventListener('lostpointercapture', onPointerUp)
    canvas.removeEventListener('wheel', onWheel)
  }
}
