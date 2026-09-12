/** Host timestamps are epoch milliseconds; display them in the phone's timezone. */
export function formatChatTimestamp(timestamp: number, now = new Date()): { short: string; full: string } | null {
  if (!Number.isFinite(timestamp) || timestamp <= 0) return null
  const date = new Date(timestamp)
  if (!Number.isFinite(date.getTime())) return null
  const pad = (value: number) => String(value).padStart(2, '0')
  const day = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
  const time = `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
  const full = `${day} ${time}`
  return { short: date.toDateString() === now.toDateString() ? time : full, full }
}
