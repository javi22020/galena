// Helpers for ACP session config options, used by the server and the browser.

import type { SessionConfigOption, SessionConfigSelectOption, SessionModeState } from '@agentclientprotocol/sdk'

export type SelectOption = Extract<SessionConfigOption, { type: 'select' }>

/** The values of a select option in the agent's order, under their group's name if they have one. */
export function choiceGroups(option: SelectOption): { name?: string; choices: SessionConfigSelectOption[] }[] {
  return option.options.map((entry) =>
    'group' in entry ? { name: entry.name, choices: entry.options } : { choices: [entry] },
  )
}

export function choices(option: SelectOption): SessionConfigSelectOption[] {
  return choiceGroups(option).flatMap((group) => group.choices)
}

/** Whether `value` can be set on `option`. Options of a type Galena does not know take nothing. */
export function accepts(option: SessionConfigOption, value: string | boolean): boolean {
  if (option.type === 'boolean') return typeof value === 'boolean'
  if (option.type === 'select') return choices(option).some((choice) => choice.value === value)
  return false
}

/** The id of the option that stands for an agent's session modes: Galena's, so no agent's option has it. */
export const MODES_ID = '_galena/mode'

/**
 * The agent's options, with its session modes as one more option if it has no
 * option for the mode. ACP replaces modes with options: a client that takes
 * options uses the one of category `mode` and ignores the modes, which agents
 * that only offer the mode the old way are left with.
 */
export function withModes(
  options: SessionConfigOption[],
  modes: SessionModeState | null | undefined,
): SessionConfigOption[] {
  if (!modes || options.some((o) => o.category === 'mode')) return options
  const mode: SelectOption = {
    type: 'select',
    id: MODES_ID,
    name: 'Mode',
    category: 'mode',
    currentValue: modes.currentModeId,
    options: modes.availableModes.map((m) => ({ value: m.id, name: m.name, description: m.description })),
  }
  return [...options, mode]
}
