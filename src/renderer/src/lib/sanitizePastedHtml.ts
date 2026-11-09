import DOMPurify from 'dompurify'

const CONFIG = {
  USE_PROFILES: { html: true },
  FORBID_TAGS: ['script', 'style', 'iframe', 'object', 'embed', 'link', 'meta'],
  FORBID_ATTR: ['style'],
  ALLOW_DATA_ATTR: false
}

/**
 * Sanitize clipboard HTML before ProseMirror parses it. The editor dependency
 * is patched, but paste handling is a browser boundary and deserves its own
 * defense-in-depth layer.
 */
export function sanitizePastedHtml(html: string): string {
  return DOMPurify.sanitize(html, CONFIG) as unknown as string
}
