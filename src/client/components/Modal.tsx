import { XIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogClose, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import { setModal, useStore, type ModalName } from '../store'

interface ModalProps {
  /** The store's `modal` value this dialog answers to. */
  name: ModalName
  title: string
  /** Leaves the title to screen readers, for dialogs that bring their own header. */
  bare?: boolean
  className?: string
  /** Rendered only while the dialog is open. */
  children: ReactNode
}

/** A dialog opened through the store; Escape or a click outside closes it. */
export function Modal({ name, title, bare, className, children }: ModalProps) {
  const open = useStore((s) => s.modal === name)
  return (
    <Dialog open={open} onOpenChange={(next) => !next && setModal(null)}>
      <DialogContent
        aria-describedby={undefined}
        showCloseButton={false}
        className={cn('flex max-h-[calc(100%-4rem)] flex-col gap-0 overflow-hidden p-0', className)}
      >
        {/* The close button sits in the header's row, so it stays centred in it. */}
        <DialogHeader
          className={bare ? 'sr-only' : 'flex-row items-center justify-between border-b py-2 pr-2 pl-4'}
        >
          <DialogTitle>{title}</DialogTitle>
          {!bare && (
            <DialogClose asChild>
              <Button variant="ghost" size="icon-sm" className="bg-secondary">
                <XIcon />
                <span className="sr-only">Close</span>
              </Button>
            </DialogClose>
          )}
        </DialogHeader>
        {children}
      </DialogContent>
    </Dialog>
  )
}
