import { useState } from 'react'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'

export interface Confirmation {
  title: string
  description: string
  /** Label of the button that goes ahead. */
  action: string
  run: () => void
}

interface ConfirmDialogProps {
  /** What to ask; null keeps the dialog closed. */
  request: Confirmation | null
  onClose: () => void
}

/** Asks before something destructive happens. */
export function ConfirmDialog({ request, onClose }: ConfirmDialogProps) {
  // The last request stays on screen while the dialog animates out.
  const [shown, setShown] = useState(request)
  if (request && request !== shown) setShown(request)

  return (
    <AlertDialog open={!!request} onOpenChange={(open) => !open && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{shown?.title}</AlertDialogTitle>
          <AlertDialogDescription>{shown?.description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction variant="destructive" onClick={shown?.run}>
            {shown?.action}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
