import { useEffect, useState } from 'react'

/** Keep completion badges expiring even if no new host events arrive. */
export function useActivityClock() {
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 15000)
    return () => clearInterval(timer)
  }, [])
  return Math.max(now, Date.now())
}
