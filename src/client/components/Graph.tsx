import { useEffect, useMemo, useRef, useState } from 'react'
import type { Graph } from '../../shared/types'
import { api } from '../api'
import { renderGraph } from '../graph'
import { ancestors, openNote, setModal, showError, useStore } from '../store'
import { Modal } from './Modal'
import { Picker } from './Picker'

/** Notes as nodes and wikilinks as edges, filtered by folder or tag. */
export function GraphView() {
  return (
    <Modal name="graph" title="Graph" className="h-full sm:max-w-5xl">
      <GraphBody />
    </Modal>
  )
}

function GraphBody() {
  const fsTick = useStore((s) => s.fsTick)
  const [graph, setGraph] = useState<Graph>({ nodes: [], links: [] })
  const [folder, setFolder] = useState('')
  const [tag, setTag] = useState('')
  const canvas = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    api.graph().then(setGraph, showError)
  }, [fsTick])

  const folders = useMemo(
    () => [...new Set(graph.nodes.flatMap((node) => ancestors(node.path)))].sort(),
    [graph],
  )
  const tags = useMemo(() => [...new Set(graph.nodes.flatMap((node) => node.tags))].sort(), [graph])

  const visible = useMemo<Graph>(() => {
    const nodes = graph.nodes.filter(
      (node) => (!folder || node.path.startsWith(`${folder}/`)) && (!tag || node.tags.includes(tag)),
    )
    const shown = new Set(nodes.map((node) => node.path))
    const links = graph.links.filter((link) => shown.has(link.source) && shown.has(link.target))
    return { nodes, links }
  }, [graph, folder, tag])

  useEffect(() => {
    return renderGraph(canvas.current!, visible, (path) => {
      openNote(path)
      setModal(null)
    })
  }, [visible])

  return (
    <>
      <div className="flex shrink-0 items-center gap-2 border-b px-4 py-2.5">
        <Picker
          label="Folder"
          value={folder}
          options={[{ value: '', label: 'All folders' }, ...folders.map((name) => ({ value: name, label: name }))]}
          onChange={setFolder}
        />
        <Picker
          label="Tag"
          value={tag}
          options={[{ value: '', label: 'All tags' }, ...tags.map((name) => ({ value: name, label: `#${name}` }))]}
          onChange={setTag}
        />
        <span className="ml-1 text-xs text-muted-foreground">
          {visible.nodes.length} notes · {visible.links.length} links
        </span>
      </div>
      <canvas ref={canvas} className="min-h-0 w-full flex-1 cursor-grab touch-none" />
    </>
  )
}
