/**
 * The fonts a note can be written in. They come with Galena (see the
 * `@fontsource-variable` imports in client/styles.css), so they work offline;
 * each one has a variable weight and a true italic. A browser only downloads
 * the fonts that are actually shown.
 */

const sans = 'ui-sans-serif, system-ui, sans-serif'
const mono = "ui-monospace, 'SF Mono', Menlo, Consolas, monospace"

/** For headings and the text around them. */
export const textFonts = {
  geist: { name: 'Geist', family: `'Geist Variable', ${sans}` },
  inter: { name: 'Inter', family: `'Inter Variable', ${sans}` },
  lora: { name: 'Lora', family: `'Lora Variable', ui-serif, Georgia, serif` },
  nunito: { name: 'Nunito', family: `'Nunito Variable', ${sans}` },
} as const

/** For inline code and code blocks. */
export const codeFonts = {
  'geist-mono': { name: 'Geist Mono', family: `'Geist Mono Variable', ${mono}` },
  'jetbrains-mono': { name: 'JetBrains Mono', family: `'JetBrains Mono Variable', ${mono}` },
  'source-code-pro': { name: 'Source Code Pro', family: `'Source Code Pro Variable', ${mono}` },
} as const

export type TextFont = keyof typeof textFonts
export type CodeFont = keyof typeof codeFonts
