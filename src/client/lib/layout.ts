import { useCallback, useSyncExternalStore } from 'react'

// Below these widths a side panel no longer fits beside the editor and is laid
// over it instead. They are Tailwind's `xl` and `md` breakpoints, so that CSS
// written with `max-xl:` and `max-md:` agrees with them.

/** The agent panel is laid over the editor. */
export const AGENT_OVERLAY = '(width < 1280px)'
/** The explorer is laid over the editor too. */
export const EXPLORER_OVERLAY = '(width < 768px)'

/** Whether a media query matches, following its changes. */
export function useMediaQuery(query: string): boolean {
  // The same function on every render, or React would subscribe again each time.
  const subscribe = useCallback(
    (onChange: () => void) => {
      const list = matchMedia(query)
      list.addEventListener('change', onChange)
      return () => list.removeEventListener('change', onChange)
    },
    [query],
  )
  return useSyncExternalStore(subscribe, () => matchMedia(query).matches)
}
