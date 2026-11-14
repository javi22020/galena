const mac = /Mac|iPhone|iPad/.test(navigator.platform)

/** How the platform's shortcut modifier is written: "⌘K" or "Ctrl K". */
export const shortcut = (key: string) => (mac ? `⌘${key}` : `Ctrl ${key}`)

/** How Alt is written: "⌥C" or "Alt C". */
export const altShortcut = (key: string) => (mac ? `⌥${key}` : `Alt ${key}`)
