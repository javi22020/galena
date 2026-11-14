import { motion, MotionConfig } from 'motion/react'
import { useEffect, type ReactNode } from 'react'
import { Toaster } from '@/components/ui/sonner'
import { TooltipProvider } from '@/components/ui/tooltip'
import { Home } from './components/Home'
import { Logo } from './components/Logo'
import { Workspace } from './components/Workspace'
import { sync, useStore } from './store'

export function App() {
  const phase = useStore((s) => s.phase)

  useEffect(() => void sync(), [])

  return (
    // With reduced motion, movement turns into plain fades.
    <MotionConfig reducedMotion="user">
      <TooltipProvider delayDuration={400}>
        {phase === 'loading' && (
          <Splash>
            <motion.div
              animate={{ opacity: [0.3, 1, 0.3] }}
              transition={{ duration: 1.6, ease: 'easeInOut', repeat: Infinity }}
            >
              <Logo className="size-12" />
            </motion.div>
          </Splash>
        )}
        {phase === 'home' && <Home />}
        {phase === 'workspace' && <Workspace />}

        <Toaster position="bottom-center" />
      </TooltipProvider>
    </MotionConfig>
  )
}

function Splash({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">{children}</div>
  )
}
