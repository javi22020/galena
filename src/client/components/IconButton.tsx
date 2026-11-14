import type { ComponentProps } from 'react'
import { Button } from '@/components/ui/button'
import { Kbd } from '@/components/ui/kbd'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

interface IconButtonProps extends ComponentProps<typeof Button> {
  /** Names the button for assistive technology and in its tooltip. */
  label: string
  /** For buttons that toggle something: whether it is on. */
  active?: boolean
  /** Its keyboard shortcut, shown in the tooltip. */
  keys?: string
}

/** A quiet square button holding just an icon. */
export function IconButton({ label, active, keys, className, ...props }: IconButtonProps) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label={label}
          aria-pressed={active}
          className={cn(
            'text-muted-foreground',
            active && 'text-foreground',
            // A bigger target for a finger; the smaller sizes sit in rows that keep theirs.
            props.size === undefined && 'pointer-coarse:size-10',
            className,
          )}
          {...props}
        />
      </TooltipTrigger>
      <TooltipContent>
        {label}
        {keys && <Kbd>{keys}</Kbd>}
      </TooltipContent>
    </Tooltip>
  )
}
