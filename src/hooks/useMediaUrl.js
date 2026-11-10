import { useEffect, useState } from 'react'
import { isR2Reference } from '../lib/storageReferences'
import { resolveMediaUrl } from '../lib/storageManager'

// Resolves an `r2://` media reference to a short-lived signed URL. Same-origin
// paths and http(s) URLs pass through unchanged, so this can be used for every
// media source without branching at the call site.
export function useMediaUrl(reference) {
  const [url, setUrl] = useState(() => (isR2Reference(reference) ? null : (reference || null)))

  useEffect(() => {
    if (!isR2Reference(reference)) {
      setUrl(reference || null)
      return undefined
    }
    let active = true
    resolveMediaUrl(reference)
      .then((resolved) => { if (active) setUrl(resolved || null) })
      .catch(() => { if (active) setUrl(null) })
    return () => { active = false }
  }, [reference])

  return url
}

export default useMediaUrl
