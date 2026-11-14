import { create } from 'zustand'

export type Theme = 'light' | 'dark'

const KEY = 'galena.theme'
const system = matchMedia('(prefers-color-scheme: dark)')
const root = document.documentElement

/** The user's choice, if they made one; otherwise the theme follows the system. */
function chosen(): Theme | null {
  const value = localStorage.getItem(KEY)
  return value === 'light' || value === 'dark' ? value : null
}

const current = (): Theme => chosen() ?? (system.matches ? 'dark' : 'light')

export const useTheme = create(() => ({ theme: current() }))

let timer: number | undefined

function show(theme: Theme): void {
  if (theme === useTheme.getState().theme) return
  // Colours cross-fade only while the theme changes; see `.theme-switching`.
  root.classList.add('theme-switching')
  root.classList.toggle('dark', theme === 'dark')
  useTheme.setState({ theme })
  clearTimeout(timer)
  timer = window.setTimeout(() => root.classList.remove('theme-switching'), 300)
}

export function toggleTheme(): void {
  const next = useTheme.getState().theme === 'dark' ? 'light' : 'dark'
  localStorage.setItem(KEY, next)
  show(next)
}

root.classList.toggle('dark', current() === 'dark')
system.addEventListener('change', () => show(current()))
