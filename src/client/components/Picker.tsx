import { ChevronDown } from 'lucide-react'
import { Fragment, type ComponentProps, type ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

export interface PickerOption {
  value: string
  label: string
  description?: string
  /** Options with the same group are listed together under its name. */
  group?: string
}

interface PickerProps {
  /** Names the control for assistive technology. */
  label: string
  value: string
  options: PickerOption[]
  onChange: (value: string) => void
  variant?: ComponentProps<typeof Button>['variant']
  size?: ComponentProps<typeof Button>['size']
  /** Shown before the current choice. */
  children?: ReactNode
}

/** A button showing the current choice, with the alternatives in a menu. */
export function Picker({ label, value, options, onChange, variant = 'outline', size, children }: PickerProps) {
  const current = options.find((option) => option.value === value)
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant={variant} size={size} aria-label={label} className="min-w-0 gap-2 text-[13px]">
          {children}
          <span className="truncate">{current?.label ?? value}</span>
          <ChevronDown className="text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-auto max-w-80 min-w-44">
        <PickerItems value={value} options={options} onChange={onChange} />
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** The choices of a picker as radio items, also used inside submenus. */
export function PickerItems({ value, options, onChange }: Pick<PickerProps, 'value' | 'options' | 'onChange'>) {
  return (
    <DropdownMenuRadioGroup value={value} onValueChange={onChange}>
      {options.map((option, index) => (
        <Fragment key={option.value}>
          {option.group && option.group !== options[index - 1]?.group && (
            <DropdownMenuLabel>{option.group}</DropdownMenuLabel>
          )}
          <DropdownMenuRadioItem value={option.value}>
            <span className="flex min-w-0 flex-col">
              {option.label}
              {option.description && (
                <span className="text-xs text-muted-foreground">{option.description}</span>
              )}
            </span>
          </DropdownMenuRadioItem>
        </Fragment>
      ))}
    </DropdownMenuRadioGroup>
  )
}
