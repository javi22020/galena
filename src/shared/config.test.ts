import type { SessionConfigOption, SessionModeState } from '@agentclientprotocol/sdk'
import { expect, test } from 'vitest'
import { accepts, MODES_ID, withModes, type SelectOption } from './config'

const flat: SelectOption = {
  type: 'select',
  id: 'effort',
  name: 'Effort',
  currentValue: 'low',
  options: [
    { value: 'low', name: 'Low' },
    { value: 'high', name: 'High' },
  ],
}

const grouped: SelectOption = {
  type: 'select',
  id: 'model',
  name: 'Model',
  currentValue: 'small',
  options: [
    { group: 'fast', name: 'Fast', options: [{ value: 'small', name: 'Small' }] },
    { group: 'smart', name: 'Smart', options: [{ value: 'large', name: 'Large' }, { value: 'huge', name: 'Huge' }] },
  ],
}

test('accepts takes the values a select offers, inside groups too', () => {
  expect(accepts(flat, 'high')).toBe(true)
  expect(accepts(flat, 'medium')).toBe(false)
  expect(accepts(grouped, 'huge')).toBe(true)
  // The id of a group is not a value.
  expect(accepts(grouped, 'smart')).toBe(false)
})

test('accepts takes only a value of the type of the option', () => {
  const toggle: SessionConfigOption = { type: 'boolean', id: 'web', name: 'Web search', currentValue: false }
  expect(accepts(toggle, true)).toBe(true)
  expect(accepts(toggle, 'true')).toBe(false)
  expect(accepts(flat, true)).toBe(false)
})

test('accepts takes nothing for a type of option Galena does not know', () => {
  const unknown = { type: 'number', id: 'n', name: 'Number', currentValue: 1 } as unknown as SessionConfigOption
  expect(accepts(unknown, '1')).toBe(false)
})

const modes: SessionModeState = {
  currentModeId: 'ask',
  availableModes: [
    { id: 'ask', name: 'Ask', description: 'Asks before editing' },
    { id: 'code', name: 'Code' },
  ],
}

test('withModes turns the session modes into an option, if the agent has none for the mode', () => {
  expect(withModes([flat], modes)).toStrictEqual([
    flat,
    {
      type: 'select',
      id: MODES_ID,
      name: 'Mode',
      category: 'mode',
      currentValue: 'ask',
      options: [
        { value: 'ask', name: 'Ask', description: 'Asks before editing' },
        { value: 'code', name: 'Code', description: undefined },
      ],
    },
  ])
})

test('withModes ignores the session modes of an agent with an option for the mode', () => {
  const own: SelectOption = { ...flat, id: 'permissions', category: 'mode', currentValue: 'high' }
  expect(withModes([own], modes)).toStrictEqual([own])
})

test('withModes leaves the options as they are for an agent without session modes', () => {
  expect(withModes([flat], undefined)).toStrictEqual([flat])
  expect(withModes([flat], null)).toStrictEqual([flat])
})
