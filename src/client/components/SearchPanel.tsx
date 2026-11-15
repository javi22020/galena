// The find-and-replace panel over a note, drawn with the app's own components.
// It shows CodeMirror's search state and acts through its commands; it is put
// in place of CodeMirror's own panel by search-panel.tsx.

import {
  closeSearchPanel,
  findNext,
  findPrevious,
  replaceAll,
  replaceNext,
  selectMatches,
  setSearchQuery,
  type SearchQuery,
} from '@codemirror/search'
import { runScopeHandlers, type EditorView } from '@codemirror/view'
import {
  ArrowDown,
  ArrowUp,
  CaseSensitive,
  ChevronRight,
  Regex,
  WholeWord,
  X,
  type LucideIcon,
} from 'lucide-react'
import { useState, useSyncExternalStore, type ComponentProps, type KeyboardEvent } from 'react'
import { Button } from '@/components/ui/button'
import { InputGroup, InputGroupAddon, InputGroupInput, InputGroupText } from '@/components/ui/input-group'
import { Kbd } from '@/components/ui/kbd'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { altShortcut, shortcut } from '@/lib/platform'
import { cn } from '@/lib/utils'
import { matchLabel, withQuery, type Matches } from '../search'
import { IconButton } from './IconButton'

/** What the panel shows, replaced as a whole whenever any of it changes. */
export interface Snapshot {
  query: SearchQuery
  matches: Matches
  readOnly: boolean
}

type Option = 'caseSensitive' | 'wholeWord' | 'regexp'

/** The query's options, toggled with Alt and their key. */
const options: { option: Option; name: string; key: string; Icon: LucideIcon }[] = [
  { option: 'caseSensitive', name: 'Match case', key: 'C', Icon: CaseSensitive },
  { option: 'wholeWord', name: 'Whole word', key: 'W', Icon: WholeWord },
  { option: 'regexp', name: 'Regular expression', key: 'R', Icon: Regex },
]

interface SearchPanelProps {
  view: EditorView
  store: { subscribe: (listener: () => void) => () => void; get: () => Snapshot }
}

/**
 * One row to find, with the query's options inside the field, and another to
 * replace, folded away until it is asked for. Enter goes to the next match,
 * Shift+Enter to the previous one.
 */
export function SearchPanel({ view, store }: SearchPanelProps) {
  const { query, matches, readOnly } = useSyncExternalStore(store.subscribe, store.get)
  const [replacing, setReplacing] = useState(query.replace !== '')
  const showReplace = replacing && !readOnly
  const label = matchLabel(query, matches)

  const change = (config: Parameters<typeof withQuery>[1]) =>
    view.dispatch({ effects: setSearchQuery.of(withQuery(query, config)) })
  const toggle = (option: Option) => change({ [option]: !query[option] })

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    // Escape, Mod-f, F3 and the rest of CodeMirror's search keys.
    if (runScopeHandlers(view, event.nativeEvent, 'search-panel')) return event.preventDefault()
    const mod = event.ctrlKey || event.metaKey
    const field = event.target instanceof HTMLInputElement ? event.target.name : null
    let run: (() => unknown) | undefined
    if (event.key === 'Enter' && field) {
      if (event.altKey) run = mod ? () => replaceAll(view) : () => selectMatches(view)
      else if (!mod && field === 'replace') run = () => replaceNext(view)
      else if (!mod) run = () => (event.shiftKey ? findPrevious : findNext)(view)
    } else if (event.altKey && !mod && !event.shiftKey) {
      // By the key's place, as on a Mac the letter Alt types is another one.
      const option = options.find(({ key }) => event.code === `Key${key}`)?.option
      if (option) run = () => toggle(option)
    }
    if (!run) return
    event.preventDefault()
    run()
  }

  return (
    <div
      className="grid grid-cols-[1.75rem_minmax(0,1fr)_auto] items-center gap-1.5 p-1.5 font-sans text-[13px]"
      onKeyDown={onKeyDown}
    >
      {readOnly ? (
        <span />
      ) : (
        <IconButton
          label="Toggle replace"
          size="icon-sm"
          aria-expanded={showReplace}
          onClick={() => setReplacing(!replacing)}
        >
          <ChevronRight className={cn('transition-transform', showReplace && 'rotate-90')} />
        </IconButton>
      )}
      <InputGroup className="h-7">
        <InputGroupInput
          name="search"
          main-field="true"
          aria-label="Find"
          placeholder="Find"
          autoComplete="off"
          spellCheck={false}
          className="h-full text-[13px]"
          value={query.search}
          aria-invalid={query.search !== '' && !query.valid}
          onChange={(event) => change({ search: event.target.value })}
        />
        <InputGroupAddon align="inline-end" className="gap-0.5">
          {label && (
            <InputGroupText
              className={cn('px-1 text-xs whitespace-nowrap tabular-nums', label.error && 'text-destructive')}
            >
              {label.text}
            </InputGroupText>
          )}
          {options.map(({ option, name, key, Icon }) => (
            <IconButton
              key={option}
              label={name}
              keys={altShortcut(key)}
              size="icon-xs"
              active={query[option]}
              className="aria-pressed:bg-brand-soft aria-pressed:text-brand aria-pressed:hover:bg-brand-soft"
              onClick={() => toggle(option)}
            >
              <Icon className="size-3.5" />
            </IconButton>
          ))}
        </InputGroupAddon>
      </InputGroup>
      <div className="flex items-center justify-end gap-0.5">
        <IconButton label="Previous match" keys="Shift Enter" size="icon-sm" onClick={() => findPrevious(view)}>
          <ArrowUp />
        </IconButton>
        <IconButton label="Next match" keys="Enter" size="icon-sm" onClick={() => findNext(view)}>
          <ArrowDown />
        </IconButton>
        <TextButton hint="Select all matches" keys={altShortcut('Enter')} onClick={() => selectMatches(view)}>
          All
        </TextButton>
        <IconButton label="Close" keys="Esc" size="icon-sm" onClick={() => closeSearchPanel(view)}>
          <X />
        </IconButton>
      </div>

      {showReplace && (
        <>
          <span />
          <InputGroup className="h-7">
            <InputGroupInput
              name="replace"
              aria-label="Replace"
              placeholder="Replace"
              autoComplete="off"
              spellCheck={false}
              className="h-full text-[13px]"
              value={query.replace}
              onChange={(event) => change({ replace: event.target.value })}
            />
          </InputGroup>
          <div className="flex items-center justify-end gap-0.5">
            <TextButton hint="Replace" keys="Enter" onClick={() => replaceNext(view)}>
              Replace
            </TextButton>
            <TextButton hint="Replace all" keys={shortcut(altShortcut('Enter'))} onClick={() => replaceAll(view)}>
              Replace all
            </TextButton>
          </div>
        </>
      )}
    </div>
  )
}

interface TextButtonProps extends ComponentProps<typeof Button> {
  /** What it does, in its tooltip. */
  hint: string
  keys: string
}

/** A quiet button with a word on it, and its shortcut in a tooltip. */
function TextButton({ hint, keys, className, ...props }: TextButtonProps) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="ghost" size="sm" aria-label={hint} className={cn('px-2 text-[13px] text-muted-foreground', className)} {...props} />
      </TooltipTrigger>
      <TooltipContent>
        {hint}
        <Kbd>{keys}</Kbd>
      </TooltipContent>
    </Tooltip>
  )
}
