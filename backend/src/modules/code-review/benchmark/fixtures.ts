import { z } from 'zod'

const benchmarkFindingSchema = z.object({
  file: z.string().min(1),
  line: z.number().int().positive(),
  severity: z.enum(['error', 'warning', 'info']).optional(),
  category: z.enum(['bug', 'security', 'performance', 'quality']),
  evidence: z.string().min(1),
})

const benchmarkFixtureSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  description: z.string().min(1),
  files: z
    .array(
      z.object({
        path: z.string().min(1),
        content: z.string(),
      })
    )
    .min(1),
  expectedFindings: z.array(benchmarkFindingSchema),
  mockResponse: z.string(),
})

const benchmarkDatasetSchema = z.object({
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  fixtures: z.array(benchmarkFixtureSchema),
})

export type BenchmarkExpectedFinding = z.infer<typeof benchmarkFindingSchema>
export type BenchmarkFixture = z.infer<typeof benchmarkFixtureSchema>
export type BenchmarkDataset = z.infer<typeof benchmarkDatasetSchema>

export function validateBenchmarkDataset(value: unknown): BenchmarkDataset {
  const dataset = benchmarkDatasetSchema.parse(value)
  const fixtureIds = new Set<string>()

  for (const fixture of dataset.fixtures) {
    if (fixtureIds.has(fixture.id)) {
      throw new Error('Benchmark fixture IDs must be unique')
    }
    fixtureIds.add(fixture.id)

    const files = new Map<string, string>()
    for (const file of fixture.files) {
      if (files.has(file.path)) {
        throw new Error(`Benchmark fixture ${fixture.id} has duplicate file paths`)
      }
      files.set(file.path, file.content)
    }

    for (const expected of fixture.expectedFindings) {
      const content = files.get(expected.file)
      const lines = content?.split(/\r?\n/)
      const line = lines?.[expected.line - 1]
      if (
        line === undefined ||
        !line.toLowerCase().includes(expected.evidence.trim().toLowerCase())
      ) {
        throw new Error(`Benchmark fixture ${fixture.id} has an invalid expected finding location`)
      }
    }
  }

  return dataset
}

