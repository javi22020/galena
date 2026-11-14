import type { SessionConfigOption } from '@agentclientprotocol/sdk'
import { Check, ChevronDown, SlidersHorizontal } from 'lucide-react'
import { Fragment, useState, type KeyboardEvent } from 'react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { InputGroupButton } from '@/components/ui/input-group'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'
import { choiceGroups, choices, type SelectOption } from '../../shared/config'
import type { SessionMeta } from '../../shared/types'
import { api } from '../api'
import { showError } from '../store'
import { Picker, PickerItems, type PickerOption } from './Picker'

/**
 * The options the agent offers for this chat, as ACP describes them: the model
 * and the effort at hand, everything else in a menu. What is shown is always
 * what the server last reported, so a change appears once the agent accepts it.
 */
export function ConfigOptions({ session }: { session: SessionMeta }) {
  const options = session.configOptions ?? []
  const model = options.find((o): o is SelectOption => o.type === 'select' && o.category === 'model')
  const effort = options.find((o): o is SelectOption => o.type === 'select' && o.category === 'thought_level')
  // ACP says to ignore options of an unknown type.
  const rest = options.filter((o) => o !== model && o !== effort && (o.type === 'select' || o.type === 'boolean'))

  const change = (option: SessionConfigOption, value: string | boolean) => {
    if (value !== option.currentValue) api.setConfig(session.id, option.id, value).catch(showError)
  }

  return (
    <>
      {model && <ModelPicker option={model} onChange={(value) => change(model, value)} />}
      {effort && (
        <Picker
          label={effort.name}
          variant="ghost"
          size="xs"
          value={effort.currentValue}
          options={pickerOptions(effort)}
          onChange={(value) => change(effort, value)}
        />
      )}
      {rest.length > 0 && <MoreOptions options={rest} onChange={change} />}
    </>
  )
}

function pickerOptions(option: SelectOption): PickerOption[] {
  return choiceGroups(option).flatMap(({ name, choices }) =>
    choices.map((choice) => ({
      value: choice.value,
      label: choice.name,
      description: choice.description ?? undefined,
      group: name,
    })),
  )
}

/** The model, picked from a list that can be searched: some agents offer many. */
function ModelPicker({ option, onChange }: { option: SelectOption; onChange: (value: string) => void }) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [index, setIndex] = useState(0)

  const all = pickerOptions(option)
  const wanted = query.trim().toLowerCase()
  const found = all.filter((choice) =>
    `${choice.label} ${choice.description ?? ''} ${choice.value}`.toLowerCase().includes(wanted),
  )
  const current = all.find((choice) => choice.value === option.currentValue)

  const toggle = (next: boolean) => {
    setOpen(next)
    setQuery('')
    setIndex(0)
  }
  const pick = (value: string) => {
    toggle(false)
    onChange(value)
  }
  const onKeyDown = (event: KeyboardEvent) => {
    const move = { ArrowDown: 1, ArrowUp: -1 }[event.key]
    if (move && found.length) {
      event.preventDefault()
      setIndex((index + move + found.length) % found.length)
    } else if (event.key === 'Enter' && found[index]) {
      event.preventDefault()
      pick(found[index].value)
    }
  }

  return (
    <Popover open={open} onOpenChange={toggle}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="xs" aria-label={option.name} className="min-w-0 max-w-40 gap-2 text-[13px]">
          <span className="truncate">{current?.label ?? option.currentValue}</span>
          <ChevronDown className="text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 gap-1 p-1">
        <Input
          autoFocus
          value={query}
          onChange={(event) => {
            setQuery(event.target.value)
            setIndex(0)
          }}
          onKeyDown={onKeyDown}
          placeholder={`Search ${option.name.toLowerCase()}…`}
          aria-label={`Search ${option.name.toLowerCase()}`}
        />
        <div role="listbox" aria-label={option.name} className="max-h-72 overflow-y-auto">
          {found.map((choice, position) => (
            <Fragment key={choice.value}>
              {choice.group && choice.group !== found[position - 1]?.group && (
                <div className="px-2 pt-2 pb-1 text-xs text-muted-foreground">{choice.group}</div>
              )}
              <div
                role="option"
                aria-selected={choice.value === option.currentValue}
                className={cn(
                  'flex cursor-default items-start gap-2 rounded-xl px-2 py-1.5',
                  position === index && 'bg-accent text-accent-foreground',
                )}
                ref={position === index ? (element) => element?.scrollIntoView({ block: 'nearest' }) : undefined}
                onMouseEnter={() => setIndex(position)}
                onClick={() => pick(choice.value)}
              >
                <span className="flex min-w-0 flex-1 flex-col">
                  {choice.label}
                  {choice.description && <span className="text-xs text-muted-foreground">{choice.description}</span>}
                </span>
                {choice.value === option.currentValue && <Check className="mt-0.5 size-4 shrink-0" />}
              </div>
            </Fragment>
          ))}
          {!found.length && <p className="px-2 py-1.5 text-muted-foreground">Nothing matches</p>}
        </div>
      </PopoverContent>
    </Popover>
  )
}

interface MoreOptionsProps {
  options: SessionConfigOption[]
  onChange: (option: SessionConfigOption, value: string | boolean) => void
}

/** The agent's other options (mode, speed…), in the order it gives them. */
function MoreOptions({ options, onChange }: MoreOptionsProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <InputGroupButton size="icon-xs" aria-label="More options">
          <SlidersHorizontal />
        </InputGroupButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-auto min-w-52">
        {options.map((option) =>
          option.type === 'boolean' ? (
            <DropdownMenuCheckboxItem
              key={option.id}
              checked={option.currentValue}
              onCheckedChange={(checked) => onChange(option, checked)}
              onSelect={(event) => event.preventDefault()}
            >
              {option.name}
            </DropdownMenuCheckboxItem>
          ) : (
            <DropdownMenuSub key={option.id}>
              <DropdownMenuSubTrigger>
                {option.name}
                <span className="ml-auto pl-4 text-muted-foreground">
                  {choices(option).find((choice) => choice.value === option.currentValue)?.name}
                </span>
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="max-w-80">
                <PickerItems
                  value={option.currentValue}
                  options={pickerOptions(option)}
                  onChange={(value) => onChange(option, value)}
                />
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          ),
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
