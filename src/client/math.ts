import katex from 'katex'
import 'katex/dist/katex.min.css'

/** Typesets LaTeX into an element. Invalid input is shown in red, not thrown. */
export function renderMath(element: HTMLElement, tex: string, display: boolean): void {
  katex.render(tex, element, { displayMode: display, throwOnError: false })
}
