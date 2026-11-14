import path from 'node:path'
import type { AgentInfo } from '../shared/types'
import { configDir, errorMessage, HttpError, readJson, writeJson } from './util'

const REGISTRY_URL = 'https://cdn.agentclientprotocol.com/registry/v1/latest/registry.json'
const CACHE_FILE = path.join(configDir, 'registry.json')

interface Package {
  package: string
  args?: string[]
  env?: Record<string, string>
}

/** An agent as published in the ACP registry (only the fields Galena uses). */
interface RegistryAgent {
  id: string
  name: string
  version: string
  description: string
  website?: string
  repository?: string
  distribution: { npx?: Package; uvx?: Package; binary?: unknown }
}

interface Registry {
  agents: RegistryAgent[]
}

export interface Launch {
  command: string
  args: string[]
  env?: Record<string, string>
}

let registry: Promise<Registry> | undefined

/** The registry is fetched once per run; when offline, the last copy is used. */
function load(): Promise<Registry> {
  registry ??= fetchRegistry().catch((error) => {
    registry = undefined
    throw error
  })
  return registry
}

async function fetchRegistry(): Promise<Registry> {
  try {
    const response = await fetch(REGISTRY_URL, { signal: AbortSignal.timeout(10_000) })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const data = (await response.json()) as Registry
    await writeJson(CACHE_FILE, data)
    return data
  } catch (error) {
    const cached = await readJson<Registry | null>(CACHE_FILE, null)
    if (cached) return cached
    throw new HttpError(502, `Could not load the ACP agent registry: ${errorMessage(error)}`)
  }
}

export async function listAgents(): Promise<AgentInfo[]> {
  const { agents } = await load()
  return agents.map((agent) => ({
    id: agent.id,
    name: agent.name,
    version: agent.version,
    description: agent.description,
    website: agent.website ?? agent.repository,
    launch: agent.distribution.npx ? 'npx' : agent.distribution.uvx ? 'uvx' : 'manual',
  }))
}

/**
 * How to start an agent. A custom command from the settings wins; otherwise
 * the registry's npx or uvx package is run, which needs no prior install.
 */
export async function launchCommand(id: string, custom?: string): Promise<Launch> {
  const [command, ...args] = custom?.trim().split(/\s+/).filter(Boolean) ?? []
  if (command) return { command, args }

  const agent = (await load()).agents.find((a) => a.id === id)
  if (!agent) throw new HttpError(404, `Unknown agent: ${id}`)
  const { npx, uvx } = agent.distribution
  if (npx) return { command: 'npx', args: ['-y', npx.package, ...(npx.args ?? [])], env: npx.env }
  if (uvx) return { command: 'uvx', args: [uvx.package, ...(uvx.args ?? [])], env: uvx.env }
  throw new HttpError(
    400,
    `${agent.name} must be installed by hand: set its launch command in Settings.`,
  )
}
