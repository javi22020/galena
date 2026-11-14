import { diffLines } from 'diff'
import { memo } from 'react'
import { CodeBlockContent, CodeBlockLine } from '@/components/ui/code-block'
import { cn } from '@/lib/utils'

const CONTEXT = 3

/**
 * Lines are the same whether they end in LF or CRLF. Git on Windows checks
 * notes out with CRLF while keeping LF itself, and the editor saves LF: told
 * apart, either would make every line of a note look changed.
 */
const changes = (before: string, after: string) => diffLines(before, after, { stripTrailingCr: true })

interface Line {
  /** `fold` is a muted line that is in neither text: unchanged lines left out, say. */
  kind: 'added' | 'removed' | 'default' | 'fold'
  text: string
}

/** How many lines a change adds and removes. */
export function diffStat(before: string, after: string): { added: number; removed: number } {
  let added = 0
  let removed = 0
  for (const part of changes(before, after)) {
    if (part.added) added += part.count
    else if (part.removed) removed += part.count
  }
  return { added, removed }
}

interface DiffProps {
  before: string
  after: string
  className?: string
}

/**
 * Line diff of two texts, with long unchanged stretches folded away. It is the
 * content of a `CodeBlock`, so put it in one.
 */
export const Diff = memo(function Diff({ before, after, className }: DiffProps) {
  const lines: Line[] = []
  const parts = changes(before, after)
  // The texts differ, but no line does: shown as they are, they would look
  // the same.
  if (before !== after && !parts.some((part) => part.added || part.removed)) {
    lines.push({ kind: 'fold', text: 'Only the line endings changed.' })
  } else {
    parts.forEach((part, index) => {
      const kind = part.added ? 'added' : part.removed ? 'removed' : 'default'
      const texts = part.value.replace(/\n$/, '').split('\n')
      if (kind !== 'default' || texts.length <= CONTEXT * 2 + 1) {
        for (const text of texts) lines.push({ kind, text })
        return
      }
      // Keep only the lines next to a change.
      const head = index === 0 ? [] : texts.slice(0, CONTEXT)
      const tail = index === parts.length - 1 ? [] : texts.slice(-CONTEXT)
      for (const text of head) lines.push({ kind, text })
      lines.push({ kind: 'fold', text: '⋯' })
      for (const text of tail) lines.push({ kind, text })
    })
  }

  // Notes start at the first column, so every line is indented to leave the
  // + and − markers a gutter of their own.
  const gutter = '*:block *:ps-3'
  return (
    <CodeBlockContent wrap className={className}>
      {lines.map(({ kind, text }, index) =>
        kind === 'fold' ? (
          <CodeBlockLine key={index} className={cn(gutter, 'text-muted-foreground select-none')}>
            {text}
          </CodeBlockLine>
        ) : (
          <CodeBlockLine key={index} variant={kind} className={gutter}>
            {text}
          </CodeBlockLine>
        ),
      )}
    </CodeBlockContent>
  )
})
