type LogStorage = { getString(key: string): string | undefined; set(key: string, value: string): void }

/** Bounded in-memory tail, persisted at most once per second during normal traffic. */
export function createBufferedLog(storage: LogStorage, key: string, maxChars: number) {
  let text: string | undefined
  let dirty = false
  let timer: ReturnType<typeof setTimeout> | undefined
  const bound = (value: string) => {
    if (value.length <= maxChars) return value
    const tail = value.slice(-maxChars)
    return tail.slice(tail.indexOf('\n') + 1)
  }
  const read = () => {
    if (text === undefined) {
      try { text = bound(storage.getString(key) ?? '') } catch { text = '' }
    }
    return text
  }
  const flush = () => {
    if (timer !== undefined) clearTimeout(timer)
    timer = undefined
    if (!dirty) return
    try { storage.set(key, read()); dirty = false } catch { /* Logging must not interrupt the app. */ }
  }
  return {
    read,
    flush,
    append(line: string, immediate = false) {
      text = bound(read() + line)
      dirty = true
      if (immediate) flush()
      else if (timer === undefined) timer = setTimeout(flush, 1000)
    },
    clear() { text = ''; dirty = true; flush() },
  }
}
