import type { Transition, Variants } from 'motion/react'

/** The curve shared by everything that moves; see also `--ease-out-expo` in styles.css. */
export const outExpo = [0.16, 1, 0.3, 1] as const

/** Hover-sized changes: highlights, small reveals. */
export const quick: Transition = { duration: 0.3, ease: outExpo }

/** Panels and anything else that travels across the screen. */
export const smooth: Transition = { duration: 0.5, ease: outExpo }

/** Overshoots a little; for icons that swap in place. */
export const spring: Transition = { type: 'spring', duration: 0.5, bounce: 0.45 }

/**
 * Rise-and-focus entrance. Give a parent `stagger()` and the labels below to
 * cascade its children, or spread `enterProps` on a single element.
 */
export const enter: Variants = {
  hidden: { opacity: 0, y: 8, filter: 'blur(2px)' },
  show: { opacity: 1, y: 0, filter: 'blur(0px)', transition: { duration: 0.6, ease: outExpo } },
}

export const enterProps = { variants: enter, initial: 'hidden', animate: 'show' } as const

export function stagger(step = 0.035, delay = 0): Variants {
  return { show: { transition: { staggerChildren: step, delayChildren: delay } } }
}

/**
 * Opens and closes a block by animating its height; needs `overflow-hidden`.
 * Children with `enter` variants cascade in as it opens.
 */
export const collapse = {
  variants: {
    hidden: { height: 0, opacity: 0, transition: quick },
    show: { height: 'auto', opacity: 1, transition: { ...quick, staggerChildren: 0.035 } },
  },
  initial: 'hidden',
  animate: 'show',
  exit: 'hidden',
} as const
