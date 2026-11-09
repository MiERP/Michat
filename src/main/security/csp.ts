/**
 * Single source of truth for the renderer Content-Security-Policy.
 * The main process sends it as a response header; Vite injects the same value
 * into index.html so `file://` loads keep the policy even without headers.
 */
export interface ContentSecurityPolicyOptions {
  isDev: boolean
}

export function buildContentSecurityPolicy({ isDev }: ContentSecurityPolicyOptions): string {
  const scriptSrc = isDev ? "script-src 'self' 'unsafe-inline'" : "script-src 'self'"
  const connectSrc = isDev
    ? "connect-src 'self' http://localhost:* ws://localhost:*"
    : "connect-src 'self'"

  return [
    "default-src 'self'",
    scriptSrc,
    // Tailwind v4 and component styles inject inline style tags.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "media-src 'self' blob:",
    connectSrc,
    "worker-src 'self' blob:",
    "object-src 'none'",
    "frame-src 'none'",
    "base-uri 'none'",
    "form-action 'none'"
  ].join('; ')
}
