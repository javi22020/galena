import type { SessionConfigOption } from '@agentclientprotocol/sdk'
import { expect, test } from 'vitest'
import { accepts, type SelectOption } from './config'

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
