const localHosts = new Set(['localhost', '127.0.0.1', '::1'])

export function percentile(values: number[], ratio: number): number | null {
  if (values.length === 0 || ratio <= 0 || ratio > 1) return null
  const sorted = [...values].sort((left, right) => left - right)
  const index = Math.min(sorted.length - 1, Math.ceil(ratio * sorted.length) - 1)
  return sorted[Math.max(0, index)] ?? null
}

export function assertLoadTarget(raw: string, allowRemote = false): URL {
  let target: URL
  try {
    target = new URL(raw)
  } catch {
    throw new Error('Load test target must be a valid URL.')
  }
  if (target.username || target.password) {
    throw new Error('Load test target must not include credentials.')
  }
  const local = localHosts.has(target.hostname.replace(/^\[|\]$/g, ''))
  if (local) {
    if (target.protocol !== 'http:' && target.protocol !== 'https:') {
      throw new Error('Load test target must use HTTP or HTTPS.')
    }
    return target
  }
  if (!allowRemote || target.protocol !== 'https:') {
    throw new Error('Remote load tests require an explicit HTTPS staging target.')
  }
  if (/(^|\.)prod(uction)?\./i.test(target.hostname) || /production/i.test(target.hostname)) {
    throw new Error('Load tests must not target a production hostname.')
  }
  return target
}
