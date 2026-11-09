const sensitiveKey =
  /(?:password|token|secret|authorization|cookie|api[-_]?key|dsn|session|invitation|email|credential)/i

const sensitiveTextPatterns: Array<[RegExp, string]> = [
  [/postgres(?:ql)?:\/\/\S+/gi, '[redacted-database-url]'],
  [/rediss?:\/\/\S+/gi, '[redacted-redis-url]'],
  [/\b(?:sk|rk)_(?:test|live)_[A-Za-z0-9]+/g, '[redacted-stripe-key]'],
  [/\bBearer\s+\S+/gi, 'Bearer [redacted-token]'],
  [/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, '[redacted-jwt]'],
  [/([?&](?:token|password|api_key|invitation|code)=)[^&\s]+/gi, '$1[redacted]'],
]

export function redactSensitiveText(value: string): string {
  return sensitiveTextPatterns.reduce(
    (text, [pattern, replacement]) => text.replace(pattern, replacement),
    value
  )
}

export function redactLogValue(value: unknown, depth = 0): unknown {
  if (depth > 6) return '[redacted-depth]'
  if (typeof value === 'string') return redactSensitiveText(value)
  if (value instanceof Error) return serializeLogError(value)
  if (Array.isArray(value)) return value.map((entry) => redactLogValue(entry, depth + 1))
  if (!value || typeof value !== 'object') return value

  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [
      key,
      sensitiveKey.test(key) ? '[redacted]' : redactLogValue(entry, depth + 1),
    ])
  )
}

export function serializeLogError(error: unknown): { name: string; stack?: string } {
  if (!(error instanceof Error)) return { name: 'UnknownError' }
  return {
    name: error.name || 'Error',
    ...(error.stack ? { stack: redactSensitiveText(error.stack) } : {}),
  }
}

export function safeErrorName(value: unknown): string {
  return typeof value === 'string' && /^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(value)
    ? value
    : 'Error'
}
