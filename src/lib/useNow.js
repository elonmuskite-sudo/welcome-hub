import { useEffect, useState } from 'react'

// One shared clock for relative timestamps. Reading `now` from a single interval
// keeps every visible timestamp ticking without starting a timer per component.
export function useNow(intervalMs = 30000) {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(id)
  }, [intervalMs])

  return now
}

export default useNow
