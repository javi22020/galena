import { Moon, Sun } from 'lucide-react'
import { motion } from 'motion/react'
import { spring } from '@/lib/motion'
import { toggleTheme, useTheme } from '../theme'
import { IconButton } from './IconButton'

const shown = { y: 0, rotate: 0, opacity: 1 }

/**
 * Shows the theme a click switches to: the moon by day, the sun by night.
 * They trade places, one leaving upwards as the other rises.
 */
export function ThemeToggle() {
  const dark = useTheme((s) => s.theme === 'dark')
  return (
    <IconButton
      label={dark ? 'Switch to light theme' : 'Switch to dark theme'}
      className="relative overflow-hidden"
      onClick={toggleTheme}
    >
      <motion.span
        className="absolute"
        initial={false}
        animate={dark ? shown : { y: -24, rotate: -90, opacity: 0 }}
        transition={spring}
      >
        <Sun />
      </motion.span>
      <motion.span
        className="absolute"
        initial={false}
        animate={dark ? { y: 24, rotate: 90, opacity: 0 } : shown}
        transition={spring}
      >
        <Moon />
      </motion.span>
    </IconButton>
  )
}
