// Helpers for ACP session config options, used by the server and the browser.

import type { SessionConfigOption, SessionConfigSelectOption } from '@agentclientprotocol/sdk'

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
