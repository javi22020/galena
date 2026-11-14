/** How the platform's shortcut modifier is written: "⌘K" or "Ctrl K". */
export const shortcut = (key: string) =>
  /Mac|iPhone|iPad/.test(navigator.platform) ? `⌘${key}` : `Ctrl ${key}`
