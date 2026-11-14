import { ArrowLeft, ArrowRight, FolderOpen, FolderPlus, LoaderCircle } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { collapse, enter, stagger } from '@/lib/motion'
import { createVault, openVault, setModal, useStore } from '../store'
import { FolderPicker } from './FolderPicker'
import { Logo } from './Logo'
import { ThemeToggle } from './ThemeToggle'

/** Where a vault is chosen; shown when the CLI was started without a path. */
export function Home() {
  const recents = useStore((s) => s.recents)
  const vault = useStore((s) => s.vault)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const open = async (target: string) => {
    setBusy(true)
    setError('')
    try {
      await openVault(target)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex h-full flex-col items-center overflow-y-auto bg-[radial-gradient(var(--border)_1px,transparent_1px)] bg-size-[22px_22px] px-4">
      <div className="flex items-center self-stretch px-2 py-4">
        {vault && (
          <Button
            variant="ghost"
            className="text-muted-foreground"
            onClick={() => useStore.setState({ phase: 'workspace' })}
          >
            <ArrowLeft />
            Back to {vault.name}
          </Button>
        )}
        <span className="flex-1" />
        <ThemeToggle />
      </div>

      <motion.div
        className="mt-[min(110px,10vh)] flex w-full max-w-[460px] flex-col gap-7 pb-10"
        variants={stagger(0.08)}
        initial="hidden"
        animate="show"
      >
        <motion.div variants={enter} className="flex flex-col items-center gap-3.5 text-center">
          <Logo className="size-14" />
          <h1 className="text-[28px] leading-tight font-semibold tracking-[-0.025em]">Galena</h1>
          <p className="-mt-2 text-muted-foreground">Open a folder of Markdown notes.</p>
        </motion.div>

        <motion.div variants={enter}>
          <div className="flex gap-2">
            <Button className="h-10 flex-1 rounded-lg" disabled={busy} onClick={() => setModal('folders')}>
              {busy ? <LoaderCircle className="animate-spin" /> : <FolderOpen />}
              {busy ? 'Opening' : 'Choose a folder'}
            </Button>
            <Button
              variant="outline"
              className="h-10 flex-1 rounded-lg"
              disabled={busy}
              onClick={() => setModal('new-vault')}
            >
              <FolderPlus />
              Create a vault
            </Button>
          </div>
          <AnimatePresence>
            {error && (
              <motion.p {...collapse} className="overflow-hidden text-[13px] wrap-anywhere text-destructive">
                <span className="block pt-2">{error}</span>
              </motion.p>
            )}
          </AnimatePresence>
        </motion.div>

        {recents.length > 0 && (
          <motion.section variants={enter} className="flex flex-col gap-2">
            <h2 className="mx-1 text-xs font-medium text-muted-foreground">Recent vaults</h2>
            <motion.div
              variants={stagger(0.05)}
              className="flex flex-col rounded-xl border bg-card p-1 shadow-xs"
            >
              {recents.map((recent) => {
                const name = recent.split(/[\\/]/).pop() || recent
                return (
                  <motion.button
                    key={recent}
                    variants={enter}
                    disabled={busy}
                    onClick={() => open(recent)}
                    className="group flex items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors outline-none hover:bg-accent focus-visible:bg-accent disabled:pointer-events-none disabled:opacity-50"
                  >
                    <span className="flex size-8 shrink-0 items-center justify-center rounded-[9px] border bg-muted text-[13px] font-semibold uppercase">
                      {name[0]}
                    </span>
                    <span className="flex min-w-0 flex-1 flex-col leading-snug">
                      <span className="truncate font-medium">{name}</span>
                      <span className="truncate font-mono text-xs text-muted-foreground">{recent}</span>
                    </span>
                    <ArrowRight className="size-4 opacity-40 transition-[translate,opacity] duration-300 ease-out-expo group-hover:translate-x-[3px] group-hover:opacity-100" />
                  </motion.button>
                )
              })}
            </motion.div>
          </motion.section>
        )}

        <motion.p variants={enter} className="text-center text-xs text-muted-foreground">
          Serving on <span className="font-mono">{location.hostname}</span> · Ctrl+C in the terminal stops
          Galena
        </motion.p>
      </motion.div>

      <FolderPicker mode="open" onPick={open} />
      <FolderPicker mode="create" onCreate={createVault} />
    </div>
  )
}
