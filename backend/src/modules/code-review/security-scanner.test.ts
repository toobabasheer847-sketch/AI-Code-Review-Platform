import assert from 'node:assert/strict'
import test from 'node:test'
import {
  MAX_SECURITY_SCAN_FILE_BYTES,
  MAX_SECURITY_SCAN_FILES,
  MAX_SECURITY_SCAN_TOTAL_BYTES,
  redactCredentialSource,
  scanCredentialPatterns,
  SecurityScanError,
} from './security-scanner'
import type { ReviewSourceFile } from '@/modules/github/github.service'

const source = (content: string, path = 'src/config.ts'): ReviewSourceFile[] => [
  { path, content },
]

test('detects credential-like literals and redacts all matched values from evidence', () => {
  const privateToken = `ghp_${'A'.repeat(32)}`
  const genericSecret = 'super-secret-value-123'
  const findings = scanCredentialPatterns(
    source(`const token = "${privateToken}"\nconst apiKey = "${genericSecret}";`)
  )

  assert.equal(findings.length, 2)
  assert.ok(findings.every((finding) => finding.source === 'STATIC_ANALYSIS'))
  const serialized = JSON.stringify(findings)
  assert.equal(serialized.includes(privateToken), false)
  assert.equal(serialized.includes(genericSecret), false)
  assert.match(findings[0]?.evidence ?? '', /\[REDACTED\]/)
  assert.match(findings[1]?.evidence ?? '', /\[REDACTED\]/)
})

test('ignores placeholders and ordinary configuration values', () => {
  const findings = scanCredentialPatterns(
    source([
      `const token = "ghp_${'A'.repeat(32)}"; // example`,
      'const apiKey = "your_api_key_here";',
      'const label = "ordinary application value";',
    ].join('\n'))
  )

  assert.equal(findings.length, 0)
})

test('redacts detected values before source is sent for AI review', () => {
  const token = `ghp_${'B'.repeat(32)}`
  const redacted = redactCredentialSource(source(`const token = "${token}";`))

  assert.equal(redacted[0]?.content.includes(token), false)
  assert.match(redacted[0]?.content ?? '', /\[REDACTED\]/)
})

test('rejects malformed source and inputs exceeding scanner resource limits', () => {
  assert.throws(
    () => scanCredentialPatterns([{ path: 'src/a.ts', content: null } as unknown as ReviewSourceFile]),
    SecurityScanError
  )
  assert.throws(
    () =>
      scanCredentialPatterns(
        Array.from({ length: MAX_SECURITY_SCAN_FILES + 1 }, (_, index) => ({
          path: `src/${index}.ts`,
          content: '',
        }))
      ),
    /file limit/
  )
  assert.throws(
    () => scanCredentialPatterns(source('x'.repeat(MAX_SECURITY_SCAN_FILE_BYTES + 1))),
    /file size limit/
  )
  assert.throws(
    () =>
      scanCredentialPatterns([
        ...Array.from({ length: 7 }, (_, index) => ({
          path: `src/${index}.ts`,
          content: 'x'.repeat(Math.floor(MAX_SECURITY_SCAN_TOTAL_BYTES / 6) + 1),
        })),
      ]),
    /total size limit/
  )
})

test('stops scanning when its time budget expires', () => {
  let clock = 0
  assert.throws(
    () =>
      scanCredentialPatterns(source('line one\nline two'), {
        now: () => clock++,
        maxDurationMs: 1,
      }),
    /timed out/
  )
})
