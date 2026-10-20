/**
 * ActivityTracker
 * Theo dõi thời điểm hoạt động cuối của người dùng để background queue
 * biết khi nào app "idle" (tránh tranh chấp llama-server khi user đang chat).
 */

let lastActivity = 0

export function markActive(): void {
  lastActivity = Date.now()
}

export function isIdle(idleMs: number): boolean {
  return Date.now() - lastActivity >= idleMs
}

export function getLastActivity(): number {
  return lastActivity
}
