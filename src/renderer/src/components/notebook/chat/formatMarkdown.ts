/**
 * Preserve the line break before legal sub-items (a), b), c), ...).
 *
 * Markdown normally collapses a single newline inside a paragraph. Legal
 * answers often use `a)` / `b)` without a bullet marker, so without this the
 * whole list is rendered as one wall of text.
 *
 * While a code fence is still open during streaming, the split regex does not
 * match it yet, so `a)` lines inside the fence briefly get hard breaks; they
 * revert once the closing fence arrives. Render-only and transient.
 */
export function preserveLegalLineBreaks(markdown: string): string {
  // Do not touch fenced code blocks; split keeps them at odd indexes.
  return markdown
    .split(/(```[\s\S]*?```)/gu)
    .map((part, index) =>
      index % 2 === 1 ? part : part.replace(/\n(?=\s*[a-zà-ỹ]\)\s)/giu, '  \n')
    )
    .join('')
}