export const benchmarkDataset: BenchmarkDataset = validateBenchmarkDataset({
  version: '1.1.0',
  fixtures: [
    {
      id: 'null-property-access',
      description: 'A value from an optional user profile is dereferenced without a guard.',
      files: [
        {
          path: 'src/profile.ts',
          content: [
            'export function displayName(user: { profile?: { name: string } }) {',
            '  return user.profile.name',
            '}',
          ].join('\n'),
        },
      ],
      expectedFindings: [
        {
          file: 'src/profile.ts',
          line: 2,
          severity: 'error',
          category: 'bug',
          evidence: 'user.profile.name',
        },
      ],
      mockResponse: JSON.stringify({
        summary: 'A missing profile can cause a runtime exception.',
        findings: [
          {
            file: 'src/profile.ts',
            line: 2,
            severity: 'error',
            category: 'bug',
            title: 'Optional profile is dereferenced',
            message: 'The profile can be undefined before its name is accessed.',
            impact: 'Users without a profile can trigger a runtime exception.',
            evidence: 'user.profile.name',
            suggestions: ['Guard the profile before reading its name.'],
          },
        ],
      }),
    },
    {
      id: 'sql-string-concatenation',
      description: 'Untrusted input is concatenated into a synthetic SQL query.',
      files: [
        {
          path: 'src/users.ts',
          content: [
            'export function findUser(db: { query: (sql: string) => unknown }, name: string) {',
            '  return db.query("SELECT * FROM users WHERE name = \'" + name + "\'")',
            '}',
          ].join('\n'),
        },
      ],
      expectedFindings: [
        {
          file: 'src/users.ts',
          line: 2,
          severity: 'error',
          category: 'security',
          evidence: 'db.query(',
        },
      ],
      mockResponse: JSON.stringify({
        summary: 'The query incorporates untrusted input.',
        findings: [
          {
            file: 'src/users.ts',
            line: 2,
            severity: 'error',
            category: 'security',
            title: 'SQL injection risk',
            message: 'The query concatenates an untrusted name into SQL.',
            impact: 'An attacker may alter the executed query through the supplied name.',
            evidence: 'db.query("SELECT * FROM users WHERE name = \'" + name + "\'")',
            suggestions: ['Use a parameterized query.'],
          },
        ],
      }),
    },
    {
      id: 'swallowed-error',
      description: 'A caught exception is silently ignored instead of being handled or reported.',
      files: [
        {
          path: 'src/load.ts',
          content: [
            'export async function load() {',
            '  try {',
            '    return await fetchData()',
            '  } catch (error) {',
            '    return undefined',
            '  }',
            '}',
          ].join('\n'),
        },
      ],
      expectedFindings: [
        {
          file: 'src/load.ts',
          line: 5,
          severity: 'warning',
          category: 'bug',
          evidence: 'return undefined',
        },
      ],
      mockResponse: JSON.stringify({
        summary: 'No issue was reported.',
        findings: [],
      }),
    },
    {
      id: 'off-by-one-boundary',
      description: 'The final valid index is excluded by a strict upper-bound check.',
      files: [
        {
          path: 'src/items.ts',
          content: [
            'export function getItem(items: string[], index: number) {',
            '  if (index < 0 || index >= items.length - 1) return undefined',
            '  return items[index]',
            '}',
          ].join('\n'),
        },
      ],
      expectedFindings: [
        {
          file: 'src/items.ts',
          line: 2,
          severity: 'warning',
          category: 'bug',
          evidence: 'index',
        },
      ],
      mockResponse: JSON.stringify({
        summary: 'The range check excludes the final item.',
        findings: [
          {
            file: 'src/items.ts',
            line: 3,
            severity: 'warning',
            category: 'bug',
            title: 'The last item cannot be read',
            message: 'The preceding bounds check rejects the last valid index.',
            impact: 'Callers cannot retrieve the final item in the array.',
            evidence: 'return items[index]',
            suggestions: ['Reject indexes greater than or equal to items.length.'],
          },
        ],
      }),
    },
    {
      id: 'clean-pure-function',
      description: 'A straightforward total function should not produce a finding.',
      files: [
        {
          path: 'src/total.ts',
          content:
            'export function total(values: number[]) { return values.reduce((sum, value) => sum + value, 0) }',
        },
      ],
      expectedFindings: [],
      mockResponse: JSON.stringify({
        summary: 'No actionable issue was found.',
        findings: [],
      }),
    },
    {
      id: 'duplicate-provider-findings',
      description: 'The provider repeats the same valid finding twice.',
      files: [
        {
          path: 'src/divide.ts',
          content: 'export function divide(value: number) { return value / 0 }',
        },
      ],
      expectedFindings: [
        {
          file: 'src/divide.ts',
          line: 1,
          severity: 'error',
          category: 'bug',
          evidence: 'value / 0',
        },
      ],
      mockResponse: JSON.stringify({
        summary: 'A division by zero is present.',
        findings: [
          {
            file: 'src/divide.ts',
            line: 1,
            severity: 'error',
            category: 'bug',
            title: 'Division by zero',
            message: 'The value is always divided by zero.',
            impact: 'The function returns a non-finite numeric result.',
            evidence: 'value / 0',
            suggestions: ['Validate the divisor.'],
          },
          {
            file: 'src/divide.ts',
            line: 1,
            severity: 'error',
            category: 'bug',
            title: 'Division by zero',
            message: 'The value is always divided by zero.',
            impact: 'The function returns a non-finite numeric result.',
            evidence: 'value / 0',
            suggestions: ['Validate the divisor.'],
          },
        ],
      }),
    },
    {
      id: 'irrelevant-finding',
      description: 'A provider finding is syntactically valid but claims a problem in clean code.',
      files: [
        {
          path: 'src/constant.ts',
          content: 'export const enabled = true',
        },
      ],
      expectedFindings: [],
      mockResponse: JSON.stringify({
        summary: 'A finding was reported.',
        findings: [
          {
            file: 'src/constant.ts',
            line: 1,
            severity: 'info',
            category: 'quality',
            title: 'Avoid boolean constants',
            message: 'This constant is reported as an unnecessary abstraction.',
            impact: 'No concrete user or runtime impact is supported by the supplied code.',
            evidence: 'export const enabled = true',
            suggestions: ['Remove the constant.'],
          },
        ],
      }),
    },
    {
      id: 'dynamic-code-execution',
      description: 'eval is called with a function argument. The deterministic scanner should report it without a model finding.',
      files: [
        {
          path: 'src/run.ts',
          content: ['export function run(code: string) {', '  return eval(code)', '}'].join('\n'),
        },
      ],
      expectedFindings: [
        {
          file: 'src/run.ts',
          line: 2,
          severity: 'error',
          category: 'security',
          evidence: 'eval(code)',
        },
      ],
      mockResponse: JSON.stringify({ summary: 'No model finding.', findings: [] }),
    },
    {
      id: 'dynamic-html-assignment',
      description: 'innerHTML is assigned from a parameter.',
      files: [
        {
          path: 'src/fill.ts',
          content: [
            'export function fill(element: { innerHTML: string }, markup: string) {',
            '  element.innerHTML = markup',
            '}',
          ].join('\n'),
        },
      ],
      expectedFindings: [
        {
          file: 'src/fill.ts',
          line: 2,
          severity: 'error',
          category: 'security',
          evidence: 'element.innerHTML = markup',
        },
      ],
      mockResponse: JSON.stringify({ summary: 'No model finding.', findings: [] }),
    },
    {
      id: 'query-inside-loop',
      description: 'A parameterized query is awaited once per loop item.',
      files: [
        {
          path: 'src/items-query.ts',
          content: [
            'export async function loadAll(ids: string[], db: { query: (sql: string, params: string[]) => Promise<unknown> }) {',
            '  const rows = []',
            '  for (const id of ids) {',
            "    rows.push(await db.query('SELECT * FROM items WHERE id = $1', [id]))",
            '  }',
            '  return rows',
            '}',
          ].join('\n'),
        },
      ],
      expectedFindings: [
        {
          file: 'src/items-query.ts',
          line: 4,
          severity: 'warning',
          category: 'performance',
          evidence: 'db.query',
        },
      ],
      mockResponse: JSON.stringify({ summary: 'No model finding.', findings: [] }),
    },
    {
      id: 'assignment-in-condition',
      description: 'A condition assigns null instead of comparing it.',
      files: [
        {
          path: 'src/save.ts',
          content: [
            'export function save(user: { id: string } | null) {',
            '  if (user = null) return false',
            '  return Boolean(user)',
            '}',
          ].join('\n'),
        },
      ],
      expectedFindings: [
        {
          file: 'src/save.ts',
          line: 2,
          severity: 'error',
          category: 'bug',
          evidence: 'user = null',
        },
      ],
      mockResponse: JSON.stringify({ summary: 'No model finding.', findings: [] }),
    },
    {
      id: 'confirmed-critical-normalization',
      description: 'A high-confidence critical model finding is kept and normalized to the legacy error severity.',
      files: [
        {
          path: 'src/ratio.ts',
          content: ['export function ratio(value: number) {', '  return value / 0', '}'].join('\n'),
        },
      ],
      expectedFindings: [
        {
          file: 'src/ratio.ts',
          line: 2,
          severity: 'error',
          category: 'bug',
          evidence: 'value / 0',
        },
      ],
      mockResponse: JSON.stringify({
        summary: 'Division by zero is demonstrated.',
        findings: [
          {
            file: 'src/ratio.ts',
            line: 2,
            severity: 'critical',
            riskLevel: 'critical',
            category: 'bug',
            issueClass: 'logic',
            title: 'Division by zero',
            message: 'The divisor is the constant zero.',
            impact: 'The function returns a non-finite numeric result.',
            evidence: 'value / 0',
            confidence: 0.95,
            suggestions: ['Reject a zero divisor before dividing.'],
          },
        ],
      }),
    },
    {
      id: 'static-and-provider-duplicate',
      description: 'The model and the deterministic scanner report the same eval call.',
      files: [
        {
          path: 'src/repeat-eval.ts',
          content: ['export function repeat(code: string) {', '  return eval(code)', '}'].join('\n'),
        },
      ],
      expectedFindings: [
        {
          file: 'src/repeat-eval.ts',
          line: 2,
          severity: 'error',
          category: 'security',
          evidence: 'eval(code)',
        },
      ],
      mockResponse: JSON.stringify({
        summary: 'Dynamic execution is present.',
        findings: [
          {
            file: 'src/repeat-eval.ts',
            line: 2,
            severity: 'error',
            category: 'security',
            title: 'Dynamic code execution',
            message: 'eval is called with the supplied code.',
            impact: 'The argument runs with the privileges of this process.',
            evidence: 'return eval(code)',
            suggestions: ['Call a specific function instead.'],
            confidence: 0.93,
          },
        ],
      }),
    },
    {
      id: 'parameterized-query-clean',
      description: 'A bound SQL parameter is not a dynamic SQL finding.',
      files: [
        {
          path: 'src/lookup.ts',
          content: [
            'export function findUser(db: { query: (sql: string, params: string[]) => unknown }, name: string) {',
            "  return db.query('SELECT * FROM users WHERE name = $1', [name])",
            '}',
          ].join('\n'),
        },
      ],
      expectedFindings: [],
      mockResponse: JSON.stringify({ summary: 'No issue was found.', findings: [] }),
    },
    {
      id: 'tagged-sql-clean',
      description: 'A tagged SQL template is not reported as concatenated SQL.',
      files: [
        {
          path: 'src/tagged-sql.ts',
          content: [
            'export function findUser(sql: (parts: TemplateStringsArray, ...values: unknown[]) => unknown, id: string) {',
            '  return sql`SELECT * FROM users WHERE id = ${id}`',
            '}',
          ].join('\n'),
        },
      ],
      expectedFindings: [],
      mockResponse: JSON.stringify({ summary: 'No issue was found.', findings: [] }),
    },
    {
      id: 'regexp-exec-clean',
      description: 'RegExp.exec is not a shell command.',
      files: [
        {
          path: 'src/match.ts',
          content: [
            'export function match(pattern: RegExp, value: string) {',
            '  return pattern.exec(value)',
            '}',
          ].join('\n'),
        },
      ],
      expectedFindings: [],
      mockResponse: JSON.stringify({ summary: 'No issue was found.', findings: [] }),
    },
    {
      id: 'literal-html-clean',
      description: 'A fixed innerHTML string is not reported.',
      files: [
        {
          path: 'src/label.ts',
          content: [
            'export function label(element: { innerHTML: string }) {',
            "  element.innerHTML = 'ready'",
            '}',
          ].join('\n'),
        },
      ],
      expectedFindings: [],
      mockResponse: JSON.stringify({ summary: 'No issue was found.', findings: [] }),
    },
    {
      id: 'logged-catch-clean',
      description: 'A catch that logs and rethrows is not a swallowed error.',
      files: [
        {
          path: 'src/logged.ts',
          content: [
            'export function load(read: () => string) {',
            '  try {',
            '    return read()',
            '  } catch (error) {',
            '    console.error(error)',
            '    throw error',
            '  }',
            '}',
          ].join('\n'),
        },
      ],
      expectedFindings: [],
      mockResponse: JSON.stringify({ summary: 'No issue was found.', findings: [] }),
    },
    {
      id: 'low-confidence-withheld',
      description: 'A model finding below 0.60 is withheld even though its excerpt matches the source.',
      files: [
        {
          path: 'src/ready.ts',
          content: 'export const ready = true',
        },
      ],
      expectedFindings: [],
      mockResponse: JSON.stringify({
        summary: 'A speculative note was withheld.',
        findings: [
          {
            file: 'src/ready.ts',
            line: 1,
            severity: 'info',
            category: 'quality',
            title: 'Boolean constant',
            message: 'The constant is reported without a demonstrated defect.',
            impact: 'No runtime impact is shown by the supplied line.',
            evidence: 'export const ready = true',
            confidence: 0.4,
            suggestions: ['Leave the constant in place.'],
          },
        ],
      }),
    },
  ],
})
