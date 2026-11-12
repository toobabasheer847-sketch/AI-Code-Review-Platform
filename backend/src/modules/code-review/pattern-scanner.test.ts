import assert from 'node:assert/strict'
import test from 'node:test'

import { scanCodePatterns } from './pattern-scanner'

test('reports dynamic SQL, eval, innerHTML, loop queries, and assignment with evidence', () => {
  const result = scanCodePatterns([
    {
      path: 'src/users.ts',
      content: [
        'export function findUser(db: { query: (sql: string) => unknown }, name: string) {',
        '  return db.query("SELECT * FROM users WHERE name = \'" + name + "\'")',
        '}',
      ].join('\n'),
    },
    {
      path: 'src/run.ts',
      content: 'export function run(code: string) {\n  return eval(code)\n}\n',
    },
    {
      path: 'src/fill.ts',
      content: 'export function fill(element: { innerHTML: string }, markup: string) {\n  element.innerHTML = markup\n}\n',
    },
    {
      path: 'src/load.ts',
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
    {
      path: 'src/save.ts',
      content: 'export function save(user: { id: string } | null) {\n  if (user = null) return false\n  return Boolean(user)\n}\n',
    },
  ])

  const sql = result.findings.find((finding) => finding.file === 'src/users.ts')
  assert.equal(sql?.issueClass, 'data_access')
  assert.equal(sql?.category, 'security')
  assert.equal(sql?.disposition, 'confirmed')
  assert.equal(sql?.confidence, 0.9)
  assert.match(sql?.evidence ?? '', /SELECT/)

  const execution = result.findings.find((finding) => finding.file === 'src/run.ts')
  assert.equal(execution?.issueClass, 'security')
  assert.equal(execution?.riskLevel, 'high')
  assert.equal(execution?.disposition, 'confirmed')

  const html = result.findings.find((finding) => finding.file === 'src/fill.ts')
  assert.equal(html?.disposition, 'potential')
  assert.equal(html?.confidence !== null && html.confidence < 0.85, true)

  const loop = result.findings.find((finding) => finding.file === 'src/load.ts')
  assert.equal(loop?.category, 'performance')
  assert.equal(loop?.issueClass, 'data_access')
  assert.equal(loop?.disposition, 'potential')
  assert.equal(loop?.line, 4)

  const assignment = result.findings.find((finding) => finding.file === 'src/save.ts')
  assert.equal(assignment?.issueClass, 'logic')
  assert.equal(assignment?.severity, 'error')
  assert.equal(assignment?.disposition, 'confirmed')
})

test('does not report parameterized SQL, tagged templates, regexp exec, literal HTML, logged catches, or speculative races', () => {
  const result = scanCodePatterns([
    {
      path: 'src/lookup.ts',
      content: "export function findUser(db: { query: (sql: string, params: string[]) => unknown }, name: string) {\n  return db.query('SELECT * FROM users WHERE name = $1', [name])\n}\n",
    },
    {
      path: 'src/tagged.ts',
      content: 'export function findUser(sql: (parts: TemplateStringsArray, ...values: unknown[]) => unknown, id: string) {\n  return sql`SELECT * FROM users WHERE id = ${id}`\n}\n',
    },
    {
      path: 'src/match.ts',
      content: 'export function match(pattern: RegExp, value: string) {\n  return pattern.exec(value)\n}\n',
    },
    {
      path: 'src/label.ts',
      content: "export function label(element: { innerHTML: string }) {\n  element.innerHTML = 'ready'\n}\n",
    },
    {
      path: 'src/logged.ts',
      content: 'export function load(read: () => string) {\n  try {\n    return read()\n  } catch (error) {\n    console.error(error)\n    throw error\n  }\n}\n',
    },
    {
      path: 'src/transfer.ts',
      content: 'export async function transfer(read: () => Promise<number>, write: (value: number) => Promise<void>, amount: number) {\n  const balance = await read()\n  await write(balance - amount)\n}\n',
    },
    {
      path: 'src/auth.ts',
      content: 'export function update(req: { params: { id: string } }) {\n  return req.params.id\n}\n',
    },
  ])

  assert.deepEqual(result.findings, [])
})

test('reports command execution, discarded promise catches, listener leaks, and unchecked fetch bodies', () => {
  const result = scanCodePatterns([
    {
      path: 'src/shell.ts',
      content: 'export function run(command: string) {\n  return exec(command)\n}\n',
    },
    {
      path: 'src/promise.ts',
      content: 'export function load(read: { catch: (handler: () => void) => void }) {\n  read.catch(() => {})\n}\n',
    },
    {
      path: 'src/listen.ts',
      content: "export function watch(onResize: () => void) {\n  window.addEventListener('resize', onResize)\n}\n",
    },
    {
      path: 'src/cleanup.ts',
      content: "export function watch(onResize: () => void) {\n  window.addEventListener('resize', onResize)\n  return () => window.removeEventListener('resize', onResize)\n}\n",
    },
    {
      path: 'src/fetch.ts',
      content: 'export async function load(url: string) {\n  const response = await fetch(url)\n  return response.json()\n}\n',
    },
    {
      path: 'src/checked.ts',
      content: 'export async function load(url: string) {\n  const response = await fetch(url)\n  if (!response.ok) throw new Error("Request failed")\n  return response.json()\n}\n',
    },
  ])

  assert.equal(result.findings.find((finding) => finding.file === 'src/shell.ts')?.issueClass, 'security')
  assert.equal(result.findings.find((finding) => finding.file === 'src/promise.ts')?.issueClass, 'error_handling')
  assert.equal(result.findings.find((finding) => finding.file === 'src/listen.ts')?.issueClass, 'resource_management')
  assert.equal(result.findings.some((finding) => finding.file === 'src/cleanup.ts'), false)
  assert.equal(result.findings.find((finding) => finding.file === 'src/fetch.ts')?.issueClass, 'api_contract')
  assert.equal(result.findings.some((finding) => finding.file === 'src/checked.ts'), false)
})

test('limits pattern findings to changed lines and records unsupported files', () => {
  const changed = scanCodePatterns([
    {
      path: 'src/run.ts',
      content: 'export function run(code: string) {\n  return eval(code)\n}\n',
      changedLines: [1],
    },
    { path: 'src/app.py', content: 'def run(code):\n    return eval(code)\n' },
  ])

  assert.equal(changed.findings.length, 0)
  assert.match(changed.limitations.join(' '), /unsupported file/)
})

test('stops pattern checks when the time budget is already exhausted', () => {
  let tick = 0
  const result = scanCodePatterns(
    [{ path: 'src/run.ts', content: 'export function run(code: string) {\n  return eval(code)\n}\n' }],
    { now: () => (tick += 1_000), maxDurationMs: 1 }
  )

  assert.equal(result.findings.length, 0)
  assert.match(result.limitations.join(' '), /time budget/)
})
