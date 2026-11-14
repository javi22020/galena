import type { ReactNode } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
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
        showCloseButton={!bare}
        className={cn('flex max-h-[calc(100%-4rem)] flex-col gap-0 overflow-hidden p-0', className)}
      >
        <DialogHeader className={bare ? 'sr-only' : 'border-b px-4 py-3.5'}>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        {children}
      </DialogContent>
    </Dialog>
  )
}
